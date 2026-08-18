import { detectBoomerangs } from "./boomerangDetector.js";
import {
  clusterCatchphraseCandidates,
  type CatchphraseCluster,
} from "./catchphraseClusterer.js";
import { scoreQuoteFacets, type QuoteFacetScores } from "./facetScorer.js";
import { rankQuoteCandidates } from "./quoteScorer.js";
import type { TranscriptMessage } from "./types.js";

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

function memberKey(text: string, messageIndex: number): string {
  return `${messageIndex}\u0000${normalizeForGrouping(text)}`;
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

function clusterCandidates(candidates: Array<{ text: string; messageIndex: number }>, minCount = 1): CatchphraseCluster[] {
  return clusterCatchphraseCandidates(candidates, {
    minCount,
    fuzzy: true,
  });
}

function buildCandidates(messages: TranscriptMessage[]): SessionCandidate[] {
  // Reuse QuoteScorer's sentence-like extraction instead of maintaining a second
  // tokenizer. We request every candidate and do the session-level scoring here.
  const extracted = rankQuoteCandidates(messages, {
    limit: Math.max(256, messages.length * 32),
    minScore: 0,
    penalizeRepetition: false,
  });

  // Repetition is cluster-aware: paraphrases such as “问题已经很明确了” and
  // “这下问题非常清楚了” can count as the same verbal tic.
  const clusters = clusterCandidates(
    extracted.map((candidate) => ({ text: candidate.text, messageIndex: candidate.messageIndex })),
  );
  const repetitionCounts = new Map<string, number>();
  for (const cluster of clusters) {
    for (const member of cluster.members) {
      repetitionCounts.set(memberKey(member.text, member.messageIndex), cluster.count);
    }
  }

  return extracted.map((candidate) => {
    const repetitionCount = repetitionCounts.get(memberKey(candidate.text, candidate.messageIndex)) ?? 1;
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

function findCandidateForMember(
  candidates: SessionCandidate[],
  text: string,
  messageIndex: number,
): SessionCandidate | undefined {
  return candidates.find(
    (candidate) =>
      candidate.messageIndex === messageIndex &&
      normalizeForGrouping(candidate.text) === normalizeForGrouping(text),
  );
}

function findCatchphrase(
  candidates: SessionCandidate[],
  minCount: number,
): SessionAward | undefined {
  const clusters = clusterCandidates(candidates, minCount);
  if (clusters.length === 0) return undefined;

  const ranked = clusters
    .map((cluster) => {
      const memberCandidates = cluster.members
        .map((member) => findCandidateForMember(candidates, member.text, member.messageIndex))
        .filter((candidate): candidate is SessionCandidate => Boolean(candidate));
      const representative = memberCandidates.sort(
        (a, b) => b.facets.drama - a.facets.drama || b.facets.quote - a.facets.quote || a.messageIndex - b.messageIndex,
      )[0];
      const baseScore = Math.max(0, ...memberCandidates.map((candidate) => candidate.facets.catchphrase));
      const score = Math.min(100, baseScore + Math.min(12, Math.max(0, cluster.count - 2) * 3));
      return { cluster, representative, score };
    })
    .filter(
      (entry): entry is { cluster: CatchphraseCluster; representative: SessionCandidate; score: number } =>
        Boolean(entry.representative),
    )
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.cluster.count - a.cluster.count ||
        b.cluster.confidence - a.cluster.confidence ||
        a.cluster.messageIndexes[0]! - b.cluster.messageIndexes[0]!,
    );

  const winner = ranked[0];
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

  const rootCauseCluster = clusterCandidates(declarations, 1).sort(
    (a, b) => b.count - a.count || b.confidence - a.confidence,
  )[0];

  return makeAward("wolf-cry", representative, score, {
    count: declarations.length,
    variants: rootCauseCluster?.count && rootCauseCluster.count > 1 ? rootCauseCluster.variants : undefined,
    clusterFamily: rootCauseCluster?.count && rootCauseCluster.count > 1 ? rootCauseCluster.family : undefined,
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
  const boomerangWindowMessages = options.boomerangWindowMessages ?? 120;
  const candidates = buildCandidates(messages);
  const boomerangs = detectBoomerangs(messages, {
    maxMessageDistance: boomerangWindowMessages,
    minScore: 45,
    limit: Math.max(100, messages.length * 4),
  });

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

  // Boomerang is a pair award, so it may intentionally reuse a line that also
  // appears as the quote or plot-twist card. The before→after relationship is
  // the entertainment value here, not a standalone sentence.
  const boomerang = boomerangs[0];
  if (boomerang) {
    const meta = AWARD_META.boomerang;
    addAward(
      {
        kind: "boomerang",
        title: meta.title,
        emoji: meta.emoji,
        score: boomerang.score,
        text: boomerang.beforeText,
        relatedText: boomerang.afterText,
        relatedMessageIndex: boomerang.afterMessageIndex,
        messageIndexes: [boomerang.beforeMessageIndex, boomerang.afterMessageIndex],
        topic: boomerang.topicLabel,
        reasons: boomerang.reasons,
      },
      false,
    );
  }

  const prematureCelebration = findPrematureCelebration(candidates, contextWindowMessages);
  addAward(prematureCelebration);

  const plotTwist = pickFacetCandidate(candidates, "reversal", 50, usedTexts);
  addAward(
    plotTwist ? makeAward("plot-twist", plotTwist, plotTwist.facets.reversal) : undefined,
  );

  // Reserve strong progress narration before selecting the general emotional
  // peak, otherwise a line like “重大进展！！！” can occupy both cards.
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

  const repeatedPhraseGroups = clusterCandidates(candidates, minCatchphraseCount).length;

  return {
    awards,
    byKind,
    metrics: {
      assistantMessages: messages.filter((message) => message.role === "assistant").length,
      candidateUnits: candidates.length,
      repeatedPhraseGroups,
      discoveryDeclarations: candidates.filter((candidate) => candidate.facets.discovery >= 55).length,
      reversalMoments: candidates.filter((candidate) => candidate.facets.reversal >= 50).length,
      boomerangMoments: boomerangs.length,
      progressAnnouncements: candidates.filter((candidate) => candidate.facets.progress >= 50).length,
      celebrationMoments: candidates.filter((candidate) => candidate.facets.celebration >= 50).length,
    },
  };
}
