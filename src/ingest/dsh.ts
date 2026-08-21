import type { TranscriptMessage } from "../core/types.js";
import type { SessionEvent } from "../session-events/types.js";
import type { IngestedSession, IngestionDiagnostic, SessionArtifactEncoding } from "./types.js";

export interface ParseDshSessionOptions {
  sourcePath?: string;
  encoding?: SessionArtifactEncoding;
  /**
   * Include DSH `reasoning` blocks only when the caller knows that surface was
   * exposed to the user. Defaults to false; Agent Wrapped never treats durable
   * reasoning bytes as permission to claim hidden chain-of-thought access.
   */
  includeVisibleReasoning?: boolean;
}

interface JsonObject {
  [key: string]: unknown;
}

interface AssistantMessageView {
  content: unknown;
  provider?: string;
  model?: string;
  messageId?: string;
  shape: "current" | "legacy";
}

interface ToolResultView {
  callId?: string;
  content: unknown;
  isError: boolean;
  messageId?: string;
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function eventTimestamp(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  try {
    return new Date(value).toISOString();
  } catch {
    return undefined;
  }
}

function contentBlocks(value: unknown): JsonObject[] {
  if (!Array.isArray(value)) return [];
  return value.map(object).filter((entry): entry is JsonObject => entry !== undefined);
}

function textBlocks(value: unknown, acceptedTypes: Set<string>): Array<{ type: string; text: string; index: number }> {
  const output: Array<{ type: string; text: string; index: number }> = [];
  for (const [index, block] of contentBlocks(value).entries()) {
    const type = string(block.type);
    const text = string(block.text);
    if (!type || !text || !acceptedTypes.has(type)) continue;
    output.push({ type, text, index });
  }
  return output;
}

function nestedVisibleText(value: unknown): string {
  const output: string[] = [];
  for (const block of contentBlocks(value)) {
    const type = string(block.type);
    if ((type === "text" || type === "reasoning") && string(block.text)) {
      output.push(string(block.text) as string);
      continue;
    }
    if (type === "tool-result") {
      const nested = nestedVisibleText(block.content);
      if (nested) output.push(nested);
    }
  }
  return output.join("\n").trim();
}

function eventSeq(record: JsonObject, fallback: number): string {
  const seq = record.seq;
  return typeof seq === "number" && Number.isFinite(seq) ? String(seq) : String(fallback);
}

function eventOrder(record: JsonObject, fallback: number): number {
  return number(record.seq) ?? fallback;
}

function eventBase(record: JsonObject, lineIndex: number): Pick<SessionEvent, "host" | "order" | "timestamp"> {
  return {
    host: "dsh",
    order: eventOrder(record, lineIndex),
    timestamp: eventTimestamp(record.time),
  };
}

/**
 * Current DSH stores `assistant/message` as:
 * `{ turn, step, message: { id, role, content, source }, usage? }`.
 *
 * Early Agent Wrapped fixtures modeled a pre-current/legacy shape where
 * `content` and `provenance` lived directly under `data`. Keep that fallback so
 * previously exported fixtures remain ingestible while treating the official
 * current envelope as canonical.
 */
function assistantMessageView(data: JsonObject): AssistantMessageView | undefined {
  const message = object(data.message);
  if (message) {
    const source = object(message.source);
    const provenance = object(message.provenance);
    return {
      content: message.content,
      provider: string(source?.provider) ?? string(provenance?.provider),
      model: string(source?.model) ?? string(provenance?.model),
      messageId: string(message.id),
      shape: "current",
    };
  }

  if (Array.isArray(data.content)) {
    const provenance = object(data.provenance);
    return {
      content: data.content,
      provider: string(provenance?.provider),
      model: string(provenance?.model),
      shape: "legacy",
    };
  }

  return undefined;
}

function toolResultView(data: JsonObject): ToolResultView | undefined {
  const message = object(data.message);
  if (!message) return undefined;
  const source = object(message.source);
  const blocks = contentBlocks(message.content);
  const resultBlock = blocks.find((block) => block.type === "tool-result");
  if (!resultBlock) return undefined;
  return {
    callId: string(resultBlock.toolCallId) ?? string(source?.callId),
    content: resultBlock.content,
    isError: resultBlock.isError === true || object(data.error) !== undefined,
    messageId: string(message.id),
  };
}

function appendUserMessage(
  messages: TranscriptMessage[],
  events: SessionEvent[],
  record: JsonObject,
  data: JsonObject,
  lineIndex: number,
): void {
  const blocks = textBlocks(data.content, new Set(["text"]));
  if (blocks.length === 0) return;
  const text = blocks.map((block) => block.text).join("\n\n").trim();
  if (!text) return;
  const sourceKind = string(object(data.source)?.kind);
  // DSH persists host/plugin injections through the same `user/message`
  // envelope as human input. Keep their original text locally, but do not
  // misrepresent them as something the human said. Missing sourceKind remains
  // user for compatibility with older exports.
  const isHumanUser = sourceKind === undefined || sourceKind === "user";
  const messageIndex = messages.length;
  messages.push({
    id: `dsh:${eventSeq(record, lineIndex)}:user`,
    role: isHumanUser ? "user" : "system",
    text,
    host: "dsh",
    timestamp: eventTimestamp(record.time),
    metadata: {
      dshEventType: "user/message",
      dshSeq: record.seq,
      dshMessageId: string(data.id),
      surfaceOp: record.surfaceOp ?? data.surfaceOp,
      sourceKind,
    },
  });
  events.push({
    id: `dsh:${eventSeq(record, lineIndex)}:user-event`,
    ...eventBase(record, lineIndex),
    actor: isHumanUser ? "user" : "system",
    kind: isHumanUser ? "user_message" : "unknown",
    messageIndex,
    text,
    metadata: { sourceKind },
  });
}

function appendAssistantMessage(
  messages: TranscriptMessage[],
  events: SessionEvent[],
  diagnostics: IngestionDiagnostic[],
  record: JsonObject,
  data: JsonObject,
  lineIndex: number,
  includeVisibleReasoning: boolean,
): { provider?: string; model?: string } {
  const view = assistantMessageView(data);
  if (!view) {
    diagnostics.push({
      level: "warning",
      code: "assistant-message-shape-unrecognized",
      message: "Skipped an assistant/message event whose message envelope was not recognized.",
      line: lineIndex + 1,
    });
    return {};
  }

  const allowed = new Set(["text", ...(includeVisibleReasoning ? ["reasoning"] : [])]);
  const blocks = textBlocks(view.content, allowed);
  const allBlocks = contentBlocks(view.content);
  const skippedReasoning = !includeVisibleReasoning && allBlocks.some((block) => block.type === "reasoning");
  if (skippedReasoning) {
    diagnostics.push({
      level: "info",
      code: "reasoning-skipped",
      message: "Skipped a DSH reasoning block because includeVisibleReasoning is disabled.",
      line: lineIndex + 1,
    });
  }

  if (blocks.length === 0) {
    diagnostics.push({
      level: "info",
      code: "empty-visible-message",
      message: "Assistant event contained no visible text blocks after ingestion policy was applied.",
      line: lineIndex + 1,
    });
    return { provider: view.provider, model: view.model };
  }

  const seq = eventSeq(record, lineIndex);
  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;
    const messageIndex = messages.length;
    messages.push({
      id: `dsh:${seq}:assistant:${block.index}`,
      role: "assistant",
      text,
      host: "dsh",
      timestamp: eventTimestamp(record.time),
      metadata: {
        dshEventType: "assistant/message",
        dshSeq: record.seq,
        dshMessageId: view.messageId,
        turn: data.turn,
        step: data.step,
        contentType: block.type,
        visibleReasoning: block.type === "reasoning",
        provider: view.provider,
        model: view.model,
        dshMessageShape: view.shape,
        surfaceOp: record.surfaceOp,
      },
    });
    events.push({
      id: `dsh:${seq}:assistant-event:${block.index}`,
      ...eventBase(record, lineIndex),
      actor: "assistant",
      kind: "assistant_text",
      turn: number(data.turn),
      step: number(data.step),
      messageIndex,
      text,
      metadata: { visibleReasoning: block.type === "reasoning" },
    });
  }

