import type { AgentHost } from "../core/types.js";

export type EventType =
  | "discovery_claim"
  | "confidence_claim"
  | "progress_claim"
  | "resolution_claim"
  | "correction"
  | "reversal"
  | "celebration"
  | "confusion"
  | "apology"
  | "promise"
  | "neutral";

export type EventStance = "affirm" | "exclude" | "blame" | "uncertain";

export interface EventSignal {
  strength: number;
  confidence: number;
  cues: string[];
}

export interface TopicRef {
  topic: string;
  label: string;
  confidence: number;
}

export interface EventClaim {
  topic: string;
  topicLabel: string;
  stance: EventStance;
  strength: number;
  confidence: number;
  cue: string;
}

/**
 * A transcript unit plus the structured things that happened in that unit.
 *
 * One sentence may contain several signals at once (for example discovery +
 * confidence + reversal), so signals are multi-label. `primaryType` is only a
 * convenient summary and must not be treated as the sole meaning of the line.
 */
export interface Event {
  id: string;
  text: string;
  normalizedText: string;
  simplifiedText: string;
  messageIndex: number;
  unitIndex: number;
  host?: AgentHost;
  timestamp?: string;

  primaryType: EventType;
  signals: Partial<Record<EventType, EventSignal>>;
  claims: EventClaim[];
  topics: TopicRef[];

  /** Catchphrase-family hint such as `clarity:positive`. */
  verbalFamily?: string;

  /** Surface theatrical intensity, 0-100. */
  drama: number;
  /** How well the line works on its own without session context, 0-100. */
  standaloneQuality: number;
  /** Confidence in the event extraction itself, 0-100. */
  confidence: number;
}
