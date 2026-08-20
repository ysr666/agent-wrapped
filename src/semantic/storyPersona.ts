import type { IngestedSession } from "../ingest/types.js";
import { buildSemanticEvidence, type SemanticEvidenceOptions } from "./evidence.js";
import { buildStoryPersonaPrompt } from "./prompt.js";
import type {
  SemanticEvidenceBundle,
  SemanticNarrator,
  SemanticPersonaDimension,
  SemanticPersonaProfile,
  SemanticStoryArc,
  SemanticStoryBeat,
  SemanticStoryPersonaReport,
} from "./types.js";

interface JsonObject {
  [key: string]: unknown;
}

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function text(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Semantic narrator returned invalid ${path}.`);
  return value.trim();
}

function optionalText(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, path);
}

function allowedEvidence(bundle: SemanticEvidenceBundle): Set<string> {
  return new Set([
    ...bundle.moments.map((moment) => moment.id),
    ...bundle.messages.map((message) => message.id),
  ]);
}

function evidenceIds(value: unknown, allowed: Set<string>, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Semantic narrator returned ${path} without evidence ids.`);
  }
  const output: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !allowed.has(entry)) {
      throw new Error(`Semantic narrator referenced unknown evidence id in ${path}: ${String(entry)}`);
    }
    if (!output.includes(entry)) output.push(entry);
  }
  return output;
}

function parseBeat(value: unknown, allowed: Set<string>, index: number): SemanticStoryBeat {
  const entry = object(value);
  if (!entry) throw new Error(`Semantic narrator returned invalid story.beats[${index}].`);
  return {
    title: text(entry.title, `story.beats[${index}].title`),
    summary: text(entry.summary, `story.beats[${index}].summary`),
    evidenceIds: evidenceIds(entry.evidenceIds, allowed, `story.beats[${index}]`),
  };
}

function parseStory(value: unknown, allowed: Set<string>): SemanticStoryArc | undefined {
  if (value === undefined || value === null) return undefined;
  const entry = object(value);
  if (!entry) throw new Error("Semantic narrator returned invalid story.");
  if (!Array.isArray(entry.beats) || entry.beats.length === 0 || entry.beats.length > 5) {
    throw new Error("Semantic narrator story must contain between 1 and 5 beats.");
  }
  return {
    title: text(entry.title, "story.title"),
    synopsis: text(entry.synopsis, "story.synopsis"),
    beats: entry.beats.map((beat, index) => parseBeat(beat, allowed, index)),
    commentary: optionalText(entry.commentary, "story.commentary"),
  };
}

function parseDimension(value: unknown, allowed: Set<string>, index: number): SemanticPersonaDimension {
  const entry = object(value);
  if (!entry) throw new Error(`Semantic narrator returned invalid persona.dimensions[${index}].`);
  const score = entry.score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
    throw new Error(`Semantic narrator returned invalid persona.dimensions[${index}].score.`);
  }
  return {
    key: text(entry.key, `persona.dimensions[${index}].key`),
    label: text(entry.label, `persona.dimensions[${index}].label`),
    score,
    rationale: text(entry.rationale, `persona.dimensions[${index}].rationale`),
    evidenceIds: evidenceIds(entry.evidenceIds, allowed, `persona.dimensions[${index}]`),
  };
}

function parsePersona(value: unknown, allowed: Set<string>): SemanticPersonaProfile | undefined {
  if (value === undefined || value === null) return undefined;
  const entry = object(value);
  if (!entry) throw new Error("Semantic narrator returned invalid persona.");
  if (!Array.isArray(entry.dimensions) || entry.dimensions.length === 0 || entry.dimensions.length > 6) {
    throw new Error("Semantic narrator persona must contain between 1 and 6 dimensions.");
  }
  return {
    label: text(entry.label, "persona.label"),
    tagline: text(entry.tagline, "persona.tagline"),
    dimensions: entry.dimensions.map((dimension, index) => parseDimension(dimension, allowed, index)),
    evidenceIds: evidenceIds(entry.evidenceIds, allowed, "persona"),
  };
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1]?.trim() ?? trimmed;
}

/**
 * Parse and evidence-check an LLM response. Unknown evidence references fail
 * closed instead of letting an invented story leak into the Wrapped output.
 */
export function parseSemanticStoryPersona(
  raw: string,
  bundle: SemanticEvidenceBundle,
): SemanticStoryPersonaReport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("Semantic narrator did not return valid JSON.");
  }
  const root = object(parsed);
  if (!root) throw new Error("Semantic narrator response is not a JSON object.");

  const allowed = allowedEvidence(bundle);
  const story = parseStory(root.story, allowed);
  const persona = parsePersona(root.persona, allowed);
  const insufficientEvidence = optionalText(root.insufficientEvidence, "insufficientEvidence");
  if (!story && !persona && !insufficientEvidence) {
    throw new Error("Semantic narrator returned neither story/persona nor an insufficient-evidence reason.");
  }

  const evidenceUsed = new Set<string>();
  for (const beat of story?.beats ?? []) for (const id of beat.evidenceIds) evidenceUsed.add(id);
  for (const dimension of persona?.dimensions ?? []) for (const id of dimension.evidenceIds) evidenceUsed.add(id);
  for (const id of persona?.evidenceIds ?? []) evidenceUsed.add(id);

  return {
    version: 1,
    locale: bundle.locale,
    sessionId: bundle.sessionId,
    story,
    persona,
    insufficientEvidence,
    evidenceUsed: [...evidenceUsed],
  };
}

export interface GenerateSemanticStoryPersonaOptions extends SemanticEvidenceOptions {}

export async function generateSemanticStoryPersona(
  session: IngestedSession,
  narrator: SemanticNarrator,
  options: GenerateSemanticStoryPersonaOptions = {},
): Promise<{ report: SemanticStoryPersonaReport; evidence: SemanticEvidenceBundle }> {
  const evidence = buildSemanticEvidence(session, options);
  if (evidence.moments.length === 0) {
    return {
      evidence,
      report: {
        version: 1,
        locale: evidence.locale,
        sessionId: evidence.sessionId,
        insufficientEvidence: evidence.locale === "zh-CN" ? "当前会话没有可供语义层复核的 Moment 候选。" : "No Moment candidates were available for semantic review.",
        evidenceUsed: [],
      },
    };
  }

  const request = buildStoryPersonaPrompt(evidence);
  const raw = await narrator.generate(request);
  return { evidence, report: parseSemanticStoryPersona(raw, evidence) };
}
