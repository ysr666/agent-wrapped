import { scoreQuoteFacets, type QuoteFacetScores } from "./facetScorer.js";
import { rankQuoteCandidates } from "./quoteScorer.js";
import type { TranscriptMessage } from "./types.js";

export type SessionAwardKind =
  | "quote"
  | "catchphrase"
  | "wolf-cry"
  | "premature-celebration"
  | "plot-twist"
  | "emotional-peak"
  | "progress-announcement"
  | "victory-lap";

export interface SessionCandidate {
  text: string;
  messageIndex: number;
  repetitionCount: number;
  facets: QuoteFacetScores;
}

export interface SessionAward {
  kind: SessionAwardKind;
  title: string;
  emoji: string;
  score: number;
  text: string;
  messageIndexes: number[];
  count?: number;
  relatedText?: string;
  relatedMessageIndex?: number;
  facets?: QuoteFacetScores;
}

export interface SessionMetrics {
  assistantMessages: number;
  candidateUnits: number;
  repeatedPhraseGroups: number;
  discoveryDeclarations: number;
  reversalMoments: number;
  progressAnnouncements: number;
  celebrationMoments: number;
}

export interface SessionAnalysis {
  awards: SessionAward[];
  byKind: Partial<Record<SessionAwardKind, SessionAward>>;
  metrics: SessionMetrics;
}

export interface SessionAnalyzerOptions {
  minCatchphraseCount?: number;
  minWolfCryDeclarations?: number;
  contextWindowMessages?: number;
}

