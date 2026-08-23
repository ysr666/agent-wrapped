import type { IngestedSession } from "../ingest/types.js";
import { buildSemanticEvidence, type SemanticEvidenceOptions } from "./evidence.js";
import { aggregatePersonaSignals } from "./persona.js";
import { buildHighlightScoutPrompt, buildNarrationPrompt, buildStoryMinerPrompt } from "./prompt.js";
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
  VerifiedSemanticHighlight,
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
  return /(?:心里|内心|暗自|故意|偷偷|动机|甩锅|假装|明知|(?:才|终于|突然)?想起|(?:才|终于|突然)?意识到|(?:才|终于|突然)发现|in (?:its|his|her) (?:head|mind)|inner thought|secretly|intentionally|wanted to|pretend|blame)/iu.test(text);
}

function unsupportedUserCausality(text: string): boolean {
  return /(?:(?:用户|人类)不[^，。！？\n]{0,12}不|(?:只有|全靠|只能靠|非得靠)[^，。！？\n]{0,12}(?:用户|人类)|(?:user|human).{0,32}(?:won't|wouldn't|doesn't).{0,24}(?:unless|until)|(?:only|entirely) because (?:the )?(?:user|human))/iu.test(text);
}

function normalizedPersonaLabel(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/^本场(?:表现)?像\s*[:：]?\s*/u, "")
    .replace(/^this session (?:played|acted|looked) like\s*/iu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

const ENGLISH_SIGNAL_LABELS: Partial<Record<SemanticPersonaSignal["key"], string[]>> = {
  dramaticity: ["dramatic", "dramaticity"],
  self_correction: ["selfcorrection", "selfcorrecting"],
  persistence: ["persistence", "persistent"],
  improvisation: ["improvisation", "improviser"],
  premature_certainty: ["prematurecertainty", "overconfident"],
  repetition: ["repetition", "repetitive"],
};

function literalSignalWrapper(label: string, personaSignals: SemanticPersonaSignal[]): boolean {
  const normalized = normalizedPersonaLabel(label);
  const genericSuffix = /^(?:型)?(?:助手|小能手|选手|达人|专家|实习生|agent|typeassistant|assistant|helper|expert|intern)?$/u;
  return personaSignals.some((signal) => {
    const candidates = [signal.label, ...(ENGLISH_SIGNAL_LABELS[signal.key] ?? [])]
      .map(normalizedPersonaLabel)
      .filter(Boolean);
    return candidates.some((candidate) => normalized.startsWith(candidate) && genericSuffix.test(normalized.slice(candidate.length)));
  });
}

export function parseNarrationOutput(
  raw: string,
  stories: VerifiedStoryArc[],
  personaSignals: SemanticPersonaSignal[],
  locale: "zh-CN" | "en",
  highlights: VerifiedSemanticHighlight[] = [],
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
  const seenStoryIds = new Set<string>();
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
      if (seenStoryIds.has(storyId)) throw new Error(`Semantic narrator duplicated story id: ${storyId}`);
      seenStoryIds.add(storyId);
      const title = boundedText(entry.title, `storyCards[${index}].title`, 100);
      const commentary = optionalBoundedText(entry.commentary, `storyCards[${index}].commentary`, 260);
      if (hiddenStateClaim(title) || unsupportedUserCausality(title)) continue;
      storyCards.push({
        storyId,
        title,
        ...(
          commentary && !hiddenStateClaim(commentary) && !unsupportedUserCausality(commentary)
            ? { commentary }
            : {}
        ),
      });
    }
  }

  const highlightIds = new Set(highlights.map((highlight) => highlight.id));
  const seenHighlightIds = new Set<string>();
  const highlightCards: NonNullable<SemanticNarration["highlightCards"]> = [];
  if (root.highlightCards !== undefined && root.highlightCards !== null) {
    if (!Array.isArray(root.highlightCards) || root.highlightCards.length > highlights.length) {
      throw new Error("Semantic narrator returned invalid highlightCards.");
    }
    for (const [index, value] of root.highlightCards.entries()) {
      const entry = object(value);
      if (!entry) throw new Error(`Semantic narrator returned invalid highlightCards[${index}].`);
      const highlightId = boundedText(entry.highlightId ?? entry.id, `highlightCards[${index}].highlightId`, 80);
      if (!highlightIds.has(highlightId)) throw new Error(`Semantic narrator referenced unknown highlight id: ${highlightId}`);
      if (seenHighlightIds.has(highlightId)) throw new Error(`Semantic narrator duplicated highlight id: ${highlightId}`);
      seenHighlightIds.add(highlightId);
      const title = boundedText(entry.title, `highlightCards[${index}].title`, 100);
      const commentary = optionalBoundedText(entry.commentary, `highlightCards[${index}].commentary`, 260);
      if (hiddenStateClaim(title) || unsupportedUserCausality(title)) continue;
      highlightCards.push({
        highlightId,
        title,
        ...(commentary && !hiddenStateClaim(commentary) && !unsupportedUserCausality(commentary)
          ? { commentary }
          : {}),
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
    if (
      hiddenStateClaim(`${label}\n${tagline}`) ||
      unsupportedUserCausality(`${label}\n${tagline}`) ||
      literalSignalWrapper(label, personaSignals)
    ) return { storyCards, ...(highlightCards.length > 0 ? { highlightCards } : {}) };
    if (locale === "zh-CN" && !/^本场/u.test(label)) label = `本场表现像${label}`;
    if (locale === "en" && !/\bsession\b/iu.test(label)) label = `This session played like ${label}`;
    persona = { label, tagline };
  }

  return { storyCards, ...(highlightCards.length > 0 ? { highlightCards } : {}), persona };
}

export interface GenerateSemanticStoryPersonaOptions extends SemanticEvidenceOptions {}

function storyDiagnostics(
  verifiedStoryCount: number,
  suppressed: ReturnType<typeof admitStoriesForWrapped>["suppressed"],
  highlightPoolCount = 0,
  scout?: HighlightScoutResult,
): NonNullable<SemanticStoryPersonaReport["diagnostics"]> {
  const suppressionReasons: Record<string, number> = {};
  for (const entry of suppressed) {
    suppressionReasons[entry.reason] = (suppressionReasons[entry.reason] ?? 0) + 1;
  }
  return {
    verifiedStoryCount,
    suppressedStoryCount: suppressed.length,
    suppressionReasons,
    highlightPoolCount,
    highlightScoutUsed: scout?.used ?? false,
    highlightScoutChunks: scout?.chunks ?? 0,
    highlightScoutRetries: scout?.retries ?? 0,
    highlightScoutFailures: scout?.failures ?? 0,
    highlightShortlistCount: scout?.highlights.length ?? highlightPoolCount,
  };
}

function groundedHighlightPool(evidence: SemanticEvidenceBundle): VerifiedSemanticHighlight[] {
  const scoutEvents = evidence.scoutEvents ?? [];
  const highlights: VerifiedSemanticHighlight[] = [];
  for (const [index, event] of scoutEvents.entries()) {
    if (event.actor !== "assistant" || event.kind !== "assistant_text" || event.text.trim().length < 4) continue;
    const neighbors = [scoutEvents[index - 1], scoutEvents[index + 1]]
      .filter((candidate): candidate is NonNullable<typeof candidate> => !!candidate)
      .filter((candidate) => candidate.id !== event.id)
      .map((candidate) => candidate.id)
      .filter((id, neighborIndex, all) => all.indexOf(id) === neighborIndex);
    highlights.push({
      id: `highlight:${highlights.length}`,
      eventId: event.id,
      contextIds: neighbors,
      evidenceIds: [event.id, ...neighbors],
      confidence: "high",
    });
  }
  return highlights;
}

const DIRECT_EDITOR_MAX_HIGHLIGHTS = 12;
const DIRECT_EDITOR_MAX_CHARS = 2400;
const SCOUT_CHUNK_MAX_HIGHLIGHTS = 32;
const SCOUT_CHUNK_MAX_CHARS = 7000;
const SCOUT_SELECTIONS_PER_CHUNK = 4;
const SCOUT_MAX_SHORTLIST = 24;

interface HighlightScoutChunk {
  highlights: VerifiedSemanticHighlight[];
  events: NonNullable<SemanticEvidenceBundle["scoutEvents"]>;
}

interface HighlightScoutResult {
  highlights: VerifiedSemanticHighlight[];
  used: boolean;
  chunks: number;
  retries: number;
  failures: number;
}

function highlightEvidenceChars(
  highlights: VerifiedSemanticHighlight[],
  eventById: Map<string, NonNullable<SemanticEvidenceBundle["scoutEvents"]>[number]>,
): number {
  const ids = new Set(highlights.flatMap((highlight) => highlight.evidenceIds));
  return [...ids].reduce((sum, id) => sum + (eventById.get(id)?.text.length ?? 0), 0);
}

function buildHighlightScoutChunks(
  evidence: SemanticEvidenceBundle,
  highlights: VerifiedSemanticHighlight[],
): HighlightScoutChunk[] {
  const scoutEvents = evidence.scoutEvents ?? [];
  const eventById = new Map(scoutEvents.map((event) => [event.id, event]));
  const chunks: HighlightScoutChunk[] = [];
  let chunkHighlights: VerifiedSemanticHighlight[] = [];
  let chunkEventIds = new Set<string>();
  let chunkChars = 0;

  const flush = (): void => {
    if (chunkHighlights.length === 0) return;
    chunks.push({
      highlights: chunkHighlights,
      events: [...chunkEventIds]
        .map((id) => eventById.get(id))
        .filter((event): event is NonNullable<typeof event> => !!event)
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id)),
    });
    chunkHighlights = [];
    chunkEventIds = new Set<string>();
    chunkChars = 0;
  };

  for (const highlight of highlights) {
    const newEventIds = highlight.evidenceIds.filter((id) => !chunkEventIds.has(id) && eventById.has(id));
    const addedChars = newEventIds.reduce((sum, id) => sum + (eventById.get(id)?.text.length ?? 0), 0);
    if (
      chunkHighlights.length > 0 &&
      (chunkHighlights.length >= SCOUT_CHUNK_MAX_HIGHLIGHTS || chunkChars + addedChars > SCOUT_CHUNK_MAX_CHARS)
    ) flush();
    chunkHighlights.push(highlight);
    for (const id of highlight.evidenceIds) {
      const event = eventById.get(id);
      if (!event || chunkEventIds.has(id)) continue;
      chunkEventIds.add(id);
      chunkChars += event.text.length;
    }
  }
  flush();
  return chunks;
}

export function parseHighlightScoutOutput(
  raw: string,
  allowedHighlights: VerifiedSemanticHighlight[],
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("Semantic highlight Scout did not return valid JSON.");
  }
  const root = object(parsed);
  const values = root?.highlightIds ?? root?.ids;
  if (!Array.isArray(values) || values.length > SCOUT_SELECTIONS_PER_CHUNK) {
    throw new Error("Semantic highlight Scout returned invalid highlightIds.");
  }
  const allowedIds = new Set(allowedHighlights.map((highlight) => highlight.id));
  const selected: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") throw new Error("Semantic highlight Scout returned a non-string id.");
    const id = value.trim();
    if (!allowedIds.has(id) || selected.includes(id)) continue;
    selected.push(id);
  }
  return selected;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function shortlistHighlights(
  narrator: SemanticNarrator,
  evidence: SemanticEvidenceBundle,
  pool: VerifiedSemanticHighlight[],
): Promise<HighlightScoutResult> {
  const scoutEvents = evidence.scoutEvents ?? [];
  const eventById = new Map(scoutEvents.map((event) => [event.id, event]));
  const chars = highlightEvidenceChars(pool, eventById);
  if (pool.length <= DIRECT_EDITOR_MAX_HIGHLIGHTS && chars <= DIRECT_EDITOR_MAX_CHARS) {
    return { highlights: pool, used: false, chunks: 0, retries: 0, failures: 0 };
  }

  const chunks = buildHighlightScoutChunks(evidence, pool);
  const runChunk = async (chunk: HighlightScoutChunk): Promise<{ ids: string[]; failed: boolean }> => {
    try {
      const raw = await narrator.generate(buildHighlightScoutPrompt(evidence, chunk.highlights, chunk.events));
      return { ids: parseHighlightScoutOutput(raw, chunk.highlights), failed: false };
    } catch {
      return { ids: [] as string[], failed: true };
    }
  };
  const selections = await mapWithConcurrency(chunks, 3, runChunk);
  // The configured fast model is observably non-deterministic even at
  // temperature 0. Use two recall samples per chunk and union only locally
  // verified ids; the strict Editor still runs once.
  const retryIndexes = chunks.map((_chunk, index) => index);
  const retries = await mapWithConcurrency(retryIndexes, 3, async (index) => runChunk(chunks[index]));
  for (const [retryIndex, retry] of retries.entries()) {
    const original = selections[retryIndexes[retryIndex]];
    original.ids = [...original.ids, ...retry.ids].filter((id, index, all) => all.indexOf(id) === index);
    original.failed = original.failed && retry.failed;
  }
  const orderedIds: string[] = [];
  for (let rank = 0; rank < SCOUT_SELECTIONS_PER_CHUNK; rank += 1) {
    for (const selection of selections) {
      const id = selection.ids[rank];
      if (id && !orderedIds.includes(id)) orderedIds.push(id);
      if (orderedIds.length >= SCOUT_MAX_SHORTLIST) break;
    }
    if (orderedIds.length >= SCOUT_MAX_SHORTLIST) break;
  }
  const highlightById = new Map(pool.map((highlight) => [highlight.id, highlight]));
  return {
    highlights: orderedIds
      .map((id) => highlightById.get(id))
      .filter((highlight): highlight is VerifiedSemanticHighlight => !!highlight),
    used: true,
    chunks: chunks.length,
    retries: retryIndexes.length,
    failures: selections.filter((selection) => selection.failed).length,
  };
}

/**
 * Unified entertainment pipeline:
 * bounded evidence -> Story Miner(P8 structure only) + generic chunked LLM
 * shortlist over locally grounded lines -> local id validation -> one strict
 * Entertainment Editor(selection/copy).
 */
export async function generateSemanticStoryPersona(
  session: IngestedSession,
  narrator: SemanticNarrator,
  options: GenerateSemanticStoryPersonaOptions = {},
): Promise<{ report: SemanticStoryPersonaReport; evidence: SemanticEvidenceBundle }> {
  const evidence = buildSemanticEvidence(session, options);
  if (evidence.events.length < 2 && (evidence.scoutEvents?.length ?? 0) === 0) {
    return {
      evidence,
      report: {
        version: 3,
        locale: evidence.locale,
        sessionId: evidence.sessionId,
        stories: [],
        highlights: [],
        personaSignals: [],
        insufficientEvidence: evidence.locale === "zh-CN"
          ? "当前会话没有足够的可观察事件来发现剧情。"
          : "Not enough observable events were available for story discovery.",
        evidenceUsed: [],
      },
    };
  }

  let mining: ReturnType<typeof parseStoryMinerOutput>;
  try {
    const miningRaw = await narrator.generate(buildStoryMinerPrompt(evidence));
    mining = parseStoryMinerOutput(miningRaw);
  } catch {
    mining = {
      candidates: [],
      insufficientEvidence: evidence.locale === "zh-CN"
        ? "Story Miner 暂时不可用，已仅使用本地确定性证据。"
        : "Story Miner was unavailable; only deterministic local evidence was used.",
    };
  }
  // Local high-precision candidates are a recall floor, not an all-or-nothing
  // fallback: a partial Miner answer must not hide another grounded episode.
  const validation = validateStoryCandidates([
    ...mining.candidates,
    ...inferAuthorityBoundaryStoryCandidates(evidence),
    ...inferHumanTurnStoryCandidates(evidence),
  ], evidence);
  // Every redacted assistant excerpt is already truth-grounded by construction.
  // The generic Scout only narrows large pools by id; it has no authority to
  // publish a card and does not introduce behavior-specific lanes.
  const admission = admitStoriesForWrapped(validation.stories, evidence);
  const stories = admission.stories;
  const highlightPool = groundedHighlightPool(evidence);
  // A generic worklog trajectory must not create a personality card by itself.
  // Persona only competes for presentation once an episode itself earned a
  // showable Story slot.
  const personaSignals = stories.length > 0 ? aggregatePersonaSignals(stories, evidence) : [];

  if (stories.length === 0 && highlightPool.length === 0 && personaSignals.length === 0) {
    const diagnostics = storyDiagnostics(validation.stories.length, admission.suppressed);
    return {
      evidence,
      report: {
        version: 3,
        locale: evidence.locale,
        sessionId: evidence.sessionId,
        stories: [],
        highlights: [],
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

  const scout = await shortlistHighlights(narrator, evidence, highlightPool);
  const highlights = scout.highlights;
  const diagnostics = storyDiagnostics(validation.stories.length, admission.suppressed, highlightPool.length, scout);

  if (stories.length === 0 && highlights.length === 0 && personaSignals.length === 0) {
    return {
      evidence,
      report: {
        version: 3,
        locale: evidence.locale,
        sessionId: evidence.sessionId,
        stories: [],
        highlights: [],
        personaSignals: [],
        diagnostics,
        insufficientEvidence: evidence.locale === "zh-CN"
          ? "通用候选 Scout 没有召回值得交给最终娱乐编辑复审的台词。"
          : "The generic candidate Scout recalled no line worth sending to the final entertainment editor.",
        evidenceUsed: [],
      },
    };
  }

  let narration: SemanticNarration | undefined;
  let narrationUnavailable = false;
  try {
    const narrationRaw = await narrator.generate(buildNarrationPrompt(evidence, stories, personaSignals, highlights));
    narration = parseNarrationOutput(narrationRaw, stories, personaSignals, evidence.locale, highlights);
  } catch {
    // Narration is editorial only. Preserve the already verified local facts
    // rather than dropping a session because a remote prose call failed or
    // returned malformed JSON. Deliberately do not retain remote error text.
    narrationUnavailable = true;
  }
  const narratedHighlightIds = new Set((narration?.highlightCards ?? []).map((card) => card.highlightId));
  const selectedHighlights = highlights.filter((highlight) => narratedHighlightIds.has(highlight.id));
  const evidenceUsed = [
    ...stories.flatMap((story) => story.evidenceIds),
    ...selectedHighlights.flatMap((highlight) => highlight.evidenceIds),
    ...personaSignals.flatMap((signal) => signal.evidenceIds),
  ].filter((id, index, all) => all.indexOf(id) === index);

  return {
    evidence,
    report: {
      version: 3,
      locale: evidence.locale,
      sessionId: evidence.sessionId,
      stories,
      highlights: selectedHighlights,
      personaSignals,
      narration,
      ...(narrationUnavailable ? { narrationUnavailable: true } : {}),
      diagnostics,
      insufficientEvidence: stories.length === 0 && selectedHighlights.length === 0
        ? (validation.stories.length > 0
          ? (evidence.locale === "zh-CN"
            ? "验证到的结构没有足够明确的人类可感知戏剧张力，最终娱乐编辑也没有选出值得上榜的台词，因此不上榜。"
            : "Verified structure lacked a clear human-visible dramatic turn, and the entertainment editor selected no showable line.")
          : mining.insufficientEvidence ?? (evidence.locale === "zh-CN"
            ? "Story Miner 暂时不可用，已仅使用本地确定性证据；最终没有内容通过娱乐编辑。"
            : "Story Miner was unavailable; deterministic local evidence was used and nothing passed the entertainment edit."))
        : undefined,
      evidenceUsed,
    },
  };
}
