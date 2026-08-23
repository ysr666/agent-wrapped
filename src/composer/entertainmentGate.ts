import type { Award } from "../awards/types.js";
import { extractEventFromText, getEventStrength } from "../events/eventExtractor.js";
import type {
  SemanticEvidenceBundle,
  SemanticStoryPersonaReport,
  VerifiedStoryArc,
} from "../semantic/types.js";

export type EntertainmentGateReason =
  | "award-laugh-carrier"
  | "grounded-comedic-tension"
  | "narrator-dropped"
  | "no-laugh-carrier";

export type EntertainmentGateDecision =
  | { show: true; reason: "award-laugh-carrier" | "grounded-comedic-tension" }
  | { show: false; reason: "narrator-dropped" | "no-laugh-carrier" };

const DRAMATIC_MOMENT_HINTS = new Set<SemanticEvidenceBundle["momentHints"][number]["type"]>([
  "boomerang",
  "false_dawn",
  "plot_twist",
]);

function hasBeat(story: VerifiedStoryArc, kind: VerifiedStoryArc["beats"][number]["kind"]): boolean {
  return story.beats.some((beat) => beat.kind === kind);
}

function overlapsDramaticMoment(story: VerifiedStoryArc, evidence: SemanticEvidenceBundle): boolean {
  const ids = new Set(story.evidenceIds);
  return evidence.momentHints.some((hint) =>
    DRAMATIC_MOMENT_HINTS.has(hint.type) && hint.eventIds.some((id) => ids.has(id))
  );
}

function hasExplicitTextReversal(story: VerifiedStoryArc, evidence: SemanticEvidenceBundle): boolean {
  const ids = new Set(story.evidenceIds);
  return evidence.events.some((event) => {
    if (!ids.has(event.id) || event.actor !== "assistant" || !event.text) return false;
    return getEventStrength(extractEventFromText(event.text), "reversal") >= 70;
  });
}

/**
 * A verified Story is not automatically entertaining. This intentionally keeps
 * the deterministic fallback narrow: ordinary apologies, retries, user
 * corrections, and reopened work are recognizable facts, but not laugh
 * carriers by themselves.
 */
export function hasGroundedComedicTension(
  story: VerifiedStoryArc,
  evidence: SemanticEvidenceBundle,
): boolean {
  if (overlapsDramaticMoment(story, evidence)) return true;

  switch (story.arcKind) {
    case "false_dawn":
      return hasBeat(story, "claim") &&
        (hasBeat(story, "failure") || hasBeat(story, "user_pushback") || hasBeat(story, "reversal"));
    case "capability_gap_then_improvisation":
      return hasBeat(story, "capability_gap") && hasBeat(story, "workaround");
    case "breakdown_then_resume":
      return hasBeat(story, "breakdown") &&
        (hasBeat(story, "recovery") || hasBeat(story, "workaround") || hasBeat(story, "success"));
    case "reversal":
      return hasBeat(story, "reversal") && hasExplicitTextReversal(story, evidence);
    case "ending_then_more_work":
    case "failure_then_workaround":
    case "mistake_then_correction":
    case "user_pushback_then_recovery":
    case "other":
      return false;
  }
}

export function evaluateStoryEntertainment(
  story: VerifiedStoryArc,
  report: SemanticStoryPersonaReport,
  evidence: SemanticEvidenceBundle,
): EntertainmentGateDecision {
  if (!hasGroundedComedicTension(story, evidence)) {
    return { show: false, reason: "no-laugh-carrier" };
  }

  // When the editorial pass is available, omission is a deliberate judgement:
  // the structure was true, but not funny enough to publish. Local-only mode
  // retains only the narrow, structurally undeniable set above.
  if (report.narration && !report.narration.storyCards.some((card) => card.storyId === story.id)) {
    return { show: false, reason: "narrator-dropped" };
  }

  return { show: true, reason: "grounded-comedic-tension" };
}

/** P4 awards already passed a dedicated entertainment ranker; this final check
 * rejects structurally empty cards and weak standalone prose before composition.
 */
export function evaluateAwardEntertainment(award: Award): EntertainmentGateDecision {
  const { standaloneQuality, surprise, structuralStrength } = award.scores;
  let show = false;

  switch (award.kind) {
    case "quote":
      show = standaloneQuality >= 55 && (surprise >= 45 || award.funScore >= 65);
      break;
    case "catchphrase":
      show = (award.count ?? 0) >= 3;
      break;
    case "emotional-peak":
      show = standaloneQuality >= 55 && surprise >= 45;
      break;
    case "boomerang":
    case "premature-celebration":
      show = award.relatedTexts.length > 0 && surprise >= 65 && structuralStrength >= 55;
      break;
    case "plot-twist":
      show = standaloneQuality >= 50 && surprise >= 65 && structuralStrength >= 55;
      break;
    case "wolf-cry":
      show = (award.count ?? 0) >= 2 && award.relatedTexts.length > 0;
      break;
  }

  return show
    ? { show: true, reason: "award-laugh-carrier" }
    : { show: false, reason: "no-laugh-carrier" };
}
