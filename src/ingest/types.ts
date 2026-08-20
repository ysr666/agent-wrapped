import type { AgentHost, TranscriptMessage } from "../core/types.js";
import type { SessionEvent } from "../session-events/types.js";

export type SessionArtifactEncoding = "jsonl" | "jsonl-zstd" | "unknown";

export interface SessionSource {
  host: AgentHost;
  path?: string;
  encoding: SessionArtifactEncoding;
}

export interface IngestionDiagnostic {
  level: "info" | "warning";
  code:
    | "malformed-json-line"
    | "unsupported-record"
    | "empty-visible-message"
    | "reasoning-skipped"
    | "unknown-model"
    | "truncated-zstd-tail"
    | "assistant-message-shape-unrecognized"
    | "tool-result-shape-unrecognized"
    | "no-visible-assistant-messages";
  message: string;
  line?: number;
}

export interface IngestedSession {
  id: string;
  host: AgentHost;
  title?: string;
  createdAt?: string;
  cwd?: string;
  provider?: string;
  model?: string;
  source: SessionSource;
  messages: TranscriptMessage[];
  /** Observable user/assistant/tool/outcome events when the host adapter can recover them. */
  events?: SessionEvent[];
  diagnostics: IngestionDiagnostic[];
}

export interface SessionAdapter<TOptions = unknown> {
  readonly host: AgentHost;
  parseArtifact(content: string, options?: TOptions): IngestedSession;
}
