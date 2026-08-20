import type { IngestedSession } from "../ingest/types.js";
import type { RankedMoment } from "../moments/types.js";
import { sessionEventsFromMessages } from "../session-events/fromMessages.js";
import type { SessionEvent } from "../session-events/types.js";
import { createWrappedReport } from "../wrapped/wrappedReport.js";
import { classifyToolOutcome } from "./toolOutcome.js";
import type {
  SemanticEvidenceBundle,
  SemanticEvidenceEvent,
  SemanticMomentHint,
  SemanticStoryWindow,
} from "./types.js";

export interface SemanticEvidenceOptions {
  locale?: "zh-CN" | "en";
  /** Secondary P3 hints retained for context. They do not gate Story Discovery. */
  topMoments?: number;
  /** Radius around a structural anchor when building a candidate story window. */
  eventRadius?: number;
  /** Maximum windows supplied to Story Miner. Defaults to 6. */
  maxWindows?: number;
  /** Number of evenly sampled coverage windows kept even without strong local signals. */
  coverageWindows?: number;
  /** Hard cap on unique events sent remotely. Defaults to 48. */
  maxEvents?: number;
  /** Per-event textual cap after redaction. Defaults to 1000. */
  maxEventChars?: number;
  /** Approximate total textual evidence cap. Defaults to 18000. */
  maxEvidenceChars?: number;
}

interface WindowCandidate {
  start: number;
  end: number;
  score: number;
  reasons: string[];
  coverage: boolean;
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function clip(text: string, maxChars: number): { text: string; clipped: boolean } {
  const normalized = text.trim();
  if (normalized.length <= maxChars) return { text: normalized, clipped: false };
  return { text: `${normalized.slice(0, Math.max(0, maxChars - 1))}…`, clipped: true };
}

export function redactSemanticText(input: string): { text: string; redactions: number } {
  let text = input;
  let redactions = 0;
  const replace = (pattern: RegExp, replacement: string | ((...args: string[]) => string)): void => {
    text = text.replace(pattern, (...args: string[]) => {
      redactions += 1;
      return typeof replacement === "string" ? replacement : replacement(...args);
    });
  };

  replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}=*/giu, "Bearer [REDACTED]");
  replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{16,}|AIza[0-9A-Za-z_-]{20,})\b/gu, "[REDACTED_KEY]");
  replace(/\b(api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|secret)\b\s*[:=]\s*["']?([^\s"',;]{6,})/giu, (_match, key) => `${key}=[REDACTED]`);
  replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, "[REDACTED_EMAIL]");
  replace(/\/Users\/[^/\s]+\//gu, "/Users/[USER]/");
  replace(/\/home\/[^/\s]+\//gu, "/home/[USER]/");
  replace(/\b[A-Za-z]:\\Users\\[^\\\s]+\\/gu, "C:\\Users\\[USER]\\");
  return { text, redactions };
}

function normalizedEvents(session: IngestedSession): SessionEvent[] {
  const source = session.events && session.events.length > 0
    ? session.events
    : sessionEventsFromMessages(session.messages);
  return [...source].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function failureCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:还是(?:不行|失败|报错|挂了)|没修好|失败|报错|崩|挂了|不对|wrong|failed|error|broken|still\s+(?:fails?|broken))/iu.test(text);
}

function correctionCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:等等|不对|我错了|判断错|收回|看错|虚惊|重新来|wait|hold on|i was wrong|scratch that|retract)/iu.test(text);
}

function certaintyCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:修好了|解决了|找到根因|问题.*明确|可以结束|没问题了|fixed|solved|root cause|done|all good)/iu.test(text);
}

function eventSignal(event: SessionEvent, toolNames: Map<string, string>): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const resolvedToolName = event.toolName ?? (event.callId ? toolNames.get(event.callId) : undefined);
  const toolOutcome = classifyToolOutcome(event, resolvedToolName).outcome;
  if (toolOutcome === "failure" || toolOutcome === "blocked") {
    score += 9;
    reasons.push(toolOutcome === "blocked" ? "tool-blocked" : "tool-failure");
  } else if (event.kind === "tool_call") {
    score += 2;
    reasons.push("tool-call");
  } else if (event.kind === "tool_result") {
    score += 1;
    reasons.push("tool-result");
  }
  if (event.kind === "turn_end" && event.isError) {
    score += 7;
    reasons.push("turn-failure");
  }
  if (event.actor === "user" && failureCue(event.text)) {
    score += 6;
    reasons.push("user-pushback");
  }
  if (event.actor === "assistant" && correctionCue(event.text)) {
    score += 6;
    reasons.push("assistant-correction");
  }
  if (event.actor === "assistant" && certaintyCue(event.text)) {
    score += 3;
    reasons.push("assistant-certainty");
  }
  return { score, reasons };
}

