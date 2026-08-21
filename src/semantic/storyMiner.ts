import type {
  SemanticEvidenceBundle,
  SemanticStoryCandidate,
  StoryArcKind,
  StoryBeatKind,
  VerifiedStoryArc,
} from "./types.js";

interface JsonObject { [key: string]: unknown }
type EvidenceEvent = SemanticEvidenceBundle["events"][number];

interface ResolvedBeat {
  kind: StoryBeatKind;
  evidence: EvidenceEvent[];
}

const ARC_KINDS = new Set<StoryArcKind>([
  "false_dawn",
  "failure_then_workaround",
  "mistake_then_correction",
  "user_pushback_then_recovery",
  "capability_gap_then_improvisation",
  "breakdown_then_resume",
  "reversal",
  "other",
]);

const BEAT_KINDS = new Set<StoryBeatKind>([
  "setup",
  "claim",
  "attempt",
  "failure",
  "block",
  "user_pushback",
  "capability_gap",
  "breakdown",
  "correction",
  "workaround",
  "recovery",
  "success",
  "reversal",
]);

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1]?.trim() ?? trimmed;
}

function strings(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) return undefined;
    if (!output.includes(entry)) output.push(entry);
  }
  return output;
}

export interface ParsedStoryMiningResult {
  candidates: SemanticStoryCandidate[];
  insufficientEvidence?: string;
}

export function parseStoryMinerOutput(raw: string): ParsedStoryMiningResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("Story Miner did not return valid JSON.");
  }
  const root = object(parsed);
  if (!root) throw new Error("Story Miner response is not a JSON object.");
  const candidates: SemanticStoryCandidate[] = [];
  const stories = root.stories;
  if (stories !== undefined && stories !== null) {
    if (!Array.isArray(stories) || stories.length > 8) throw new Error("Story Miner stories must be an array of at most 8 entries.");
    stories.forEach((value, storyIndex) => {
      const entry = object(value);
      if (!entry) throw new Error(`Story Miner returned invalid stories[${storyIndex}].`);
      const windowId = entry.windowId;
      const arcKind = entry.arcKind;
      const confidence = entry.confidence;
      if (typeof windowId !== "string" || !windowId.trim()) {
        throw new Error(`Story Miner returned invalid stories[${storyIndex}].windowId.`);
      }
      if (typeof arcKind !== "string" || !ARC_KINDS.has(arcKind as StoryArcKind)) {
        throw new Error(`Story Miner returned invalid stories[${storyIndex}].arcKind.`);
      }
      if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
        throw new Error(`Story Miner returned invalid stories[${storyIndex}].confidence.`);
      }
      if (!Array.isArray(entry.beats) || entry.beats.length < 2 || entry.beats.length > 6) {
        throw new Error(`Story Miner stories[${storyIndex}] must contain 2-6 beats.`);
      }
      const beats = entry.beats.map((beatValue, beatIndex) => {
        const beat = object(beatValue);
        if (!beat) throw new Error(`Story Miner returned invalid stories[${storyIndex}].beats[${beatIndex}].`);
        const kind = beat.kind;
        const evidenceIds = strings(beat.evidenceIds);
        if (
          typeof kind !== "string" ||
          !BEAT_KINDS.has(kind as StoryBeatKind) ||
          !evidenceIds ||
          evidenceIds.length > 3
        ) {
          throw new Error(`Story Miner returned invalid stories[${storyIndex}].beats[${beatIndex}].`);
        }
        return { kind: kind as StoryBeatKind, evidenceIds };
      });
      candidates.push({ windowId: windowId.trim(), arcKind: arcKind as StoryArcKind, beats, confidence });
    });
  }
  const insufficientEvidence = typeof root.insufficientEvidence === "string" && root.insufficientEvidence.trim()
    ? root.insufficientEvidence.trim()
    : undefined;
  if (candidates.length === 0 && !insufficientEvidence) {
    throw new Error("Story Miner returned neither stories nor an insufficient-evidence reason.");
  }
  return { candidates, insufficientEvidence };
}

