import { scoreQuoteFacets, type QuoteFacetScores } from "./facetScorer.js";
import type { TranscriptMessage } from "./types.js";
import {
  buildMomentGraph,
  eventMap,
  relationsOfType,
} from "../graph/momentGraph.js";
import {
  clusterRepetitionEvents,
  type RepetitionCluster,
} from "../graph/repetition.js";
import type { MomentGraph, MomentRelation } from "../graph/types.js";

export type SessionAwardKind =
  | "quote"
  | "catchphrase"
  | "wolf-cry"
  | "boomerang"
  | "premature-celebration"
  | "plot-twist"
  | "emotional-peak"
  | "progress-announcement"
  | "victory-lap";

export interface SessionCandidate {
  eventId: string;
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
  variants?: string[];
  clusterFamily?: string;
  relatedText?: string;
  relatedMessageIndex?: number;
  topic?: string;
  reasons?: string[];
  facets?: QuoteFacetScores;
}

export interface SessionMetrics {
  assistantMessages: number;
  candidateUnits: number;
  repeatedPhraseGroups: number;
  discoveryDeclarations: number;
  reversalMoments: number;
  boomerangMoments: number;
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
  boomerangWindowMessages?: number;
}

const AWARD_META: Record<SessionAwardKind, { title: string; emoji: string }> = {
  quote: { title: "Quote of the session", emoji: "🏆" },
  catchphrase: { title: "Catchphrase", emoji: "📢" },
  "wolf-cry": { title: "Called it too early", emoji: "🐺" },
  boomerang: { title: "Biggest boomerang", emoji: "🤡" },
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
    .normalize("NFKC")
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

function buildCandidates(graph: MomentGraph): SessionCandidate[] {
  const clusters = clusterRepetitionEvents(graph.events, graph.relations, 1);
  const repetitionCounts = new Map<string, number>();
  for (const cluster of clusters) {
    for (const eventId of cluster.eventIds) repetitionCounts.set(eventId, cluster.count);
  }

  return graph.events
    .filter((event) => event.text.length >= 4)
    .map((event) => {
      const repetitionCount = repetitionCounts.get(event.id) ?? 1;
      return {
        eventId: event.id,
        text: event.text,
        messageIndex: event.messageIndex,
        repetitionCount,
        facets: scoreQuoteFacets(event.text, repetitionCount),
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

  // The legacy recap is more fun when one spectacular sentence does not occupy
  // every category. P3/P3.5 will replace this with Moment ranking/composition.
  const diverse = ranked.find(
    (candidate) =>
      !usedTexts.has(normalizeForGrouping(candidate.text)) &&
      candidate.facets[facet] >= best.facets[facet] * 0.8,
  );

  return diverse ?? best;
}

function findCandidateForEvent(
  candidates: SessionCandidate[],
  eventId: string,
): SessionCandidate | undefined {
  return candidates.find((candidate) => candidate.eventId === eventId);
}

function rankCatchphraseClusters(
  graph: MomentGraph,
  candidates: SessionCandidate[],
  minCount: number,
): Array<{ cluster: RepetitionCluster; representative: SessionCandidate; score: number }> {
  return clusterRepetitionEvents(graph.events, graph.relations, minCount)
    .map((cluster) => {
      const memberCandidates = cluster.eventIds
        .map((eventId) => findCandidateForEvent(candidates, eventId))
        .filter((candidate): candidate is SessionCandidate => Boolean(candidate));
      const representative = [...memberCandidates].sort(
        (a, b) => b.facets.drama - a.facets.drama || b.facets.quote - a.facets.quote || a.messageIndex - b.messageIndex,
      )[0];
      const baseScore = Math.max(0, ...memberCandidates.map((candidate) => candidate.facets.catchphrase));
      const score = Math.min(100, baseScore + Math.min(12, Math.max(0, cluster.count - 2) * 3));
      return { cluster, representative, score };
    })
    .filter(
      (entry): entry is { cluster: RepetitionCluster; representative: SessionCandidate; score: number } =>
        Boolean(entry.representative),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.cluster.count - a.cluster.count ||
        b.cluster.confidence - a.cluster.confidence ||
        (a.cluster.messageIndexes[0] ?? 0) - (b.cluster.messageIndexes[0] ?? 0),
    );
}

function findCatchphrase(
  graph: MomentGraph,
  candidates: SessionCandidate[],
  minCount: number,
): SessionAward | undefined {
  const winner = rankCatchphraseClusters(graph, candidates, minCount)[0];
  if (!winner) return undefined;

  return makeAward("catchphrase", winner.representative, winner.score, {
    text: winner.cluster.canonicalText,
    count: winner.cluster.count,
    variants: winner.cluster.variants,
    clusterFamily: winner.cluster.family,
    messageIndexes: winner.cluster.messageIndexes,
  });
}

function findWolfCry(
  graph: MomentGraph,
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
  if (!representative) return undefined;

  const bestDiscovery = Math.max(...declarations.map((candidate) => candidate.facets.discovery));
  const score = bestDiscovery * 0.55 + Math.min(45, declarations.length * 10);
  const declarationIds = new Set(declarations.map((candidate) => candidate.eventId));
  const declarationEvents = graph.events.filter((event) => declarationIds.has(event.id));
  const rootCauseCluster = clusterRepetitionEvents(
    declarationEvents,
    graph.relations,
    1,
  ).sort((a, b) => b.count - a.count || b.confidence - a.confidence)[0];

  return makeAward("wolf-cry", representative, score, {
    count: declarations.length,
    variants: rootCauseCluster?.count && rootCauseCluster.count > 1 ? rootCauseCluster.variants : undefined,
    clusterFamily: rootCauseCluster?.count && rootCauseCluster.count > 1 ? rootCauseCluster.family : undefined,
    messageIndexes: uniqueSorted(declarations.map((candidate) => candidate.messageIndex)),
  });
}

function strongestRelation(
  relations: MomentRelation[],
): MomentRelation | undefined {
  return [...relations].sort(
    (a, b) =>
      b.strength - a.strength ||
      b.confidence - a.confidence ||
      a.distance - b.distance,
  )[0];
}

function findPrematureCelebration(
  graph: MomentGraph,
  candidates: SessionCandidate[],
): SessionAward | undefined {
  const relation = strongestRelation(relationsOfType(graph, "celebrates_before"));
  if (!relation) return undefined;
  const before = findCandidateForEvent(candidates, relation.fromEventId);
  const after = findCandidateForEvent(candidates, relation.toEventId);
  if (!before || !after) return undefined;

  return makeAward("premature-celebration", before, relation.strength, {
    messageIndexes: [before.messageIndex, after.messageIndex],
    relatedText: after.text,
    relatedMessageIndex: after.messageIndex,
    reasons: relation.reasons,
  });
}

function findBoomerang(
  graph: MomentGraph,
  candidates: SessionCandidate[],
): SessionAward | undefined {
  const relation = strongestRelation(relationsOfType(graph, "contradicts"));
  if (!relation) return undefined;
  const before = findCandidateForEvent(candidates, relation.fromEventId);
  const after = findCandidateForEvent(candidates, relation.toEventId);
  if (!before || !after) return undefined;
  const meta = AWARD_META.boomerang;

  return {
    kind: "boomerang",
    title: meta.title,
    emoji: meta.emoji,
    score: relation.strength,
    text: before.text,
    relatedText: after.text,
    relatedMessageIndex: after.messageIndex,
    messageIndexes: [before.messageIndex, after.messageIndex],
    topic: relation.topicLabel,
    reasons: relation.reasons,
  };
}

export function analyzeSession(
  messages: TranscriptMessage[],
  options: SessionAnalyzerOptions = {},
): SessionAnalysis {
  const minCatchphraseCount = options.minCatchphraseCount ?? 2;
  const minWolfCryDeclarations = options.minWolfCryDeclarations ?? 2;
  const contextWindowMessages = options.contextWindowMessages ?? 18;
  const boomerangWindowMessages = options.boomerangWindowMessages ?? 120;
  const graph = buildMomentGraph(messages, {
    celebrationWindowMessages: contextWindowMessages,
    maxMessageDistance: boomerangWindowMessages,
    fuzzyRepetition: true,
  });
  const candidates = buildCandidates(graph);
  const contradictions = relationsOfType(graph, "contradicts");

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

  addAward(findCatchphrase(graph, candidates, minCatchphraseCount));
  addAward(findWolfCry(graph, candidates, minWolfCryDeclarations));

  // Pair awards may intentionally reuse a line. Their value comes from the
  // before→after graph relation rather than the standalone sentence.
  addAward(findBoomerang(graph, candidates), false);
  addAward(findPrematureCelebration(graph, candidates), false);

  const plotTwist = pickFacetCandidate(candidates, "reversal", 50, usedTexts);
  addAward(
    plotTwist ? makeAward("plot-twist", plotTwist, plotTwist.facets.reversal) : undefined,
  );

  const progress = pickFacetCandidate(candidates, "progress", 50, usedTexts);
  addAward(
    progress ? makeAward("progress-announcement", progress, progress.facets.progress) : undefined,
  );

  const emotionalPeak = pickFacetCandidate(candidates, "drama", 40, usedTexts);
  addAward(
    emotionalPeak ? makeAward("emotional-peak", emotionalPeak, emotionalPeak.facets.drama) : undefined,
  );

  const victoryLap = pickFacetCandidate(candidates, "celebration", 55, usedTexts);
  addAward(
    victoryLap ? makeAward("victory-lap", victoryLap, victoryLap.facets.celebration) : undefined,
  );

  const repeatedPhraseGroups = clusterRepetitionEvents(
    graph.events,
    graph.relations,
    minCatchphraseCount,
  ).length;

  return {
    awards,
    byKind,
    metrics: {
      assistantMessages: messages.filter((message) => message.role === "assistant").length,
      candidateUnits: candidates.length,
      repeatedPhraseGroups,
      discoveryDeclarations: candidates.filter((candidate) => candidate.facets.discovery >= 55).length,
      reversalMoments: candidates.filter((candidate) => candidate.facets.reversal >= 50).length,
      boomerangMoments: contradictions.length,
      progressAnnouncements: candidates.filter((candidate) => candidate.facets.progress >= 50).length,
      celebrationMoments: candidates.filter((candidate) => candidate.facets.celebration >= 50).length,
    },
  };
}
