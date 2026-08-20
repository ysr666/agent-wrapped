import type {
  PersonaSignalKey,
  SemanticEvidenceBundle,
  SemanticPersonaSignal,
  VerifiedStoryArc,
} from "./types.js";

const LABELS: Record<PersonaSignalKey, string> = {
  dramaticity: "内心戏",
  self_correction: "自我纠错",
  persistence: "执着程度",
  improvisation: "临场变通",
  premature_certainty: "提前下结论",
  repetition: "口癖重复",
};

function level(count: number): SemanticPersonaSignal["level"] {
  if (count >= 3) return "high";
  if (count >= 2) return "medium";
  return "low";
}

function storyEvidence(stories: VerifiedStoryArc[], kinds: VerifiedStoryArc["arcKind"][]): string[] {
  return stories.filter((story) => kinds.includes(story.arcKind)).flatMap((story) => story.evidenceIds);
}

function momentEvidence(bundle: SemanticEvidenceBundle, types: SemanticEvidenceBundle["momentHints"][number]["type"][]): string[] {
  return bundle.momentHints.filter((moment) => types.includes(moment.type)).map((moment) => moment.id);
}

function unique(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

/**
 * Persona is aggregated from observed structures. No language model decides the
 * numeric magnitude, and we intentionally expose coarse low/medium/high levels
 * instead of fake 0-100 precision.
 */
export function aggregatePersonaSignals(
  stories: VerifiedStoryArc[],
  bundle: SemanticEvidenceBundle,
): SemanticPersonaSignal[] {
  const specs: Array<{ key: PersonaSignalKey; storyKinds: VerifiedStoryArc["arcKind"][]; momentTypes: SemanticEvidenceBundle["momentHints"][number]["type"][] }> = [
    {
      key: "dramaticity",
      storyKinds: ["false_dawn", "mistake_then_correction", "breakdown_then_resume", "reversal"],
      momentTypes: ["plot_twist", "false_dawn", "correction_arc", "boomerang"],
    },
    {
      key: "self_correction",
      storyKinds: ["mistake_then_correction", "reversal", "user_pushback_then_recovery"],
      momentTypes: ["correction_arc", "boomerang"],
    },
    {
      key: "persistence",
      storyKinds: ["failure_then_workaround", "user_pushback_then_recovery", "breakdown_then_resume"],
      momentTypes: [],
    },
    {
      key: "improvisation",
      storyKinds: ["capability_gap_then_improvisation", "failure_then_workaround"],
      momentTypes: [],
    },
    {
      key: "premature_certainty",
      storyKinds: ["false_dawn"],
      momentTypes: ["false_dawn"],
    },
    {
      key: "repetition",
      storyKinds: [],
      momentTypes: ["repeated_pattern"],
    },
  ];

  return specs.flatMap((spec) => {
    const storyMatches = stories.filter((story) => spec.storyKinds.includes(story.arcKind));
    const momentMatches = bundle.momentHints.filter((moment) => spec.momentTypes.includes(moment.type));
    const count = storyMatches.length + momentMatches.length;
    if (count === 0) return [];
    return [{
      key: spec.key,
      label: LABELS[spec.key],
      count,
      level: level(count),
      evidenceIds: unique([
        ...storyEvidence(stories, spec.storyKinds),
        ...momentEvidence(bundle, spec.momentTypes),
      ]),
    }];
  });
}
