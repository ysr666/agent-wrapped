import type { MomentScores, MomentType } from "../moments/types.js";

export type AwardLocale = "zh-CN" | "en";

export type AwardKind =
  | "quote"
  | "catchphrase"
  | "boomerang"
  | "wolf-cry"
  | "premature-celebration"
  | "plot-twist"
  | "emotional-peak";

export interface Award {
  id: string;
  kind: AwardKind;
  title: string;
  emoji: string;

  /** Source P2/P3 moment. */
  momentId: string;
  sourceType: MomentType;
  messageIndexes: number[];

  /** Original transcript wording. P3.5 never rewrites this text. */
  primaryText: string;
  relatedTexts: string[];
  /** Structured repeated verbal family retained for presentation/localization. */
  family?: string;
  count?: number;
  variants?: string[];
  topic?: string;
  topicLabel?: string;

  funScore: number;
  confidence: number;
  scores: MomentScores;
  evidence: string[];
}

export type AwardRejectionReason =
  | "below-fun-threshold"
  | "below-confidence-threshold"
  | "duplicate-award-kind"
  | "overlaps-selected-moment"
  | "award-limit";

export interface RejectedAwardCandidate {
  momentId: string;
  reason: AwardRejectionReason;
}

export interface AwardComposition {
  awards: Award[];
  consideredMoments: number;
  rejected: RejectedAwardCandidate[];
}

export interface AwardComposerOptions {
  /** Maximum final cards. Defaults to 5 and is always capped at 7. */
  maxAwards?: number;
  /** Minimum entertainment score. Defaults to 42. */
  minFunScore?: number;
  /** Minimum extraction/relationship confidence. Defaults to 0. */
  minConfidence?: number;
  /** Maximum cards with the same user-visible award kind. Defaults to 1. */
  maxPerKind?: number;
  /**
   * Maximum containment overlap against an already-selected moment.
   * 1 means one candidate is fully contained in another. Defaults to 0.74.
   */
  maxContainmentOverlap?: number;
  /** Presentation language for fixed award labels. Defaults to zh-CN. */
  locale?: AwardLocale;
}
