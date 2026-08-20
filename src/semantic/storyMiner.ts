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
  return !!text && /(?:还是(?:不行|失败|报错|挂|错)|不对|错了|不是|没(?:修好|成功|对)|又(?:错|挂|失败)|怎么又|我说的是|别这样|wrong|still\s+(?:fails?|broken|wrong)|that's\s+wrong|not\s+what|didn't|doesn't)/iu.test(text);
}

function correctionCue(text: string | undefined): boolean {
  return !!text && /(?:等等|不对|我错了|判断错|看错|收回|改口|重新检查|真正(?:的)?(?:问题|根因)|其实|wait|hold on|i was wrong|scratch that|retract|actually)/iu.test(text);
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

function capabilityGapCue(text: string | undefined): boolean {
  return !!text && /(?:不能|无法|做不到|没有(?:这个|相应)?(?:工具|能力|权限)|不支持|can't|cannot|unable to|don't have (?:a |the )?(?:tool|ability|permission)|not supported)/iu.test(text);
}

function breakdownCue(text: string | undefined): boolean {
  return !!text && /(?:老子不玩了|我真服了|服了|受不了了|崩溃|烦死|不干了|放弃|fuck(?: this)?|damn|i'?m done|give up|can't take this|this is ridiculous)/iu.test(text);
}

function successCue(text: string | undefined): boolean {
  return !!text && /(?:成功|通过了|好了|已删除|完成|passed|success|succeeded|deleted|works now|fixed now)/iu.test(text);
}

function beatCompatible(kind: StoryBeatKind, evidence: EvidenceEvent[]): boolean {
  if (kind === "setup") return evidence.some((event) => event.kind === "assistant_text" || event.kind === "user_message");
  if (kind === "claim") return evidence.some((event) => event.kind === "assistant_text");
  if (kind === "attempt" || kind === "workaround") return evidence.some((event) => event.kind === "tool_call");
  if (kind === "failure") {
    return evidence.some((event) =>
      event.kind === "tool_error" ||
      (event.kind === "turn_end" && event.isError) ||
      ((event.actor === "assistant" || event.actor === "user") && failureCue(eventText(event)))
    );
  }
  if (kind === "block") {
    return evidence.some((event) =>
      ((event.kind === "tool_error" || (event.kind === "turn_end" && event.isError)) && blockCue(eventText(event))) ||
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
    return evidence.some((event) =>
      (event.kind === "tool_result" && !event.isError) ||
      (event.kind === "turn_end" && !event.isError && /(?:completed|success)/iu.test(eventText(event))) ||
      (event.kind === "user_message" && successCue(eventText(event)))
    );
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

function toolSignature(event: EvidenceEvent): string {
  return `${event.toolName ?? ""}|${event.text ?? ""}`.trim();
}

function relationalBeatProblem(beats: ResolvedBeat[]): string | undefined {
  for (let index = 0; index < beats.length; index += 1) {
    const beat = beats[index];
    const prior = beats.slice(0, index);
    if (beat.kind === "workaround") {
      if (!prior.some((entry) => ["failure", "block", "user_pushback", "capability_gap"].includes(entry.kind))) {
        return "workaround-without-prior-problem";
      }
      const earlierAttempts = prior
        .filter((entry) => entry.kind === "attempt")
        .flatMap((entry) => entry.evidence.filter((event) => event.kind === "tool_call"));
      const workaroundCalls = beat.evidence.filter((event) => event.kind === "tool_call");
      if (earlierAttempts.length > 0 && workaroundCalls.length > 0) {
        const priorSignatures = new Set(earlierAttempts.map(toolSignature));
        if (workaroundCalls.every((event) => priorSignatures.has(toolSignature(event)))) {
          return "workaround-repeats-attempt";
        }
      }
    }
    if (beat.kind === "recovery") {
      if (!prior.some((entry) => ["failure", "block", "user_pushback", "breakdown"].includes(entry.kind))) {
        return "recovery-without-prior-setback";
      }
    }
    if (beat.kind === "correction" || beat.kind === "reversal") {
      if (!prior.some((entry) => ["setup", "claim", "attempt"].includes(entry.kind))) {
        return `${beat.kind}-without-prior-position`;
      }
    }
  }
  return undefined;
}

export interface StoryValidationResult {
  stories: VerifiedStoryArc[];
  rejected: Array<{ candidateIndex: number; reason: string }>;
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
  });

  return { stories, rejected };
}