function eventText(event: EvidenceEvent): string {
  return [event.text, event.outcome, event.toolName].filter((value): value is string => !!value).join(" ");
}

function failureCue(text: string | undefined): boolean {
  if (!text) return false;
  if (/(?:\b0\s+(?:failed|failures?|errors?)\b|all\s+tests?\s+passed|no\s+errors?|全部通过|0\s*个?失败)/iu.test(text)) return false;
  return /(?:失败|报错|不行|没修好|挂了|崩|错误|失败了|failed|failure|error|broken|denied|blocked|still\s+(?:fails?|broken))/iu.test(text);
}

function blockCue(text: string | undefined): boolean {
  return !!text && /(?:permission|denied|forbidden|blocked|sandbox|read[- ]?only|权限|拒绝|阻止|拦住|禁止|不允许|无权|只读)/iu.test(text);
}

function pushbackCue(text: string | undefined): boolean {
  return !!text && /(?:还是(?:不行|失败|报错|挂|错)|不对|错了|不是|没(?:修好|成功|对)|又(?:错|挂|失败)|怎么又|我说的是|别这样|为什么你|竟然(?:没|没有)|wrong|still\s+(?:fails?|broken|wrong)|that's\s+wrong|not\s+what|didn't|doesn't)/iu.test(text);
}

function behaviorCalloutCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:(?:为什么|怎么).{0,10}你.{0,24}(?:每次|总是|一直|又)|你.{0,24}(?:竟然|居然|每次|总是|一直|第一轮|刚才).{0,24}(?:没|没有|又|都)|why\s+(?:do|did)\s+you.{0,32}(?:always|keep)|you.{0,24}(?:always|kept|just|never|didn't|did not))/iu.test(text);
}

function correctionCue(text: string | undefined): boolean {
  return !!text && /(?:等等|不对|我错了|判断错|看错|收回|改口|重新检查|真正(?:的)?(?:问题|根因)|其实|你说得对|我的失误|没有任何借口|坏习惯|抱歉|对不起|wait|hold on|i was wrong|you(?:'re| are) right|my mistake|bad habit|sorry|scratch that|retract|actually)/iu.test(text);
}

function explicitAdmissionCue(text: string | undefined): boolean {
  if (!text) return false;
  return /(?:你说得对|我的失误|没有任何借口|坏习惯|我错了|判断错|看错|做错|不该|you(?:'re| are) right|my mistake|bad habit|i was wrong|shouldn'?t have)/iu.test(text);
}

function reversalCue(text: string | undefined): boolean {
  return correctionCue(text) || (!!text && /(?:不是.+而是|反而|原来|turns out|instead|rather than)/iu.test(text));
}

function recoveryCue(text: string | undefined): boolean {
  return !!text && /(?:继续|接着|重新来|再来|换个办法|换(?:一|个)?种|回到正题|继续干|继续处理|back to business|continue|resume|try again|retry|different approach|another way)/iu.test(text);
}

function certaintyCue(text: string | undefined): boolean {
  return !!text && /(?:修好了|解决了|找到(?:了)?根因|问题.*(?:明确|清楚)|可以结束|没问题了|搞定|完成了|fixed|solved|root cause|done|all good|resolved)/iu.test(text);
}

function claimCue(text: string | undefined): boolean {
  return certaintyCue(text) || !!text && /(?:应该(?:是|已经)|确认(?:了)?|结论(?:是|为)|根因(?:是|在)|就是|并非|确实|显然|i think|the issue is|this is|confirmed)/iu.test(text);
}

function capabilityGapCue(text: string | undefined): boolean {
  return !!text && /(?:不能|无法|做不到|没有(?:这个|相应)?(?:工具|能力|权限)|不支持|can't|cannot|unable to|don't have (?:a |the )?(?:tool|ability|permission)|not supported)/iu.test(text);
}

function breakdownCue(text: string | undefined): boolean {
  return !!text && /(?:老子不玩了|我真服了|服了|受不了了|崩溃|烦死|不干了|放弃|fuck(?: this)?|damn|i'?m done|give up|can't take this|this is ridiculous)/iu.test(text);
}

function hasToolOutcome(event: EvidenceEvent, outcomes: string[]): boolean {
  return (event.kind === "tool_result" || event.kind === "tool_error") && !!event.outcome && outcomes.includes(event.outcome);
}

function beatCompatible(kind: StoryBeatKind, evidence: EvidenceEvent[]): boolean {
  if (kind === "setup") return evidence.some((event) => event.kind === "assistant_text" || event.kind === "user_message");
  if (kind === "claim") return evidence.some((event) => event.kind === "assistant_text" && claimCue(eventText(event)));
  if (kind === "attempt" || kind === "workaround") return evidence.some((event) => event.kind === "tool_call");
  if (kind === "failure") {
    return evidence.some((event) =>
      hasToolOutcome(event, ["failure", "blocked"]) ||
      (event.kind === "turn_end" && event.isError) ||
      ((event.actor === "assistant" || event.actor === "user") && failureCue(eventText(event)))
    );
  }
  if (kind === "block") {
    return evidence.some((event) =>
      hasToolOutcome(event, ["blocked"]) ||
      ((event.kind === "turn_end" && event.isError) && blockCue(eventText(event))) ||
      ((event.actor === "assistant" || event.actor === "user") && blockCue(eventText(event)))
    );
  }
  if (kind === "user_pushback") {
    return evidence.some((event) => event.kind === "user_message" && pushbackCue(eventText(event)));
  }
  if (kind === "capability_gap") {
    return evidence.some((event) => event.kind === "assistant_text" && capabilityGapCue(eventText(event)));
  }
  if (kind === "breakdown") {
    return evidence.some((event) => event.kind === "assistant_text" && breakdownCue(eventText(event)));
  }
  if (kind === "correction") {
    return evidence.some((event) => event.kind === "assistant_text" && correctionCue(eventText(event)));
  }
  if (kind === "recovery") {
    return evidence.some((event) =>
      event.kind === "tool_call" || (event.kind === "assistant_text" && recoveryCue(eventText(event)))
    );
  }
  if (kind === "success") {
    return evidence.some((event) => hasToolOutcome(event, ["success"]));
  }
  if (kind === "reversal") {
    return evidence.some((event) => event.kind === "assistant_text" && reversalCue(eventText(event)));
  }
  return false;
}

function beatHasCue(beat: ResolvedBeat, cue: (text: string | undefined) => boolean): boolean {
  return beat.evidence.some((event) => cue(eventText(event)));
}

function hasBefore(beats: ResolvedBeat[], left: StoryBeatKind[], right: StoryBeatKind[]): boolean {
  const leftIndex = beats.findIndex((beat) => left.includes(beat.kind));
  if (leftIndex < 0) return false;
  return beats.slice(leftIndex + 1).some((beat) => right.includes(beat.kind));
}

function arcPatternValid(candidate: SemanticStoryCandidate, beats: ResolvedBeat[]): boolean {
  switch (candidate.arcKind) {
    case "false_dawn": {
      const claimIndex = beats.findIndex((beat) => beat.kind === "claim" && beatHasCue(beat, certaintyCue));
      return claimIndex >= 0 && beats.slice(claimIndex + 1).some((beat) =>
        ["failure", "block", "user_pushback", "correction", "reversal"].includes(beat.kind)
      );
    }
    case "failure_then_workaround":
      return hasBefore(beats, ["failure", "block"], ["workaround"]);
    case "capability_gap_then_improvisation":
      return hasBefore(beats, ["capability_gap"], ["workaround", "success"]);
    case "mistake_then_correction":
      return hasBefore(beats, ["setup", "claim", "attempt"], ["correction"]);
    case "user_pushback_then_recovery":
      return hasBefore(beats, ["user_pushback"], ["correction", "recovery", "workaround"]);
    case "breakdown_then_resume":
      return hasBefore(beats, ["breakdown"], ["recovery", "attempt", "workaround", "success"]);
    case "reversal":
      return hasBefore(beats, ["setup", "claim", "attempt"], ["reversal"]);
    case "other":
      return beats.length >= 3 && beats.some((beat) =>
        ["failure", "block", "user_pushback", "capability_gap", "breakdown", "correction", "workaround", "recovery", "reversal"].includes(beat.kind)
      );
  }
}

function relationalBeatProblem(beats: ResolvedBeat[]): string | undefined {
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    const prior = beats.slice(0, index);
    if (beat.kind === "workaround") {
      const priorFailures = prior
        .filter((entry) => entry.kind === "failure" || entry.kind === "block")
        .flatMap((entry) => entry.evidence)
        .filter((event) => hasToolOutcome(event, ["failure", "blocked"]));
      if (priorFailures.length === 0) {
        return "workaround-without-prior-problem";
      }
      const workaroundCalls = beat.evidence.filter((event) => event.kind === "tool_call");
      if (workaroundCalls.length === 0) return "workaround-without-tool-action";
      const failedCallIds = new Set(priorFailures.map((event) => event.callId).filter((callId): callId is string => !!callId));
      for (const call of workaroundCalls) {
        if (!call.followupOfCallId || !failedCallIds.has(call.followupOfCallId)) {
          return "workaround-not-linked-to-prior-failure";
        }
        if (call.followupRelation === "same_arguments_retry") return "workaround-same-argument-retry";
        if (call.followupRelation === "same_tool_arguments_unknown") return "workaround-arguments-unknown";
        if (call.followupRelation !== "alternative_action" && call.followupRelation !== "variant_arguments_retry") {
          return "workaround-unverified-followup";
        }
      }
    }
    if (beat.kind === "recovery") {
      if (!prior.some((entry) => ["failure", "block", "user_pushback", "breakdown"].includes(entry.kind))) {
        return "recovery-without-prior-setback";
      }
    }
    if (beat.kind === "correction" || beat.kind === "reversal") {
      const validPrior = beat.kind === "correction"
        ? ["setup", "claim", "attempt", "user_pushback"]
        : ["setup", "claim", "attempt"];
      if (!prior.some((entry) => validPrior.includes(entry.kind))) {
        return `${beat.kind}-without-prior-position`;
      }
    }
  }
  return undefined;
}

const STRUCTURAL_ANCHORS = new Set<StoryBeatKind>([
  "failure",
  "block",
  "user_pushback",
  "capability_gap",
  "breakdown",
  "correction",
  "reversal",
]);

function storyOrders(story: VerifiedStoryArc, eventById: Map<string, EvidenceEvent>): { start: number; end: number } {
  const orders = story.evidenceIds.map((id) => eventById.get(id)?.order).filter((order): order is number => order !== undefined);
  return { start: Math.min(...orders), end: Math.max(...orders) };
}

function storyAnchorIds(story: VerifiedStoryArc): Set<string> {
  return new Set(story.beats
    .filter((beat) => STRUCTURAL_ANCHORS.has(beat.kind))
    .flatMap((beat) => beat.evidenceIds));
}

/**
 * A window is only a retrieval container, not an episode identity. Stories are
 * duplicates when their verified evidence substantially overlaps, or when they
 * share a structural turning-point event in the same temporal span.
 */
function sameUnderlyingEpisode(
  left: VerifiedStoryArc,
  right: VerifiedStoryArc,
  eventById: Map<string, EvidenceEvent>,
): boolean {
  const rightEvidence = new Set(right.evidenceIds);
  const sharedEvidence = left.evidenceIds.filter((id) => rightEvidence.has(id));
  if (sharedEvidence.length === 0) return false;
  if (sharedEvidence.length / Math.min(left.evidenceIds.length, right.evidenceIds.length) >= 0.5) return true;

  const rightAnchors = storyAnchorIds(right);
  const sharesAnchor = [...storyAnchorIds(left)].some((id) => rightAnchors.has(id));
  if (!sharesAnchor) return false;

  const leftOrders = storyOrders(left, eventById);
  const rightOrders = storyOrders(right, eventById);
  return leftOrders.start <= rightOrders.end && rightOrders.start <= leftOrders.end;
}

function confidenceWeight(confidence: VerifiedStoryArc["confidence"]): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

function canonicalStoryOrder(
  left: VerifiedStoryArc,
  right: VerifiedStoryArc,
  eventById: Map<string, EvidenceEvent>,
): number {
  const confidence = confidenceWeight(right.confidence) - confidenceWeight(left.confidence);
  if (confidence !== 0) return confidence;
  const evidence = right.evidenceIds.length - left.evidenceIds.length;
  if (evidence !== 0) return evidence;
  const beats = right.beats.length - left.beats.length;
  if (beats !== 0) return beats;
  const leftOrders = storyOrders(left, eventById);
  const rightOrders = storyOrders(right, eventById);
  return leftOrders.start - rightOrders.start || left.arcKind.localeCompare(right.arcKind) || left.id.localeCompare(right.id);
}

function deduplicateStories(
  stories: VerifiedStoryArc[],
  eventById: Map<string, EvidenceEvent>,
): { stories: VerifiedStoryArc[]; duplicateIndexes: number[] } {
  const remaining = new Set(stories.map((_story, index) => index));
  const components: number[][] = [];

  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number;
    remaining.delete(seed);
    const queue = [seed];
    const component: number[] = [];
    while (queue.length > 0) {
      const current = queue.shift() as number;
      component.push(current);
      for (const candidate of [...remaining]) {
        if (sameUnderlyingEpisode(stories[current], stories[candidate], eventById)) {
          remaining.delete(candidate);
          queue.push(candidate);
        }
      }
    }
    components.push(component.sort((left, right) => left - right));
  }

  const canonicalIndexes = components.map((component) => [...component]
    .sort((left, right) => canonicalStoryOrder(stories[left], stories[right], eventById))[0]);
  const duplicateIndexes = components.flatMap((component, componentIndex) =>
    component.filter((index) => index !== canonicalIndexes[componentIndex]));
  const canonical = canonicalIndexes
    .sort((left, right) => left - right)
    .map((index, canonicalIndex) => ({ ...stories[index], id: `story:${canonicalIndex}` }));
  return { stories: canonical, duplicateIndexes };
}

export interface StoryValidationResult {
  stories: VerifiedStoryArc[];
  rejected: Array<{ candidateIndex: number; reason: string }>;
}

/**
 * Deterministic high-precision fallback for a narrow, human-visible structure:
 * the human calls out the Agent's repeated/mistaken behavior and the Agent then
 * explicitly admits it. The candidate still passes the ordinary local window,
 * chronology, beat, and episode validation below.
 */
export function inferHumanTurnStoryCandidates(evidence: SemanticEvidenceBundle): SemanticStoryCandidate[] {
  const eventById = new Map(evidence.events.map((event) => [event.id, event]));
  const candidates: SemanticStoryCandidate[] = [];
  for (const window of evidence.windows) {
    if (!window.reasons.includes("human-turn-episode")) continue;
    const events = window.eventIds.map((id) => eventById.get(id)).filter((event): event is EvidenceEvent => !!event)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    for (const userEvent of events) {
      if (
        userEvent.actor !== "user" ||
        userEvent.kind !== "user_message" ||
        !pushbackCue(eventText(userEvent)) ||
        !behaviorCalloutCue(eventText(userEvent))
      ) continue;
      const correction = events.find((event) =>
        event.order > userEvent.order &&
        event.actor === "assistant" &&
        event.kind === "assistant_text" &&
        correctionCue(eventText(event)) &&
        explicitAdmissionCue(eventText(event))
      );
      if (!correction) continue;
      candidates.push({
        windowId: window.id,
        arcKind: "user_pushback_then_recovery",
        beats: [
          { kind: "user_pushback", evidenceIds: [userEvent.id] },
          { kind: "correction", evidenceIds: [correction.id] },
        ],
        confidence: "high",
      });
    }
  }
  return candidates;
}

/**
 * Local structural validation. A candidate must stay inside one selected story
 * window, use semantically compatible evidence, preserve chronology and satisfy
 * the requested arc's relationship constraints before narration.
 */
export function validateStoryCandidates(
  candidates: SemanticStoryCandidate[],
  bundle: SemanticEvidenceBundle,
): StoryValidationResult {
  const eventById = new Map(bundle.events.map((event) => [event.id, event]));
  const windowById = new Map(bundle.windows.map((window) => [window.id, window]));
  const stories: VerifiedStoryArc[] = [];
  const storyCandidateIndexes: number[] = [];
  const rejected: StoryValidationResult["rejected"] = [];

  candidates.forEach((candidate, candidateIndex) => {
    const window = windowById.get(candidate.windowId);
    if (!window) {
      rejected.push({ candidateIndex, reason: "unknown-window-id" });
      return;
    }
    const allowedWindowEvents = new Set(window.eventIds);
    let previousOrder = Number.NEGATIVE_INFINITY;
    const evidenceUsed: string[] = [];
    const resolvedBeats: ResolvedBeat[] = [];
    let invalidReason: string | undefined;

    for (const beat of candidate.beats) {
      const evidence = beat.evidenceIds.map((id) => eventById.get(id));
      if (evidence.some((entry) => !entry)) {
        invalidReason = "unknown-evidence-id";
        break;
      }
      if (beat.evidenceIds.some((id) => !allowedWindowEvents.has(id))) {
        invalidReason = "evidence-outside-window";
        break;
      }
      const concrete = evidence.filter((entry): entry is EvidenceEvent => entry !== undefined);
      const firstOrder = Math.min(...concrete.map((entry) => entry.order));
      if (firstOrder < previousOrder) {
        invalidReason = "non-chronological-beats";
        break;
      }
      previousOrder = Math.max(...concrete.map((entry) => entry.order));
      if (!beatCompatible(beat.kind, concrete)) {
        invalidReason = `beat-kind-not-supported:${beat.kind}`;
        break;
      }
      resolvedBeats.push({ kind: beat.kind, evidence: concrete });
      for (const id of beat.evidenceIds) if (!evidenceUsed.includes(id)) evidenceUsed.push(id);
    }

    if (!invalidReason) invalidReason = relationalBeatProblem(resolvedBeats);
    if (!invalidReason && !arcPatternValid(candidate, resolvedBeats)) invalidReason = "arc-pattern-not-supported";
    if (invalidReason) {
      rejected.push({ candidateIndex, reason: invalidReason });
      return;
    }

    stories.push({
      id: `story:${stories.length}`,
      windowId: candidate.windowId,
      arcKind: candidate.arcKind,
      beats: candidate.beats.map((beat) => ({ kind: beat.kind, evidenceIds: [...beat.evidenceIds] })),
      evidenceIds: evidenceUsed,
      confidence: candidate.confidence,
    });
    storyCandidateIndexes.push(candidateIndex);
  });

  const deduplicated = deduplicateStories(stories, eventById);
  for (const storyIndex of deduplicated.duplicateIndexes) {
    rejected.push({ candidateIndex: storyCandidateIndexes[storyIndex], reason: "duplicate-story-episode" });
  }
  return { stories: deduplicated.stories, rejected };
}
