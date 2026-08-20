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

function unique(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}

interface PersonaEvidenceUnit {
  eventIds: string[];
  outputEvidenceIds: string[];
}

function storyUnit(story: VerifiedStoryArc): PersonaEvidenceUnit {
  return {
    eventIds: [...story.evidenceIds],
    outputEvidenceIds: [...story.evidenceIds],
  };
}

function momentUnit(
  moment: SemanticEvidenceBundle["momentHints"][number],
): PersonaEvidenceUnit {
  return {
    eventIds: [...moment.eventIds],
    outputEvidenceIds: unique([moment.id, ...moment.eventIds]),
  };
}

function overlaps(left: PersonaEvidenceUnit, right: PersonaEvidenceUnit): boolean {
  const rightEvents = new Set(right.eventIds);
  return left.eventIds.some((id) => rightEvents.has(id));
}

function episodeComponents(units: PersonaEvidenceUnit[]): PersonaEvidenceUnit[][] {
  const remaining = new Set(units.map((_unit, index) => index));
  const components: PersonaEvidenceUnit[][] = [];

  while (remaining.size > 0) {
    const seed = remaining.values().next().value as number;
    remaining.delete(seed);
    const queue = [seed];
    const component: PersonaEvidenceUnit[] = [];
    while (queue.length > 0) {
      const currentIndex = queue.shift() as number;
      const current = units[currentIndex];
      component.push(current);
      for (const candidateIndex of [...remaining]) {
        if (component.some((member) => overlaps(member, units[candidateIndex])) || overlaps(current, units[candidateIndex])) {
          remaining.delete(candidateIndex);
          queue.push(candidateIndex);
        }
      }
    }
    components.push(component);
  }

  return components;
}

/**
 * Persona magnitude counts evidence-connected local episodes, not every
 * representation. Retrieval windows never define an episode: a Story and a P3
 * Moment merge only when they actually share local evidence.
 */
export function aggregatePersonaSignals(
  stories: VerifiedStoryArc[],
  bundle: SemanticEvidenceBundle,
): SemanticPersonaSignal[] {
  const specs: Array<{
    key: PersonaSignalKey;
    storyKinds: VerifiedStoryArc["arcKind"][];
    momentTypes: SemanticEvidenceBundle["momentHints"][number]["type"][];
  }> = [
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
    const units: PersonaEvidenceUnit[] = [
      ...stories.filter((story) => spec.storyKinds.includes(story.arcKind)).map(storyUnit),
      ...bundle.momentHints.filter((moment) => spec.momentTypes.includes(moment.type)).map(momentUnit),
    ];
    if (units.length === 0) return [];

    const components = episodeComponents(units);
    const evidenceIds = unique(components.flatMap((component) => component.flatMap((unit) => unit.outputEvidenceIds)));
    const count = components.length;
    return [{
      key: spec.key,
      label: LABELS[spec.key],
      count,
      level: level(count),
      evidenceIds,
    }];
  });
}
