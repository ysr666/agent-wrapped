import type { SemanticNarrator, SemanticNarratorRequest } from "./types.js";

export interface OpenAICompatibleNarratorConfig {
  /** Explicit opt-in endpoint root, usually ending in `/v1`. No network default is assumed. */
  baseUrl: string;
  model: string;
  apiKey?: string;
  temperature?: number;
  timeoutMs?: number;
  jsonMode?: boolean;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

export interface SemanticLlmEnvConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  jsonMode: boolean;
}

function required(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} is required for semantic story/persona generation.`);
  return trimmed;
}

export function semanticLlmConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): SemanticLlmEnvConfig {
  return {
    baseUrl: required(env.AGENT_WRAPPED_LLM_BASE_URL, "AGENT_WRAPPED_LLM_BASE_URL"),
    model: required(env.AGENT_WRAPPED_LLM_MODEL, "AGENT_WRAPPED_LLM_MODEL"),
    apiKey: env.AGENT_WRAPPED_LLM_API_KEY?.trim() || undefined,
    jsonMode: /^(?:1|true|yes)$/iu.test(env.AGENT_WRAPPED_LLM_JSON_MODE?.trim() ?? ""),
  };
}

function contentFromResponse(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (typeof first !== "object" || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return undefined;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const joined = content
      .map((entry) => {
        if (typeof entry !== "object" || entry === null) return "";
        const text = (entry as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      })
      .filter(Boolean)
      .join("\n");
    return joined || undefined;
  }
  return undefined;
}

/**
 * Minimal OpenAI-compatible chat-completions adapter. The core semantic layer
 * remains provider-neutral; this convenience adapter is only used when callers
 * explicitly configure an endpoint.
 */
export function createOpenAICompatibleNarrator(
  config: OpenAICompatibleNarratorConfig,
): SemanticNarrator {
  const baseUrl = required(config.baseUrl, "baseUrl").replace(/\/+$/u, "");
  const model = required(config.model, "model");
  const fetchImpl = config.fetchImpl ?? fetch;
  const temperature = config.temperature ?? 0.35;
  const timeoutMs = Math.max(1000, Math.floor(config.timeoutMs ?? 60000));

  return {
    async generate(request: SemanticNarratorRequest): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const headers: Record<string, string> = {
          "content-type": "application/json",
          ...config.headers,
        };
        if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

        const body: Record<string, unknown> = {
          model,
          temperature,
          messages: [
            { role: "system", content: request.system },
            { role: "user", content: request.user },
          ],
        };
        if (config.jsonMode) body.response_format = { type: "json_object" };

        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const detail = (await response.text()).slice(0, 600);
          throw new Error(`Semantic narrator HTTP ${response.status}: ${detail || response.statusText}`);
        }
        const payload = await response.json();
        const content = contentFromResponse(payload);
        if (!content) throw new Error("Semantic narrator response contained no assistant content.");
        return content;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export function createOpenAICompatibleNarratorFromEnv(
  env: Record<string, string | undefined> = process.env,
): { narrator: SemanticNarrator; config: SemanticLlmEnvConfig } {
  const config = semanticLlmConfigFromEnv(env);
  return {
    config,
    narrator: createOpenAICompatibleNarrator(config),
  };
}
