import type { TranscriptMessage } from "../core/types.js";
import type { IngestedSession } from "../ingest/types.js";
import type { RankedMoment } from "../moments/types.js";
import { createWrappedReport } from "../wrapped/wrappedReport.js";
import type {
  SemanticEvidenceBundle,
  SemanticEvidenceMessage,
  SemanticEvidenceMoment,
} from "./types.js";

export interface SemanticEvidenceOptions {
  locale?: "zh-CN" | "en";
  /** Number of P3 moments supplied to the narrator. Defaults to 8. */
  topMoments?: number;
  /** Neighboring transcript messages retained around each moment. Defaults to 1. */
  contextRadius?: number;
  /** Hard cap on retained context messages. Defaults to 28. */
  maxContextMessages?: number;
  /** Per-message character cap. Defaults to 1400. */
  maxMessageChars?: number;
  /** Approximate total textual evidence cap. Defaults to 18000. */
  maxEvidenceChars?: number;
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

function semanticRole(message: TranscriptMessage): SemanticEvidenceMessage["role"] | undefined {
  if (message.role === "user" || message.role === "assistant" || message.role === "tool") return message.role;
  return undefined;
}

function rankedMomentOrder(left: RankedMoment, right: RankedMoment): number {
  return (
    right.scores.funScore - left.scores.funScore ||
    right.scores.confidence - left.scores.confidence ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Build evidence from an already-ranked moment list. This is exported separately
 * so evaluation/tests can exercise the privacy boundary without rerunning P0-P3.
 */
export function buildSemanticEvidenceFromMoments(
  session: IngestedSession,
  rankedMoments: RankedMoment[],
  options: SemanticEvidenceOptions = {},
): SemanticEvidenceBundle {
  const locale = options.locale ?? "zh-CN";
  const topMoments = clampInt(options.topMoments, 8, 1, 20);
  const contextRadius = clampInt(options.contextRadius, 1, 0, 4);
  const maxContextMessages = clampInt(options.maxContextMessages, 28, 1, 80);
  const maxMessageChars = clampInt(options.maxMessageChars, 1400, 120, 5000);
  const maxEvidenceChars = clampInt(options.maxEvidenceChars, 18000, 2000, 60000);

  const selected = [...rankedMoments].sort(rankedMomentOrder).slice(0, topMoments);
  let usedChars = 0;
  let truncated = rankedMoments.length > selected.length;

  const moments: SemanticEvidenceMoment[] = selected.map((moment) => {
    const primary = clip(moment.primaryText, maxMessageChars);
    const related = moment.relatedTexts.slice(0, 4).map((text) => clip(text, maxMessageChars));
    const structural = moment.evidence.slice(0, 6).map((text) => clip(text, 500));
    truncated ||= primary.clipped || related.some((entry) => entry.clipped) || structural.some((entry) => entry.clipped);
    usedChars += primary.text.length;
    for (const entry of related) usedChars += entry.text.length;
    for (const entry of structural) usedChars += entry.text.length;
    return {
      id: `moment:${moment.id}`,
      type: moment.type,
      primaryText: primary.text,
      relatedTexts: related.map((entry) => entry.text),
      structuralEvidence: structural.map((entry) => entry.text),
      messageIndexes: [...moment.messageIndexes],
      contextMessageIds: [],
    };
  });

  const desiredIndexes = new Set<number>();
  for (const moment of selected) {
    for (const index of moment.messageIndexes) {
      for (let delta = -contextRadius; delta <= contextRadius; delta += 1) {
        const candidate = index + delta;
        if (candidate >= 0 && candidate < session.messages.length) desiredIndexes.add(candidate);
      }
    }
  }

  const orderedIndexes = [...desiredIndexes].sort((a, b) => a - b);
  if (orderedIndexes.length > maxContextMessages) truncated = true;
  const messages: SemanticEvidenceMessage[] = [];
  const includedIndexes = new Set<number>();

  for (const messageIndex of orderedIndexes.slice(0, maxContextMessages)) {
    const message = session.messages[messageIndex];
    if (!message) continue;
    const role = semanticRole(message);
    if (!role) continue;
    const clipped = clip(message.text, maxMessageChars);
    if (!clipped.text) continue;
    if (usedChars + clipped.text.length > maxEvidenceChars) {
      truncated = true;
      continue;
    }
    if (clipped.clipped) truncated = true;
    usedChars += clipped.text.length;
    includedIndexes.add(messageIndex);
    messages.push({
      id: `message:${messageIndex}`,
      messageIndex,
      role,
      text: clipped.text,
    });
  }

  for (const semanticMoment of moments) {
    semanticMoment.contextMessageIds = semanticMoment.messageIndexes
      .flatMap((index) => {
        const ids: string[] = [];
        for (let delta = -contextRadius; delta <= contextRadius; delta += 1) {
          const candidate = index + delta;
          if (includedIndexes.has(candidate)) ids.push(`message:${candidate}`);
        }
        return ids;
      })
      .filter((id, index, all) => all.indexOf(id) === index);
  }

  return {
    version: 1,
    sessionId: session.id,
    host: session.host,
    title: session.title,
    model: session.model,
    locale,
    moments,
    messages,
    truncated,
  };
}

/** Run the existing Moment Engine, then retain only a bounded evidence packet. */
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