  return { provider: view.provider, model: view.model };
}

function appendToolCall(events: SessionEvent[], record: JsonObject, data: JsonObject, lineIndex: number): void {
  const name = string(data.name);
  const callId = string(data.callId);
  const args = string(data.arguments);
  if (!name && !callId && !args) return;
  events.push({
    id: `dsh:${eventSeq(record, lineIndex)}:tool-call`,
    ...eventBase(record, lineIndex),
    actor: "tool",
    kind: "tool_call",
    turn: number(data.turn),
    step: number(data.step),
    toolName: name,
    callId,
    toolArguments: args,
  });
}

function appendToolResult(
  messages: TranscriptMessage[],
  events: SessionEvent[],
  diagnostics: IngestionDiagnostic[],
  record: JsonObject,
  data: JsonObject,
  lineIndex: number,
): void {
  const view = toolResultView(data);
  if (!view) {
    diagnostics.push({
      level: "warning",
      code: "tool-result-shape-unrecognized",
      message: "Skipped a tool/result event whose tool-result block was not recognized.",
      line: lineIndex + 1,
    });
    return;
  }
  const resultText = nestedVisibleText(view.content);
  let messageIndex: number | undefined;
  if (resultText) {
    messageIndex = messages.length;
    messages.push({
      id: `dsh:${eventSeq(record, lineIndex)}:tool-result`,
      role: "tool",
      text: resultText,
      host: "dsh",
      timestamp: eventTimestamp(record.time),
      metadata: {
        dshEventType: "tool/result",
        dshSeq: record.seq,
        dshMessageId: view.messageId,
        turn: data.turn,
        step: data.step,
        callId: view.callId,
        isError: view.isError,
        error: data.error,
      },
    });
  }
  const error = object(data.error);
  events.push({
    id: `dsh:${eventSeq(record, lineIndex)}:tool-result-event`,
    ...eventBase(record, lineIndex),
    actor: "tool",
    kind: view.isError ? "tool_error" : "tool_result",
    turn: number(data.turn),
    step: number(data.step),
    messageIndex,
    text: resultText || undefined,
    callId: view.callId,
    isError: view.isError,
    outcome: view.isError ? string(error?.code) ?? "error" : "success",
    metadata: error ? { errorName: string(error.name), errorCode: string(error.code) } : undefined,
  });
}

