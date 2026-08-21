import type { AgentHost } from "../core/types.js";
import type { MomentType } from "../moments/types.js";
import type { SessionEventActor, SessionEventKind } from "../session-events/types.js";
import type { AwardLocale } from "../awards/types.js";
import type {
  SemanticTestSummary,
  SemanticFollowupRelation,
  SemanticToolCategory,
  SemanticToolOperation,
} from "./toolOutcome.js";

export interface SemanticEvidenceEvent {
  id: string;
  order: number;
  actor: SessionEventActor;
  kind: SessionEventKind;
  text?: string;
  toolName?: string;
  /** Safe local classification; raw tool payloads never cross this boundary. */
  toolCategory?: SemanticToolCategory;
  /** Coarse, allowlisted local action class; never a command, path, or argument. */
  toolOperation?: SemanticToolOperation;
  callId?: string;
  /** Opaque alias of the failed call this action directly follows, when known. */
  followupOfCallId?: string;
  /** Locally determined retry/alternative relationship; no arguments are exposed. */
  followupRelation?: SemanticFollowupRelation;
  isError?: boolean;
  /** For tool events: one of the locally classified SemanticToolOutcome values. */
  outcome?: string;
  exitCode?: number;
  errorClass?: string;
  testSummary?: SemanticTestSummary;
}

export interface SemanticMomentHint {
  id: string;
  type: MomentType;
  primaryText: string;
  relatedTexts: string[];
  eventIds: string[];
}

export interface SemanticStoryWindow {
  id: string;
  eventIds: string[];
  /** Local structural reasons this window was selected; never an LLM conclusion. */
  reasons: string[];
}

/**
 * Bounded, redacted evidence supplied to Story Miner. Unlike P8 v1, Story
 * Discovery is not gated by P3 top moments: event windows are selected directly
 * from the observable session stream, while Moment hints are only a secondary signal.
 */
export interface SemanticEvidenceBundle {
  version: 2;
  sessionId: string;
  host: AgentHost;
  title?: string;
  model?: string;
  locale: AwardLocale;
  events: SemanticEvidenceEvent[];
  windows: SemanticStoryWindow[];
  momentHints: SemanticMomentHint[];
  redactionCount: number;
  truncated: boolean;
}

export type StoryArcKind =
  | "false_dawn"
  | "ending_then_more_work"
  | "failure_then_workaround"
  | "mistake_then_correction"
  | "user_pushback_then_recovery"
  | "capability_gap_then_improvisation"
  | "breakdown_then_resume"
  | "reversal"
  | "other";

export type StoryBeatKind =
  | "setup"
  | "claim"
  | "attempt"
  | "failure"
  | "block"
  | "user_pushback"
  | "work_reopened"
  | "capability_gap"
  | "breakdown"
  | "correction"
  | "workaround"
  | "recovery"
  | "success"
  | "reversal";

/** First LLM pass: one local episode's structure only. No titles, summaries, persona, or scores. */
export interface SemanticStoryCandidate {
  /** Every beat must be supported by events inside this one bounded story window. */
  windowId: string;
  arcKind: StoryArcKind;
  beats: Array<{
    kind: StoryBeatKind;
    evidenceIds: string[];
  }>;
  confidence: "high" | "medium" | "low";
}

export interface VerifiedStoryBeat {
  kind: StoryBeatKind;
  evidenceIds: string[];
}

export interface VerifiedStoryArc {
  id: string;
  /** Preserved so downstream aggregation can deduplicate alternate views of one episode. */
  windowId: string;
  arcKind: StoryArcKind;
  beats: VerifiedStoryBeat[];
  evidenceIds: string[];
  confidence: "high" | "medium" | "low";
}

export type PersonaSignalLevel = "low" | "medium" | "high";
export type PersonaSignalKey =
  | "dramaticity"
  | "self_correction"
  | "persistence"
  | "improvisation"
  | "premature_certainty"
  | "repetition";

/** Deterministic, episode-deduplicated aggregation from verified stories + P3 moments; not LLM scores. */
export interface SemanticPersonaSignal {
  key: PersonaSignalKey;
  label: string;
  count: number;
  level: PersonaSignalLevel;
  evidenceIds: string[];
}

/** Second LLM pass: editorial language only. Facts stay in verified structures. */
export interface SemanticNarration {
  storyCards: Array<{
    storyId: string;
    title: string;
    commentary?: string;
  }>;
  persona?: {
    /** Must remain session-scoped, e.g. “本场表现像……”. */
    label: string;
    tagline: string;
  };
}

export interface SemanticStoryPersonaReport {
  version: 3;
  locale: AwardLocale;
  sessionId: string;
  stories: VerifiedStoryArc[];
  personaSignals: SemanticPersonaSignal[];
  narration?: SemanticNarration;
  /** Editorial narration is optional; verified local structure remains usable if it is unavailable. */
  narrationUnavailable?: boolean;
  /** Local-only diagnostics; suppressed stories were factually verified but not distinctive enough to become cards. */
  diagnostics?: {
    verifiedStoryCount: number;
    suppressedStoryCount: number;
    suppressionReasons: Record<string, number>;
  };
  insufficientEvidence?: string;
  evidenceUsed: string[];
}

export interface SemanticNarratorRequest {
  system: string;
  user: string;
}

/** Provider-neutral seam so callers may use a local model or any hosted LLM. */
export interface SemanticNarrator {
  generate(request: SemanticNarratorRequest): Promise<string>;
}
