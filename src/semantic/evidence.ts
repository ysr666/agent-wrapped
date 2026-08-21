import type { IngestedSession } from "../ingest/types.js";
import type { RankedMoment } from "../moments/types.js";
import { sessionEventsFromMessages } from "../session-events/fromMessages.js";
import type { SessionEvent } from "../session-events/types.js";
import { createWrappedReport } from "../wrapped/wrappedReport.js";
import {
  classifySessionToolEvents,
  classifyToolOutcome,
  type ClassifiedSessionToolEvent,
} from "./toolOutcome.js";
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
  eventIndexes: number[];
  score: number;
  reasons: string[];
  coverage: boolean;
}

function isNarrativeTurnCandidate(candidate: WindowCandidate): boolean {
  return candidate.reasons.some((reason) =>
    reason === "human-turn-episode" ||
    reason === "user-pushback" ||
    reason === "work-reopened" ||
    reason === "assistant-correction" ||
    reason === "assistant-certainty"
  );
}

function orderedUniqueIndexes(indexes: number[]): number[] {
  return [...new Set(indexes)].sort((left, right) => left - right);
}

function contiguousIndexes(start: number, end: number): number[] {
  const indexes: number[] = [];
  for (let index = start; index <= end; index += 1) indexes.push(index);
  return indexes;
}

function firstEventIndex(candidate: WindowCandidate): number {
  return candidate.eventIndexes[0] ?? Number.POSITIVE_INFINITY;
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
  return source.filter((event) => event.metadata?.inheritedContext !== true)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function failureCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:还是(?:不行|失败|报错|挂了)|没修好|失败|报错|崩|挂了|不对|wrong|failed|error|broken|still\s+(?:fails?|broken))/iu.test(text);
}

function correctionCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:等等|不对|我错了|判断错|收回|看错|虚惊|重新来|你说得对|我的失误|没有任何借口|坏习惯|抱歉|对不起|wait|hold on|i was wrong|you(?:'re| are) right|my mistake|bad habit|sorry|scratch that|retract)/iu.test(text);
}

function pushbackCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:还是(?:不行|失败|报错|挂|错)|不对|错了|不是|没(?:修好|成功|对)|又(?:错|挂|失败)|怎么又|我说的是|别这样|为什么你|竟然(?:没|没有)|wrong|still\s+(?:fails?|broken|wrong)|that's\s+wrong|not\s+what|didn't|doesn't)/iu.test(text) ||
    terseNegativeReplyCue(text) || behaviorCalloutCue(text);
}

function terseNegativeReplyCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:根本|啥也|什么都).{0,24}(?:没|没有|不)|[\p{Script=Han}]{1,8}不了|(?:没|没有|无法|不能).{0,10}(?:生效|修好|改|做|测|退|打开|显示|找到|出现)|(?:还|还是|依然|仍然|又).{0,16}(?:在.{0,8}外面|不行|错|坏|失败|不见|没(?:有)?(?:修好|成功|生效|回来|显示|出现))|\b(?:can't|cannot|unable to|doesn't work|didn't work|not fixed|not working)\b|\b(?:still|again)\b.{0,24}\b(?:broken|wrong|missing|fails?|doesn't|isn't)\b/iu.test(text);
}

function directFailureReportCue(text: string | undefined): boolean {
  if (!text || /(?:\b0\s+(?:failed|failures?|errors?)\b|all\s+tests?\s+passed|no\s+errors?|全部通过|0\s*个?失败)/iu.test(text)) return false;
  return /(?:本轮(?:运行)?失败|(?:运行|请求|调用|测试|构建|工具|模型|页面|图片|结果).{0,32}(?:失败|报错|错误|崩溃|挂了)|(?:失败|报错|错误|崩溃|挂了).{0,32}(?:运行|请求|调用|测试|构建|工具|模型|页面|图片|结果)|\b(?:all\s+.{0,20}\s+failed|runtime error|request failed|tests? failed|exception)\b)/iu.test(text);
}

function explicitClosureClaimCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:(?:本轮|这轮|本次|当前).{0,40}(?:完整闭环|闭环(?:完成|完毕)|收尾(?:完成|完毕))|(?:发布|发版|排查|修复).{0,32}(?:闭环|收尾).{0,12}(?:完成|完毕)|(?:完整|全部|已经|已).{0,8}(?:闭环|收尾).{0,12}(?:完成|完毕)|(?:发布|发版|合并|上线|release).{0,40}(?:准备就绪|可以发布|随时发布|ready to ship)|目标达成.{0,80}(?:已装|发布|修复|完成)|\b(?:cycle|round|release|work).{0,24}(?:wrapped up|complete|ready to ship|closed out)\b)/iu.test(text);
}

function humanReopensWorkCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:(?:等一下|等下|等等|先别|但是|不过|对了|还有|另外).{0,80}(?:问题|bug|issue|报错|失败|不对|没(?:有|修|解决)|移除|找不到|看不到)|(?:PR\s*#?\d+|前面|刚刚|又|还有).{0,40}(?:P0|问题|bug|issue|修)|(?:拉取|检查|排查|看看|看一下|查一下).{0,32}(?:bug|问题|issue|修复)|(?:会不会|是不是|可能).{0,20}(?:出问题|有问题|bug)|\b(?:wait|hold on|one more|another).{0,40}(?:bug|issue|problem|failure|broken)\b)/iu.test(text);
}

const SPECIFIC_TOPIC_STOPWORDS = new Set([
  "assistant", "code", "deepseek", "error", "failed", "failure", "false", "https", "image", "images", "message", "model", "models", "request", "session", "text", "this", "tools", "true", "user", "vision", "with",
]);

function specificTopicAnchors(text: string | undefined): Set<string> {
  const anchors = new Set<string>();
  if (!text) return anchors;
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9_.:/-]{3,}/gu)) {
    const rawToken = match[0]?.toLocaleLowerCase();
    if (!rawToken) continue;
    for (const candidate of [rawToken, ...rawToken.split(/[/:]/gu)]) {
      const token = candidate.replace(/^[./:_-]+|[./:_-]+$/gu, "");
      if (!token || token.length < 6 || SPECIFIC_TOPIC_STOPWORDS.has(token)) continue;
      anchors.add(token);
    }
  }
  return anchors;
}

function sharesSpecificTopicAnchor(left: string | undefined, right: string | undefined): boolean {
  const rightAnchors = specificTopicAnchors(right);
  return [...specificTopicAnchors(left)].some((leftAnchor) =>
    [...rightAnchors].some((rightAnchor) => {
      if (leftAnchor === rightAnchor) return true;
      const [shorter, longer] = leftAnchor.length < rightAnchor.length
        ? [leftAnchor, rightAnchor]
        : [rightAnchor, leftAnchor];
      return longer.startsWith(shorter) && /[./:_-]/u.test(longer[shorter.length] ?? "");
    })
  );
}

function behaviorCalloutCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:(?:为什么|怎么).{0,10}你.{0,24}(?:每次|总是|一直|又)|你.{0,24}(?:竟然|居然|每次|总是|一直|第一轮|刚才).{0,24}(?:没|没有|又|都)|(?:合着|所以).{0,16}你.{0,48}(?:啥也没|什么都没|根本没|只.{0,20}(?:没|没有))|你.{0,24}除了.{0,24}(?:啥也没|什么都没|没|没有)|why\s+(?:do|did)\s+you.{0,32}(?:always|keep)|you.{0,24}(?:always|kept|just|never|didn't|did not))/iu.test(text);
}

function certaintyCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:修好了|解决了|找到根因|问题.*明确|可以结束|没问题了|fixed|solved|root cause|done|all good)/iu.test(text);
}

function strongCompletionClaimCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:修好(?:了)?|修复(?:完成|好了)|解决(?:了|完成)|搞定(?:了)?|全部完成|没问题(?:了)?|全绿|找到(?:真正的)?根因|根因.{0,8}(?:找到|确认|锁定)|\b(?:fixed|solved|resolved|done|all green|all good|root cause found)\b)/iu.test(text);
}

function explicitAdmissionCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:你说得对|我的失误|没有任何借口|坏习惯|我错了|判断错|看错|做错|不该|you(?:'re| are) right|my mistake|bad habit|i was wrong|shouldn'?t have)/iu.test(text);
}