function appendTurnEnd(events: SessionEvent[], record: JsonObject, data: JsonObject, lineIndex: number): void {
  const reason = object(data.reason);
  const outcome = string(reason?.kind);
  if (!outcome) return;
  const error = object(reason?.error);
  const isError = outcome !== "completed";
  events.push({
    id: `dsh:${eventSeq(record, lineIndex)}:turn-end`,
    ...eventBase(record, lineIndex),
    actor: "system",
    kind: "turn_end",
    turn: number(data.turn),
    text: string(error?.message),
    isError,
    outcome,
    metadata: error ? { errorCode: string(error.code), status: error.status } : undefined,
  });
}

/** Parse the logical `session.jsonl` artifact emitted by DeepSeek Harness. */
export function parseDshSessionJsonl(
  content: string,
  options: ParseDshSessionOptions = {},
): IngestedSession {
  const diagnostics: IngestionDiagnostic[] = [];
  const messages: TranscriptMessage[] = [];
  const events: SessionEvent[] = [];
  const lines = content.split(/\r?\n/u);

  let header: JsonObject | undefined;
  let title: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const raw = lines[lineIndex]?.trim();
    if (!raw) continue;

    let record: JsonObject | undefined;
    try {
      record = object(JSON.parse(raw));
    } catch {
      diagnostics.push({
        level: "warning",
        code: "malformed-json-line",
        message: "Skipped a malformed JSONL record.",
        line: lineIndex + 1,
      });
      continue;
    }
    if (!record) continue;

    const type = string(record.type);
    if (type === "session" && header === undefined) {
      header = record;
      continue;
    }

    const data = object(record.data);
    if (!data) continue;

    if (type === "session/title") {
      title = string(data.title) ?? title;
      continue;
    }

    if (type === "user/message") {
      appendUserMessage(messages, events, record, data, lineIndex);
      continue;
    }

    if (type === "assistant/message") {
      const extracted = appendAssistantMessage(
        messages,
        events,
        diagnostics,
        record,
        data,
        lineIndex,
        options.includeVisibleReasoning ?? false,
      );
      provider = extracted.provider ?? provider;
      model = extracted.model ?? model;
      continue;
    }

    if (type === "tool/call") {
      appendToolCall(events, record, data, lineIndex);
      continue;
    }

    if (type === "tool/result") {
      appendToolResult(messages, events, diagnostics, record, data, lineIndex);
      continue;
    }

    if (type === "turn/end") {
      appendTurnEnd(events, record, data, lineIndex);
    }
  }

  if (!header || header.type !== "session") {
    throw new Error("Invalid DSH session artifact: first logical record is not a session header.");
  }

  const id = string(header.id);
  if (!id) throw new Error("Invalid DSH session artifact: session header has no id.");

  const createdAt = eventTimestamp(header.createdAt);
  const cwd = string(header.cwd);
  const assistantMessages = messages.filter((message) => message.role === "assistant").length;
  if (assistantMessages === 0) {
    diagnostics.push({
      level: "warning",
      code: "no-visible-assistant-messages",
      message: "No visible assistant text was recovered from this DSH session artifact.",
    });
  }
  if (!model) {
    diagnostics.push({
      level: "info",
      code: "unknown-model",
      message: "No assistant provenance model was found in the session artifact.",
    });
  }

  events.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

  return {
    id,
    host: "dsh",
    title,
    createdAt,
    cwd,
    provider,
    model,
    source: {
      host: "dsh",
      path: options.sourcePath,
      encoding: options.encoding ?? "jsonl",
    },
    messages,
    events,
    diagnostics,
  };
}

export const dshSessionAdapter = {
  host: "dsh" as const,
  parseArtifact: parseDshSessionJsonl,
};
