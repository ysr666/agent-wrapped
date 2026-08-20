import type { TranscriptMessage } from "../core/types.js";
import type { SessionEvent, SessionEventKind } from "./types.js";

function eventKind(role: TranscriptMessage["role"]): SessionEventKind {
  if (role === "user") return "user_message";
  if (role === "assistant") return "assistant_text";
  if (role === "tool") return "tool_result";
  return "unknown";
}

/** Fallback normalization for adapters that do not yet expose richer events. */
export function sessionEventsFromMessages(messages: TranscriptMessage[]): SessionEvent[] {
  return messages.map((message, messageIndex) => ({
    id: message.id ? `message-event:${message.id}` : `message-event:${messageIndex}`,
    host: message.host ?? "unknown",
    actor: message.role === "system" ? "system" : message.role,
    kind: eventKind(message.role),
    order: messageIndex,
    timestamp: message.timestamp,
    messageIndex,
    text: message.text,
    metadata: message.metadata,
  }));
}
