import type { AgentHost } from "../core/types.js";
import type { MomentType } from "../moments/types.js";
import type { AwardLocale } from "../awards/types.js";

export interface SemanticEvidenceMessage {
  id: string;
  messageIndex: number;
  role: "user" | "assistant" | "tool";
  text: string;
}

export interface SemanticEvidenceMoment {
  id: string;
  type: MomentType;
  primaryText: string;
  relatedTexts: string[];
  structuralEvidence: string[];
  messageIndexes: number[];
  contextMessageIds: string[];
}

/**
 * Bounded, reviewable evidence sent to an optional semantic narrator.
 * The full source transcript is intentionally not part of this contract.
 */
export interface SemanticEvidenceBundle {
  version: 1;
  sessionId: string;
  host: AgentHost;
  title?: string;
  model?: string;
  locale: AwardLocale;
  moments: SemanticEvidenceMoment[];
  messages: SemanticEvidenceMessage[];
  truncated: boolean;
}

export interface SemanticStoryBeat {
  title: string;
  summary: string;
  evidenceIds: string[];
}

export interface SemanticStoryArc {
  title: string;
  synopsis: string;
  beats: SemanticStoryBeat[];
  /** Clearly labeled editorial copy; never presented as a source quote. */
  commentary?: string;
}

export interface SemanticPersonaDimension {
  key: string;
  label: string;
  score: number;
  rationale: string;
  evidenceIds: string[];
}

export interface SemanticPersonaProfile {
  /** Must describe this session's observed role/vibe, not an inherent model trait. */
  label: string;
  tagline: string;
  dimensions: SemanticPersonaDimension[];
  evidenceIds: string[];
}

export interface SemanticStoryPersonaReport {
  version: 1;
  locale: AwardLocale;
  sessionId: string;
  story?: SemanticStoryArc;
  persona?: SemanticPersonaProfile;
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
