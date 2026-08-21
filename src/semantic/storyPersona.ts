import type { IngestedSession } from "../ingest/types.js";
import { buildSemanticEvidence, type SemanticEvidenceOptions } from "./evidence.js";
import { aggregatePersonaSignals } from "./persona.js";
import { buildNarrationPrompt, buildStoryMinerPrompt } from "./prompt.js";
import { admitStoriesForWrapped } from "./storyAdmission.js";
import {
  inferAuthorityBoundaryStoryCandidates,
  inferHumanTurnStoryCandidates,
  parseStoryMinerOutput,
  validateStoryCandidates,
} from "./storyMiner.js";
import type {
  SemanticEvidenceBundle,
  SemanticNarration,
  SemanticNarrator,
  SemanticPersonaSignal,
  SemanticStoryPersonaReport,
  VerifiedStoryArc,
} from "./types.js";

interface JsonObject { [key: string]: unknown }

function object(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : undefined;
}

function stripCodeFence(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return match?.[1]?.trim() ?? trimmed;
}

function boundedText(value: unknown, path: string, maxChars: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Semantic narrator returned invalid ${path}.`);
  const trimmed = value.trim();
  if (trimmed.length > maxChars) throw new Error(`Semantic narrator returned overlong ${path}.`);
  return trimmed;
}

function optionalBoundedText(value: unknown, path: string, maxChars: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  return boundedText(value, path, maxChars);
}

function hiddenStateClaim(text: string): boolean {
  return /(?:心里|内心|暗自|故意|偷偷|动机|甩锅|假装|明知|in (?:its|his|her) (?:head|mind)|inner thought|secretly|intentionally|wanted to|pretend|blame)/iu.test(text);
}

export function parseNarrationOutput(
  raw: string,
  stories: VerifiedStoryArc[],
  personaSignals: SemanticPersonaSignal[],
  locale: "zh-CN" | "en",
): SemanticNarration {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("Semantic narrator did not return valid JSON.");
  }
  const root = object(parsed);
  if (!root) throw new Error("Semantic narrator response is not a JSON object.");
  const storyIds = new Set(stories.map((story) => story.id));
  const storyCards: SemanticNarration["storyCards"] = [];
  if (root.storyCards !== undefined && root.storyCards !== null) {
    if (!Array.isArray(root.storyCards) || root.storyCards.length > stories.length) {
      throw new Error("Semantic narrator returned invalid storyCards.");
    }
    for (const [index, value] of root.storyCards.entries()) {
      const entry = object(value);
      if (!entry) throw new Error(`Semantic narrator returned invalid storyCards[${index}].`);
      const storyId = boundedText(entry.storyId, `storyCards[${index}].storyId`, 80);
      if (!storyIds.has(storyId)) throw new Error(`Semantic narrator referenced unknown story id: ${storyId}`);
      if (storyCards.some((card) => card.storyId === storyId)) throw new Error(`Semantic narrator duplicated story id: ${storyId}`);
      storyCards.push({
        storyId,
        title: boundedText(entry.title, `storyCards[${index}].title`, 100),
        commentary: optionalBoundedText(entry.commentary, `storyCards[${index}].commentary`, 260),
      });
    }
  }

  let persona: SemanticNarration["persona"];
  if (root.persona !== undefined && root.persona !== null) {
    if (personaSignals.length === 0) throw new Error("Semantic narrator returned a persona without deterministic persona signals.");
    const entry = object(root.persona);
    if (!entry) throw new Error("Semantic narrator returned invalid persona.");
    let label = boundedText(entry.label, "persona.label", 100);
    const tagline = boundedText(entry.tagline, "persona.tagline", 180);
    if (hiddenStateClaim(`${label}\n${tagline}`)) return { storyCards };
    if (locale === "zh-CN" && !/^本场/u.test(label)) label = `本场表现像${label}`;
    if (locale === "en" && !/\bsession\b/iu.test(label)) label = `This session played like ${label}`;
    persona = { label, tagline };
  }

  return { storyCards, persona };
}

export interface GenerateSemanticStoryPersonaOptions extends SemanticEvidenceOptions {}

function storyDiagnostics(
  verifiedStoryCount: number,
  suppressed: ReturnType<typeof admitStoriesForWrapped>["suppressed"],
): NonNullable<SemanticStoryPersonaReport["diagnostics"]> {
  const suppressionReasons: Record<string, number> = {};
  for (const entry of suppressed) {
    suppressionReasons[entry.reason] = (suppressionReasons[entry.reason] ?? 0) + 1;
  }
  return {
    verifiedStoryCount,
    suppressedStoryCount: suppressed.length,
    suppressionReasons,
  };
}

/**
 * P8 v2 pipeline:
 * event evidence -> Story Miner(structure only) -> local validation ->
 * deterministic persona aggregation -> Narrator(editorial language only).
 */
export async function generateSemanticStoryPersona(
  session: IngestedSession,
  narrator: SemanticNarrator,
  options: GenerateSemanticStoryPersonaOptions = {},
): Promise<{ report: SemanticStoryPersonaReport; evidence: SemanticEvidenceBundle }> {
  const evidence = buildSemanticEvidence(session, options);
  if (evidence.events.length < 2 || evidence.windows.length === 0) {
    return {
      evidence,
      report: {
        version: 3,
        locale: evidence.locale,
        sessionId: evidence.sessionId,
        stories: [],
        personaSignals: [],
        insufficientEvidence: evidence.locale === "zh-CN"
          ? "当前会话没有足够的可观察事件来发现剧情。"
          : "Not enough observable events were available for story discovery.",
        evidenceUsed: [],
      },
    };
  }

  const miningRaw = await narrator.generate(buildStoryMinerPrompt(evidence));
  let mining: ReturnType<typeof parseStoryMinerOutput>;
  try {
    mining = parseStoryMinerOutput(miningRaw);
  } catch {
    mining = {
      candidates: [],
      insufficientEvidence: evidence.locale === "zh-CN"
        ? "Story Miner 没有返回可用的结构化结果。"
        : "Story Miner returned no usable structured result.",
    };
  }
  let validation = validateStoryCandidates([
    ...mining.candidates,
    ...inferAuthorityBoundaryStoryCandidates(evidence),
  ], evidence);
  if (validation.stories.length === 0) {
    const localHumanTurn = validateStoryCandidates(inferHumanTurnStoryCandidates(evidence), evidence);
    if (localHumanTurn.stories.length > 0) validation = localHumanTurn;
  }
  const admission = admitStoriesForWrapped(validation.stories, evidence);
  const stories = admission.stories;
  // A generic worklog trajectory must not create a personality card by itself.
  // Persona only competes for presentation once an episode itself earned a
  // showable Story slot.
  const personaSignals = stories.length > 0 ? aggregatePersonaSignals(stories, evidence) : [];
  const diagnostics = storyDiagnostics(validation.stories.length, admission.suppressed);

  if (stories.length === 0 && personaSignals.length === 0) {
    return {
      evidence,
      report: {
        version: 3,
        locale: evidence.locale,
        sessionId: evidence.sessionId,
        stories: [],
        personaSignals: [],
        diagnostics,
        insufficientEvidence: validation.stories.length > 0
          ? (evidence.locale === "zh-CN"
            ? "验证到的工具轨迹没有足够明确的反转、改口或人类可感知的戏剧张力，因此不上榜。"
            : "Verified tool trajectories lacked a clear reversal, correction, or human-visible dramatic turn, so none made the highlight reel.")
          : mining.insufficientEvidence ?? (evidence.locale === "zh-CN"
            ? "Story Miner 没有找到能通过本地结构校验的剧情。"
            : "Story Miner found no story that passed local structural validation."),
        evidenceUsed: [],
      },
    };
  }

  let narration: SemanticNarration | undefined;
  let narrationUnavailable = false;
  try {
    const narrationRaw = await narrator.generate(buildNarrationPrompt(evidence, stories, personaSignals));
    narration = parseNarrationOutput(narrationRaw, stories, personaSignals, evidence.locale);
  } catch {
    // Narration is editorial only. Preserve the already verified local facts
    // rather than dropping a session because a remote prose call failed or
    // returned malformed JSON. Deliberately do not retain remote error text.
    narrationUnavailable = true;
  }
  const evidenceUsed = [
    ...stories.flatMap((story) => story.evidenceIds),
    ...personaSignals.flatMap((signal) => signal.evidenceIds),
  ].filter((id, index, all) => all.indexOf(id) === index);

  return {
    evidence,
    report: {
      version: 3,
      locale: evidence.locale,
      sessionId: evidence.sessionId,
      stories,
      personaSignals,
      narration,
      ...(narrationUnavailable ? { narrationUnavailable: true } : {}),
      diagnostics,
      insufficientEvidence: validation.rejected.length > 0 && stories.length === 0
        ? mining.insufficientEvidence
        : undefined,
      evidenceUsed,
    },
  };
}