const AWARD_META: Record<SessionAwardKind, { title: string; emoji: string }> = {
  quote: { title: "Quote of the session", emoji: "🏆" },
  catchphrase: { title: "Catchphrase", emoji: "📢" },
  "wolf-cry": { title: "Called it too early", emoji: "🐺" },
  "premature-celebration": { title: "Premature celebration", emoji: "🍾" },
  "plot-twist": { title: "Plot twist", emoji: "🧠" },
  "emotional-peak": { title: "Emotional peak", emoji: "😱" },
  "progress-announcement": { title: "Progress announcement", emoji: "📈" },
  "victory-lap": { title: "Victory lap", emoji: "🎉" },
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeForGrouping(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[“”"'`*_~]/gu, "")
    .replace(/[。！？!?…，,；;：:\s]+/gu, " ")
    .trim();
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function makeAward(
  kind: SessionAwardKind,
  candidate: SessionCandidate,
  score: number,
  extra: Partial<SessionAward> = {},
): SessionAward {
  const meta = AWARD_META[kind];
  return {
    kind,
    title: meta.title,
    emoji: meta.emoji,
    score: clampScore(score),
    text: candidate.text,
    messageIndexes: [candidate.messageIndex],
    facets: candidate.facets,
    ...extra,
  };
}

function buildCandidates(messages: TranscriptMessage[]): SessionCandidate[] {
  // Reuse QuoteScorer's sentence-like extraction instead of maintaining a second
  // tokenizer. We request every candidate and do the session-level scoring here.
  const extracted = rankQuoteCandidates(messages, {
    limit: Math.max(256, messages.length * 32),
    minScore: 0,
    penalizeRepetition: false,
  });

  const counts = new Map<string, number>();
  for (const candidate of extracted) {
    const key = normalizeForGrouping(candidate.text);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return extracted.map((candidate) => {
    const repetitionCount = counts.get(normalizeForGrouping(candidate.text)) ?? 1;
    return {
      text: candidate.text,
      messageIndex: candidate.messageIndex,
      repetitionCount,
      facets: scoreQuoteFacets(candidate.text, repetitionCount),
    };
  });
}

function sortByFacet(
  candidates: SessionCandidate[],
  facet: keyof QuoteFacetScores,
): SessionCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.facets[facet] - a.facets[facet] ||
      b.facets.quote - a.facets.quote ||
      a.messageIndex - b.messageIndex,
  );
}

function pickFacetCandidate(
  candidates: SessionCandidate[],
  facet: keyof QuoteFacetScores,
  minScore: number,
  usedTexts: Set<string>,
): SessionCandidate | undefined {
  const ranked = sortByFacet(candidates, facet).filter((candidate) => candidate.facets[facet] >= minScore);
  const best = ranked[0];
  if (!best) return undefined;

  // A Wrapped recap is more fun when one spectacular sentence does not occupy
  // every category. Prefer a different line when it is at least 80% as strong.
  const diverse = ranked.find(
    (candidate) =>
      !usedTexts.has(normalizeForGrouping(candidate.text)) &&
      candidate.facets[facet] >= best.facets[facet] * 0.8,
  );

  return diverse ?? best;
}

function findCatchphrase(
  candidates: SessionCandidate[],
  minCount: number,
): SessionAward | undefined {
  const groups = new Map<string, SessionCandidate[]>();

  for (const candidate of candidates) {
    const key = normalizeForGrouping(candidate.text);
    if (key.length < 4) continue;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const eligible = [...groups.values()].filter((group) => group.length >= minCount);
  if (eligible.length === 0) return undefined;

  eligible.sort((a, b) => {
    const aScore = Math.max(...a.map((candidate) => candidate.facets.catchphrase));
    const bScore = Math.max(...b.map((candidate) => candidate.facets.catchphrase));
    return bScore - aScore || b.length - a.length || a[0].messageIndex - b[0].messageIndex;
  });

  const group = eligible[0];
  const representative = [...group].sort(
    (a, b) => b.facets.drama - a.facets.drama || b.facets.quote - a.facets.quote,
  )[0];
  const score = Math.max(...group.map((candidate) => candidate.facets.catchphrase));

  return makeAward("catchphrase", representative, score, {
    count: group.length,
    messageIndexes: uniqueSorted(group.map((candidate) => candidate.messageIndex)),
  });
}

function findWolfCry(
  candidates: SessionCandidate[],
  minDeclarations: number,
): SessionAward | undefined {
  const declarations = candidates.filter((candidate) => candidate.facets.discovery >= 55);
  if (declarations.length < minDeclarations) return undefined;

  const representative = [...declarations].sort(
    (a, b) =>
      b.repetitionCount - a.repetitionCount ||
      b.facets.discovery - a.facets.discovery ||
      b.facets.drama - a.facets.drama ||
      a.messageIndex - b.messageIndex,
  )[0];

  const bestDiscovery = Math.max(...declarations.map((candidate) => candidate.facets.discovery));
  const score = bestDiscovery * 0.55 + Math.min(45, declarations.length * 10);

  return makeAward("wolf-cry", representative, score, {
    count: declarations.length,
    messageIndexes: uniqueSorted(declarations.map((candidate) => candidate.messageIndex)),
  });
}

function findPrematureCelebration(
  candidates: SessionCandidate[],
  contextWindowMessages: number,
): SessionAward | undefined {
  const chronological = [...candidates].sort((a, b) => a.messageIndex - b.messageIndex);
  let best:
    | {
        before: SessionCandidate;
        after: SessionCandidate;
        score: number;
      }
    | undefined;

  for (const before of chronological) {
    if (before.facets.celebration < 50) continue;

    for (const after of chronological) {
      const distance = after.messageIndex - before.messageIndex;
      if (distance <= 0 || distance > contextWindowMessages) continue;
      if (after.facets.reversal < 50) continue;

      const closenessBonus = Math.max(0, contextWindowMessages - distance) * 1.2;
      const score = before.facets.celebration * 0.42 + after.facets.reversal * 0.48 + closenessBonus;

      if (!best || score > best.score) {
        best = { before, after, score };
      }
    }
  }

  if (!best) return undefined;

  return makeAward("premature-celebration", best.before, best.score, {
    messageIndexes: [best.before.messageIndex, best.after.messageIndex],
    relatedText: best.after.text,
    relatedMessageIndex: best.after.messageIndex,
  });
}

export function analyzeSession(
  messages: TranscriptMessage[],
  options: SessionAnalyzerOptions = {},
): SessionAnalysis {
  const minCatchphraseCount = options.minCatchphraseCount ?? 2;
  const minWolfCryDeclarations = options.minWolfCryDeclarations ?? 2;
  const contextWindowMessages = options.contextWindowMessages ?? 18;
  const candidates = buildCandidates(messages);

  const awards: SessionAward[] = [];
  const byKind: Partial<Record<SessionAwardKind, SessionAward>> = {};
  const usedTexts = new Set<string>();

  const addAward = (award: SessionAward | undefined, markUsed = true): void => {
    if (!award) return;
    awards.push(award);
    byKind[award.kind] = award;
    if (markUsed) usedTexts.add(normalizeForGrouping(award.text));
  };

  const quote = pickFacetCandidate(candidates, "quote", 12, usedTexts);
  addAward(quote ? makeAward("quote", quote, quote.facets.quote) : undefined);

  const catchphrase = findCatchphrase(candidates, minCatchphraseCount);
  addAward(catchphrase);

  const wolfCry = findWolfCry(candidates, minWolfCryDeclarations);
  addAward(wolfCry);

  const prematureCelebration = findPrematureCelebration(candidates, contextWindowMessages);
  addAward(prematureCelebration);

  const plotTwist = pickFacetCandidate(candidates, "reversal", 50, usedTexts);
  addAward(
    plotTwist ? makeAward("plot-twist", plotTwist, plotTwist.facets.reversal) : undefined,
  );

  const emotionalPeak = pickFacetCandidate(candidates, "drama", 40, usedTexts);
  addAward(
    emotionalPeak ? makeAward("emotional-peak", emotionalPeak, emotionalPeak.facets.drama) : undefined,
  );

  const progress = pickFacetCandidate(candidates, "progress", 50, usedTexts);
  addAward(
    progress ? makeAward("progress-announcement", progress, progress.facets.progress) : undefined,
  );

  const victoryLap = pickFacetCandidate(candidates, "celebration", 55, usedTexts);
  addAward(
    victoryLap ? makeAward("victory-lap", victoryLap, victoryLap.facets.celebration) : undefined,
  );

  const repeatedPhraseGroups = new Set(
    candidates
      .filter((candidate) => candidate.repetitionCount >= minCatchphraseCount)
      .map((candidate) => normalizeForGrouping(candidate.text)),
  ).size;

  return {
    awards,
    byKind,
    metrics: {
      assistantMessages: messages.filter((message) => message.role === "assistant").length,
      candidateUnits: candidates.length,
      repeatedPhraseGroups,
      discoveryDeclarations: candidates.filter((candidate) => candidate.facets.discovery >= 55).length,
      reversalMoments: candidates.filter((candidate) => candidate.facets.reversal >= 50).length,
      progressAnnouncements: candidates.filter((candidate) => candidate.facets.progress >= 50).length,
      celebrationMoments: candidates.filter((candidate) => candidate.facets.celebration >= 50).length,
    },
  };
}