function overlapRatio(left: WindowCandidate, right: WindowCandidate): number {
  const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start) + 1);
  const shorter = Math.min(left.end - left.start + 1, right.end - right.start + 1);
  return shorter === 0 ? 0 : overlap / shorter;
}

function selectWindows(
  events: SessionEvent[],
  momentMessageIndexes: Set<number>,
  options: SemanticEvidenceOptions,
  toolNames: Map<string, string>,
): WindowCandidate[] {
  if (events.length === 0) return [];
  const radius = clampInt(options.eventRadius, 3, 1, 8);
  const maxWindows = clampInt(options.maxWindows, 6, 1, 12);
  const coverageWindows = clampInt(options.coverageWindows, 2, 0, Math.min(4, maxWindows));
  const candidates: WindowCandidate[] = [];

  events.forEach((event, index) => {
    const signal = eventSignal(event, toolNames);
    const momentBoost = event.messageIndex !== undefined && momentMessageIndexes.has(event.messageIndex) ? 3 : 0;
    if (signal.score + momentBoost <= 0) return;
    candidates.push({
      start: Math.max(0, index - radius),
      end: Math.min(events.length - 1, index + radius),
      score: signal.score + momentBoost,
      reasons: [...signal.reasons, ...(momentBoost > 0 ? ["moment-hint"] : [])],
      coverage: false,
    });
  });

  const coverage: WindowCandidate[] = [];
  for (let index = 0; index < coverageWindows; index += 1) {
    const center = Math.round(((index + 1) * (events.length - 1)) / (coverageWindows + 1));
    coverage.push({
      start: Math.max(0, center - radius),
      end: Math.min(events.length - 1, center + radius),
      score: 0.25,
      reasons: ["coverage-sample"],
      coverage: true,
    });
  }

  const selected: WindowCandidate[] = [];
  for (const candidate of [...candidates].sort((a, b) => b.score - a.score || a.start - b.start)) {
    if (selected.length >= Math.max(0, maxWindows - coverage.length)) break;
    if (selected.some((existing) => overlapRatio(existing, candidate) >= 0.7)) continue;
    selected.push(candidate);
  }
  for (const candidate of coverage) {
    if (selected.length >= maxWindows) break;
    if (selected.some((existing) => overlapRatio(existing, candidate) >= 0.85)) continue;
    selected.push(candidate);
  }
  if (selected.length === 0) selected.push({ start: 0, end: Math.min(events.length - 1, radius * 2), score: 0, reasons: ["fallback-window"], coverage: true });
  return selected.sort((a, b) => a.start - b.start || b.score - a.score);
}

function rankedMomentOrder(left: RankedMoment, right: RankedMoment): number {
  return right.scores.funScore - left.scores.funScore || right.scores.confidence - left.scores.confidence || left.id.localeCompare(right.id);
}

function momentHints(
  rankedMoments: RankedMoment[],
  events: SessionEvent[],
  includedEventIds: Set<string>,
  options: SemanticEvidenceOptions,
): { hints: SemanticMomentHint[]; messageIndexes: Set<number>; truncated: boolean } {
  const topMoments = clampInt(options.topMoments, 6, 0, 20);
  const selected = [...rankedMoments].sort(rankedMomentOrder).slice(0, topMoments);
  const messageIndexes = new Set(selected.flatMap((moment) => moment.messageIndexes));
  const byMessage = new Map<number, string[]>();
  for (const event of events) {
    if (event.messageIndex === undefined || !includedEventIds.has(event.id)) continue;
    const ids = byMessage.get(event.messageIndex) ?? [];
    ids.push(`event:${event.id}`);
    byMessage.set(event.messageIndex, ids);
  }
  const hints = selected.map((moment) => {
    const primary = redactSemanticText(moment.primaryText).text;
    const relatedTexts = moment.relatedTexts.slice(0, 4).map((text) => redactSemanticText(text).text);
    return {
      id: `moment:${moment.id}`,
      type: moment.type,
      primaryText: primary,
      relatedTexts,
      eventIds: moment.messageIndexes.flatMap((index) => byMessage.get(index) ?? []).filter((id, index, all) => all.indexOf(id) === index),
    };
  });
  return { hints, messageIndexes, truncated: rankedMoments.length > selected.length };
}

function eventText(event: SessionEvent): string | undefined {
  // The remote semantic boundary never receives raw tool arguments/results or
  // unstructured turn-end error messages. Tool facts are added separately as
  // classified, allowlisted fields below.
  if (event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "tool_error") return undefined;
  if (event.kind === "turn_end") return `turn ended: ${event.outcome ?? "unknown"}`;
  return event.text;
}

