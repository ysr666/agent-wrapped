import type { SemanticEvidenceBundle, VerifiedStoryArc } from "./types.js";

/**
 * P8's local validator answers "did this happen?". This admission pass answers
 * the narrower product question: "is this verified structure distinctive enough
 * to deserve a Wrapped story card?" A routine tool failure followed by another
 * tool action is truthful, but is usually worklog, not a replay-worthy plot.
 */
export type SemanticStorySuppressionReason =
  | "low-confidence"
  | "routine-tool-trajectory";

export interface SemanticStoryAdmission {
  stories: VerifiedStoryArc[];
  suppressed: Array<{
    storyId: string;
    reason: SemanticStorySuppressionReason;
  }>;
}

const INTRINSICALLY_DRAMATIC_ARCS = new Set<VerifiedStoryArc["arcKind"]>([
  "false_dawn",
  "mistake_then_correction",
  "user_pushback_then_recovery",
  "capability_gap_then_improvisation",
  "breakdown_then_resume",
  "reversal",
]);

const HUMAN_VISIBLE_TURN_BEATS = new Set<VerifiedStoryArc["beats"][number]["kind"]>([
  "claim",
  "user_pushback",
  "capability_gap",
  "breakdown",
  "correction",
  "reversal",
]);

const DRAMATIC_MOMENT_HINTS = new Set<SemanticEvidenceBundle["momentHints"][number]["type"]>([
  "boomerang",
  "false_dawn",
  "plot_twist",
  "correction_arc",
]);

function hasHumanVisibleTurn(story: VerifiedStoryArc): boolean {
  return story.beats.some((beat) => HUMAN_VISIBLE_TURN_BEATS.has(beat.kind));
}

function overlapsDramaticMomentHint(
  story: VerifiedStoryArc,
  evidence: SemanticEvidenceBundle,
): boolean {
  const storyEvidence = new Set(story.evidenceIds);
  return evidence.momentHints.some((hint) =>
    DRAMATIC_MOMENT_HINTS.has(hint.type) && hint.eventIds.some((id) => storyEvidence.has(id))
  );
}

/**
 * Keeps structural discovery broad while making the user-facing Story card
 * selective. This deliberately does not invent an LLM "fun score": it only
 * admits an already grounded story when there is an explicit turn a person can
 * recognize, or a grounded P3 dramatic moment tied to the same evidence.
 */
export function admitStoriesForWrapped(
  stories: VerifiedStoryArc[],
  evidence: SemanticEvidenceBundle,
): SemanticStoryAdmission {
  const accepted: VerifiedStoryArc[] = [];
  const suppressed: SemanticStoryAdmission["suppressed"] = [];

  for (const story of stories) {
    if (story.confidence === "low") {
      suppressed.push({ storyId: story.id, reason: "low-confidence" });
      continue;
    }

    if (
      INTRINSICALLY_DRAMATIC_ARCS.has(story.arcKind) ||
      hasHumanVisibleTurn(story) ||
      overlapsDramaticMomentHint(story, evidence)
    ) {
      accepted.push(story);
      continue;
    }

    suppressed.push({ storyId: story.id, reason: "routine-tool-trajectory" });
  }

  return { stories: accepted, suppressed };
}
