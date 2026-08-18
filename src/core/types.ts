export type AgentHost = "dsh" | "claude-code" | "codex" | "opencode" | "unknown";

export interface TranscriptMessage {
  id?: string;
  timestamp?: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  host?: AgentHost;
  metadata?: Record<string, unknown>;
}

export interface QuoteHighlight {
  kind: "quote";
  text: string;
  score: number;
  messageIndex: number;
  reasons: string[];
}

export interface CatchphraseHighlight {
  kind: "catchphrase";
  canonicalText: string;
  count: number;
  variants: string[];
  messageIndexes: number[];
}

export interface BoomerangHighlight {
  kind: "boomerang";
  before: string;
  after: string;
  beforeMessageIndex: number;
  afterMessageIndex: number;
  score: number;
}

export interface WrappedResult {
  quote?: QuoteHighlight;
  catchphrases: CatchphraseHighlight[];
  boomerangs: BoomerangHighlight[];
}
