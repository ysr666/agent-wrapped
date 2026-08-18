import type { Event, EventClaim, EventStance } from "../events/types.js";

export type MomentRelationType =
  | "repeats"
  | "similar_to"
  | "same_topic"
  | "contradicts"
  | "retracts"
  | "followed_by"
  | "celebrates_before";

export interface MomentRelation {
  id: string;
  fromEventId: string;
  toEventId: string;
  type: MomentRelationType;
  strength: number;
  confidence: number;
  distance: number;
  topic?: string;
  topicLabel?: string;
  fromStance?: EventStance;
  toStance?: EventStance;
  fromClaim?: EventClaim;
  toClaim?: EventClaim;
  reasons: string[];
}

export interface MomentGraph {
  events: Event[];
  relations: MomentRelation[];
}

export interface MomentGraphOptions {
  /** Max message distance considered for semantic/topic relations. Defaults to 120. */
  maxMessageDistance?: number;
  /** Max message distance for celebration -> reversal links. Defaults to 18. */
  celebrationWindowMessages?: number;
  /** Conservative fuzzy repetition matching. Defaults to true. */
  fuzzyRepetition?: boolean;
}