/**
 * Build a bounded Story-Miner evidence packet from observable events first.
 * P3 moments are hints only and never decide whether a session receives story coverage.
 */
export function buildSemanticEvidenceFromMoments(
  session: IngestedSession,
  rankedMoments: RankedMoment[],
  options: SemanticEvidenceOptions = {},
): SemanticEvidenceBundle {
  const locale = options.locale ?? "zh-CN";
  const events = normalizedEvents(session);
  const toolNames = new Map<string, string>();
  const remoteCallIds = new Map<string, string>();
  for (const event of events) {
    if (event.kind === "tool_call" && event.callId && event.toolName) toolNames.set(event.callId, event.toolName);
    if (event.callId && !remoteCallIds.has(event.callId)) remoteCallIds.set(event.callId, `call:${remoteCallIds.size}`);
  }
  const preliminaryHints = momentHints(rankedMoments, events, new Set(events.map((event) => event.id)), options);
  const windows = selectWindows(events, preliminaryHints.messageIndexes, options, toolNames);
  const desiredIndexes = new Set<number>();
  for (const window of windows) for (let index = window.start; index <= window.end; index += 1) desiredIndexes.add(index);

  const maxEvents = clampInt(options.maxEvents, 48, 4, 120);
  const maxEventChars = clampInt(options.maxEventChars, 1000, 120, 5000);
  const maxEvidenceChars = clampInt(options.maxEvidenceChars, 18000, 2000, 60000);
  const orderedIndexes = [...desiredIndexes].sort((a, b) => a - b);
  let truncated = orderedIndexes.length > maxEvents || preliminaryHints.truncated;
  let usedChars = 0;
  let redactionCount = 0;
  const evidenceEvents: SemanticEvidenceEvent[] = [];
  const includedEventIds = new Set<string>();

  for (const eventIndex of orderedIndexes.slice(0, maxEvents)) {
    const event = events[eventIndex];
    if (!event) continue;
    const resolvedToolName = event.toolName ?? (event.callId ? toolNames.get(event.callId) : undefined);
    const toolSummary = event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "tool_error"
      ? classifyToolOutcome(event, resolvedToolName)
      : undefined;
    const rawText = eventText(event);
    let text: string | undefined;
    if (rawText) {
      const redacted = redactSemanticText(rawText);
      redactionCount += redacted.redactions;
      const clipped = clip(redacted.text, maxEventChars);
      if (clipped.clipped) truncated = true;
      if (usedChars + clipped.text.length > maxEvidenceChars) {
        truncated = true;
        continue;
      }
      usedChars += clipped.text.length;
      text = clipped.text;
    }
    const id = `event:${event.id}`;
    includedEventIds.add(event.id);
    evidenceEvents.push({
      id,
      order: event.order,
      actor: event.actor,
      kind: event.kind,
      text,
      toolName: resolvedToolName,
      toolCategory: toolSummary?.toolCategory,
      // Call IDs are useful for local pairing but host-provided values are not
      // trusted as remote-safe identifiers. Preserve the relationship with an
      // opaque per-evidence alias instead.
      callId: event.callId ? remoteCallIds.get(event.callId) : undefined,
      isError: event.isError,
      outcome: toolSummary?.outcome ?? event.outcome,
      exitCode: toolSummary?.exitCode,
      errorClass: toolSummary?.errorClass,
      testSummary: toolSummary?.testSummary,
    });
  }

  const finalHints = momentHints(rankedMoments, events, includedEventIds, options);
  const eventIdSet = new Set(evidenceEvents.map((event) => event.id));
  const semanticWindows: SemanticStoryWindow[] = windows.map((window, index) => ({
    id: `window:${index}`,
    eventIds: events.slice(window.start, window.end + 1).map((event) => `event:${event.id}`).filter((id) => eventIdSet.has(id)),
    reasons: [...new Set(window.reasons)],
  })).filter((window) => window.eventIds.length >= 2);

  return {
    version: 2,
    sessionId: session.id,
    host: session.host,
    title: session.title,
    model: session.model,
    locale,
    events: evidenceEvents,
    windows: semanticWindows,
    momentHints: finalHints.hints,
    redactionCount,
    truncated,
  };
}

export function buildSemanticEvidence(
  session: IngestedSession,
  options: SemanticEvidenceOptions = {},
): SemanticEvidenceBundle {
  const report = createWrappedReport(session.messages, {
    locale: options.locale,
    includeRankedMoments: true,
  });
  return buildSemanticEvidenceFromMoments(session, report.rankedMoments ?? [], options);
}