function eventSignal(
  event: SessionEvent,
  toolNames: Map<string, string>,
  toolFacts: Map<string, ClassifiedSessionToolEvent>,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const resolvedToolName = event.toolName ?? (event.callId ? toolNames.get(event.callId) : undefined);
  const toolOutcome = toolFacts.get(event.id)?.outcome ?? classifyToolOutcome(event, resolvedToolName).outcome;
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
  if (event.actor === "user" && (failureCue(event.text) || pushbackCue(event.text))) {
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

function narrativeMessage(event: SessionEvent): boolean {
  return (event.actor === "assistant" && event.kind === "assistant_text") ||
    (event.actor === "user" && event.kind === "user_message");
}

function withinNarrativeEpisode(
  anchor: SessionEvent,
  anchorIndex: number,
  candidate: SessionEvent,
  candidateIndex: number,
): boolean {
  if (anchor.messageIndex !== undefined && candidate.messageIndex !== undefined) {
    return Math.abs(anchor.messageIndex - candidate.messageIndex) <= 6;
  }
  return Math.abs(anchorIndex - candidateIndex) <= 24;
}

/**
 * Project a bounded human-visible exchange across intervening tool/system noise.
 * This follows message adjacency, not a wider generic event radius, so one real
 * correction episode stays intact without stitching distant work together.
 */
function narrativeEpisodeCandidates(events: SessionEvent[]): WindowCandidate[] {
  const narrativeIndexes = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => narrativeMessage(event))
    .map(({ index }) => index);
  const candidates: WindowCandidate[] = [];

  for (const anchorIndex of narrativeIndexes) {
    const anchor = events[anchorIndex];
    if (!anchor) continue;
    const assistantCorrection = anchor.actor === "assistant" && correctionCue(anchor.text);
    const directFailureReport = anchor.actor === "user" && directFailureReportCue(anchor.text);
    const potentialWorkReopening = anchor.actor === "user" && humanReopensWorkCue(anchor.text);
    const userPushback = anchor.actor === "user" && (pushbackCue(anchor.text) || directFailureReport);
    if (!assistantCorrection && !userPushback && !potentialWorkReopening) continue;

    const nearby = narrativeIndexes.filter((index) => {
      const event = events[index];
      return !!event && withinNarrativeEpisode(anchor, anchorIndex, event, index);
    });
    const indexes = [anchorIndex];
    let previousAssistant: number | undefined;
    let nextAssistant: number | undefined;

    if (userPushback || potentialWorkReopening) {
      previousAssistant = [...nearby].reverse().find((index) => index < anchorIndex && events[index]?.actor === "assistant");
      nextAssistant = nearby.find((index) => index > anchorIndex && events[index]?.actor === "assistant");
      if (previousAssistant !== undefined) indexes.push(previousAssistant);
      if (nextAssistant !== undefined) indexes.push(nextAssistant);
    } else {
      const previousUser = [...nearby].reverse().find((index) => index < anchorIndex && events[index]?.actor === "user");
      const nextUser = nearby.find((index) => index > anchorIndex && events[index]?.actor === "user");
      if (nextUser !== undefined) {
        indexes.push(nextUser);
        const nextAssistant = nearby.find((index) => index > nextUser && events[index]?.actor === "assistant");
        if (nextAssistant !== undefined) indexes.push(nextAssistant);
      } else {
        if (previousUser !== undefined) indexes.push(previousUser);
        const nextAssistant = nearby.find((index) => index > anchorIndex && events[index]?.actor === "assistant");
        if (nextAssistant !== undefined) indexes.push(nextAssistant);
      }
    }

    const previousNarrative = [...nearby].reverse().find((index) => index < anchorIndex);
    const nextNarrative = nearby.find((index) => index > anchorIndex);
    const caughtBehavior = userPushback && behaviorCalloutCue(anchor.text) &&
      nextAssistant !== undefined && nextNarrative === nextAssistant && explicitAdmissionCue(events[nextAssistant]?.text);
    let puncturedClaimIndex: number | undefined;
    let closureInterruption = false;
    if ((userPushback || potentialWorkReopening) && previousAssistant !== undefined && previousNarrative === previousAssistant) {
      if (directFailureReport) {
        const previousMessageIndex = events[previousAssistant]?.messageIndex;
        const sameAssistantTurn = [...nearby].reverse().filter((index) =>
          index <= previousAssistant &&
          events[index]?.actor === "assistant" &&
          (previousMessageIndex === undefined || events[index]?.messageIndex === previousMessageIndex)
        );
        puncturedClaimIndex = sameAssistantTurn.find((index) =>
          strongCompletionClaimCue(events[index]?.text) &&
          sharesSpecificTopicAnchor(events[index]?.text, anchor.text)
        );
      } else if (potentialWorkReopening) {
        const previousMessageIndex = events[previousAssistant]?.messageIndex;
        puncturedClaimIndex = [...nearby].reverse().find((index) =>
          index <= previousAssistant &&
          events[index]?.actor === "assistant" &&
          (previousMessageIndex === undefined || events[index]?.messageIndex === previousMessageIndex) &&
          explicitClosureClaimCue(events[index]?.text)
        );
        closureInterruption = puncturedClaimIndex !== undefined;
      } else if (
        terseNegativeReplyCue(anchor.text) &&
        strongCompletionClaimCue(events[previousAssistant]?.text)
      ) {
        puncturedClaimIndex = previousAssistant;
      }
      if (puncturedClaimIndex !== undefined) indexes.push(puncturedClaimIndex);
    }
    const puncturedClaim = puncturedClaimIndex !== undefined;
    const eventIndexes = orderedUniqueIndexes(indexes);
    if (eventIndexes.length < 2) continue;
    candidates.push({
      eventIndexes,
      score: caughtBehavior ? 24 : puncturedClaim ? 22 : 16,
      reasons: [
        "human-turn-episode",
        assistantCorrection ? "assistant-correction" : closureInterruption ? "work-reopened" : "user-pushback",
        ...(caughtBehavior ? ["behavior-callout-episode"] : []),
        ...(puncturedClaim && !closureInterruption ? ["claim-pushback-episode"] : []),
        ...(puncturedClaim && directFailureReport ? ["direct-failure-episode"] : []),
        ...(puncturedClaim && closureInterruption ? ["closure-interruption-episode"] : []),
      ],
      coverage: false,
    });
  }
  return candidates;
}

function overlapRatio(left: WindowCandidate, right: WindowCandidate): number {
  const rightIndexes = new Set(right.eventIndexes);
  const overlap = left.eventIndexes.filter((index) => rightIndexes.has(index)).length;
  const shorter = Math.min(left.eventIndexes.length, right.eventIndexes.length);
  return shorter === 0 ? 0 : overlap / shorter;
}

function episodeCandidates(
  events: SessionEvent[],
  toolFacts: Map<string, ClassifiedSessionToolEvent>,
): WindowCandidate[] {
  const callIndexes = new Map<string, number>();
  const resultIndexes = new Map<string, number>();
  for (const [index, event] of events.entries()) {
    if (event.kind === "tool_call" && event.callId) callIndexes.set(event.callId, index);
    if ((event.kind === "tool_result" || event.kind === "tool_error") && event.callId) resultIndexes.set(event.callId, index);
  }

  const candidates: WindowCandidate[] = [];
  for (const [followupIndex, event] of events.entries()) {
    if (event.kind !== "tool_call") continue;
    const facts = toolFacts.get(event.id);
    if (
      !facts?.followupOfCallId ||
      !facts.followupRelation ||
      !["alternative_action", "variant_arguments_retry"].includes(facts.followupRelation)
    ) continue;
    const failedCallIndex = callIndexes.get(facts.followupOfCallId);
    const failedResultIndex = resultIndexes.get(facts.followupOfCallId);
    if (failedCallIndex === undefined || failedResultIndex === undefined) continue;
    const failedFacts = toolFacts.get(events[failedResultIndex]?.id ?? "");
    if (failedFacts?.outcome !== "failure" && failedFacts?.outcome !== "blocked") continue;

    const contextIndexes = events
      .slice(failedResultIndex + 1, followupIndex)
      .map((between, offset) => ({ event: between, index: failedResultIndex + 1 + offset }))
      .filter(({ event: between }) => between.kind === "assistant_text" || between.kind === "user_message")
      .slice(-3)
      .map(({ index }) => index);
    const followupResultIndex = event.callId ? resultIndexes.get(event.callId) : undefined;
    candidates.push({
      eventIndexes: orderedUniqueIndexes([
        failedCallIndex,
        failedResultIndex,
        ...contextIndexes,
        followupIndex,
        ...(followupResultIndex === undefined ? [] : [followupResultIndex]),
      ]),
      score: facts.followupRelation === "alternative_action" ? 14 : 13,
      reasons: ["failure-followup-episode", `followup:${facts.followupRelation}`],
      coverage: false,
    });
  }
  return candidates;
}

function selectWindows(
  events: SessionEvent[],
  momentMessageIndexes: Set<number>,
  options: SemanticEvidenceOptions,
  toolNames: Map<string, string>,
  toolFacts: Map<string, ClassifiedSessionToolEvent>,
): WindowCandidate[] {
  if (events.length === 0) return [];
  const radius = clampInt(options.eventRadius, 3, 1, 8);
  const maxWindows = clampInt(options.maxWindows, 6, 1, 12);
  const coverageWindows = clampInt(options.coverageWindows, 2, 0, Math.min(4, maxWindows));
  const candidates: WindowCandidate[] = [];

  events.forEach((event, index) => {
    const signal = eventSignal(event, toolNames, toolFacts);
    const momentBoost = event.messageIndex !== undefined && momentMessageIndexes.has(event.messageIndex) ? 3 : 0;
    if (signal.score + momentBoost <= 0) return;
    candidates.push({
      eventIndexes: contiguousIndexes(Math.max(0, index - radius), Math.min(events.length - 1, index + radius)),
      score: signal.score + momentBoost,
      reasons: [...signal.reasons, ...(momentBoost > 0 ? ["moment-hint"] : [])],
      coverage: false,
    });
  });

  const coverage: WindowCandidate[] = [];
  for (let index = 0; index < coverageWindows; index += 1) {
    const center = Math.round(((index + 1) * (events.length - 1)) / (coverageWindows + 1));
    coverage.push({
      eventIndexes: contiguousIndexes(Math.max(0, center - radius), Math.min(events.length - 1, center + radius)),
      score: 0.25,
      reasons: ["coverage-sample"],
      coverage: true,
    });
  }

  const selected: WindowCandidate[] = [];
  const narrativeWindows = narrativeEpisodeCandidates(events);
  const episodeWindows = [...narrativeWindows, ...episodeCandidates(events, toolFacts)];
  const signalBudget = Math.max(0, maxWindows - coverage.length);

  // Failure→follow-up episodes are strong factual anchors, but they are not
  // automatically entertaining. Preserve one slot for an explicit assertion,
  // correction, or user pushback when the session has one; otherwise a long
  // tool-heavy session can send only generic workflow loops to Story Miner.
  // This is a selection/diversity rule, not a wider window or another keyword
  // detector, and it leaves ordinary failure coverage intact.
  if (signalBudget > 0) {
    for (const candidate of [...narrativeWindows, ...candidates]
      .filter(isNarrativeTurnCandidate)
      .sort((a, b) => b.score - a.score || firstEventIndex(a) - firstEventIndex(b))) {
      if (selected.length >= 1) break;
      if (selected.some((existing) => overlapRatio(existing, candidate) >= 0.7)) continue;
      selected.push(candidate);
    }
  }

  for (const candidate of [...episodeWindows, ...candidates].sort((a, b) => b.score - a.score || firstEventIndex(a) - firstEventIndex(b))) {
    if (selected.length >= signalBudget) break;
    if (selected.some((existing) => overlapRatio(existing, candidate) >= 0.7)) continue;
    selected.push(candidate);
  }
  for (const candidate of coverage) {
    if (selected.length >= maxWindows) break;
    if (selected.some((existing) => overlapRatio(existing, candidate) >= 0.85)) continue;
    selected.push(candidate);
  }
  if (selected.length === 0) {
    selected.push({
      eventIndexes: contiguousIndexes(0, Math.min(events.length - 1, radius * 2)),
      score: 0,
      reasons: ["fallback-window"],
      coverage: true,
    });
  }
  return selected.sort((a, b) => firstEventIndex(a) - firstEventIndex(b) || b.score - a.score);
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
  if (event.actor === "system") return undefined;
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
  const toolFacts = classifySessionToolEvents(events);
  const preliminaryHints = momentHints(rankedMoments, events, new Set(events.map((event) => event.id)), options);
  const windows = selectWindows(events, preliminaryHints.messageIndexes, options, toolNames, toolFacts);
  const desiredIndexes = new Set<number>();
  for (const window of windows) for (const index of window.eventIndexes) desiredIndexes.add(index);

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
    const toolSummary: ClassifiedSessionToolEvent | undefined = event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "tool_error"
      ? toolFacts.get(event.id) ?? classifyToolOutcome(event, resolvedToolName)
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
      toolOperation: toolSummary?.operation,
      // Call IDs are useful for local pairing but host-provided values are not
      // trusted as remote-safe identifiers. Preserve the relationship with an
      // opaque per-evidence alias instead.
      callId: event.callId ? remoteCallIds.get(event.callId) : undefined,
      followupOfCallId: toolSummary?.followupOfCallId ? remoteCallIds.get(toolSummary.followupOfCallId) : undefined,
      followupRelation: toolSummary?.followupRelation,
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
    eventIds: window.eventIndexes.map((eventIndex) => events[eventIndex]).filter((event): event is SessionEvent => !!event)
      .map((event) => `event:${event.id}`).filter((id) => eventIdSet.has(id)),
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
  const evidence = buildSemanticEvidenceFromMoments(session, report.rankedMoments ?? [], options);
  // Ranked P3 moments may help local window recall, but only moments that
  // passed P3.5's showability gate may cross the semantic boundary or feed a
  // P8 persona. Otherwise a newly admitted Story can accidentally unlock a
  // personality signal from unrelated markdown/code repetition.
  const showableHintIds = new Set(report.awards.map((award) => `moment:${award.momentId}`));
  return {
    ...evidence,
    momentHints: evidence.momentHints.filter((hint) => showableHintIds.has(hint.id)),
  };
}
