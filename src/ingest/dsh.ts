import type { TranscriptMessage } from "../core/types.js";
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

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function eventSeq(record: JsonObject, fallback: number): string {
  const seq = record.seq;
  return typeof seq === "number" && Number.isFinite(seq) ? String(seq) : String(fallback);
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

function appendUserMessage(
  messages: TranscriptMessage[],
  record: JsonObject,
  data: JsonObject,
  lineIndex: number,
): void {
  const blocks = textBlocks(data.content, new Set(["text"]));
  if (blocks.length === 0) return;
  const text = blocks.map((block) => block.text).join("\n\n").trim();
  if (!text) return;
  messages.push({
    id: `dsh:${eventSeq(record, lineIndex)}:user`,
    role: "user",
    text,
    host: "dsh",
    timestamp: eventTimestamp(record.time),
    metadata: {
      dshEventType: "user/message",
      dshSeq: record.seq,
      dshMessageId: string(data.id),
      surfaceOp: record.surfaceOp ?? data.surfaceOp,
      sourceKind: string(object(data.source)?.kind),
    },
  });
}

function appendAssistantMessage(
  messages: TranscriptMessage[],
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
  }

  return { provider: view.provider, model: view.model };
}

/**
 * Parse the logical `session.jsonl` artifact emitted by DeepSeek Harness.
 *
 * DSH persists chunk rows and a final durable `assistant/message`; this adapter
 * intentionally consumes the latter so streaming deltas are not double-counted.
 */
export function parseDshSessionJsonl(
  content: string,
  options: ParseDshSessionOptions = {},
): IngestedSession {
  const diagnostics: IngestionDiagnostic[] = [];
  const messages: TranscriptMessage[] = [];
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
      appendUserMessage(messages, record, data, lineIndex);
      continue;
    }

    if (type === "assistant/message") {
      const extracted = appendAssistantMessage(
        messages,
        diagnostics,
        record,
        data,
        lineIndex,
        options.includeVisibleReasoning ?? false,
      );
      provider = extracted.provider ?? provider;
      model = extracted.model ?? model;
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
    diagnostics,
  };
}

export const dshSessionAdapter = {
  host: "dsh" as const,
  parseArtifact: parseDshSessionJsonl,
};
