import type { AgentHost } from "../core/types.js";

export type SessionEventActor = "user" | "assistant" | "tool" | "system";

export type SessionEventKind =
  | "user_message"
  | "assistant_text"
  | "tool_call"
  | "tool_result"
  | "tool_error"
  | "turn_end"
  | "unknown";

/**
 * Host-neutral, chronologically ordered evidence used by the story pipeline.
 *
 * This model deliberately describes observable session behavior instead of
 * award categories. Host adapters may add metadata, but Story Discovery should
 * depend on these portable fields whenever possible.
 */
export interface SessionEvent {
  id: string;
  host: AgentHost;
  actor: SessionEventActor;
  kind: SessionEventKind;
  /** Stable chronological order inside the normalized session. */
  order: number;
  timestamp?: string;
  turn?: number;
  step?: number;
  /** Index into IngestedSession.messages when this event projects a message. */
  messageIndex?: number;
  text?: string;
  toolName?: string;
  callId?: string;
  toolArguments?: string;
  isError?: boolean;
  outcome?: string;
  metadata?: Record<string, unknown>;
}
