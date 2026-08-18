export type MomentType =
  | "one_liner"
  | "repeated_pattern"
  | "boomerang"
  | "false_dawn"
  | "plot_twist"
  | "correction_arc";

/**
 * A composed, human-readable session moment built from one or more events.
 *
 * P2 owns composition only. It does not decide which moment is funniest or
 * whether the moment should become a particular award card.
 */
export interface Moment {
  id: string;
  type: MomentType;
  eventIds: string[];
  relationIds: string[];
  messageIndexes: number[];

  /** The line used as the main display anchor for the moment. */
  primaryText: string;
  /** Additional lines needed for context, contrast, or progression. */
  relatedTexts: string[];

  topic?: string;
  topicLabel?: string;
  /** Optional repeated verbal-family hint, for example `root-cause-found:positive`. */
  family?: string;
  count?: number;
  variants?: string[];

  /** Short structural explanations produced by the builder. */
  evidence: string[];
}

export interface MomentScores {
  /** Overall entertainment ranking signal. This is not extraction confidence. */
  funScore: number;
  /** Confidence that the detected structure/relationship is genuinely present. */
  confidence: number;
  /** How well the selected wording works without surrounding transcript context. */
  standaloneQuality: number;
  /** How much the before/after/session structure adds to the payoff. */
  contextPayoff: number;
  /** Reversal, surprise, or unexpected-turn energy. */
  surprise: number;
  /** Relative scarcity of this kind of moment inside the session candidate set. */
  rarity: number;
  /** Screenshot/readback friendliness of the selected text span. */
  readability: number;
  /** Strength of the graph/event structure supporting the moment. */
  structuralStrength: number;
}

export interface RankedMoment extends Moment {
  scores: MomentScores;
}
