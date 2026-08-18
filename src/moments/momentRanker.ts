import type { TranscriptMessage } from "../core/types.js";
import { getEventStrength } from "../events/eventExtractor.js";
import type { Event } from "../events/types.js";
import { buildMomentGraph } from "../graph/momentGraph.js";
import type { MomentGraph, MomentGraphOptions, MomentRelation } from "../graph/types.js";
import { buildMoments, type MomentBuilderOptions } from "./momentBuilder.js";
import type { Moment, MomentScores, MomentType, RankedMoment } from "./types.js";

export interface MomentRankerOptions {
  /** Maximum moments returned. Defaults to all candidates. */
  limit?: number;
  /** Minimum entertainment score required. Defaults to 0. */
  minFunScore?: number;
  /** Minimum structural/extraction confidence required. Defaults to 0. */
  minConfidence?: number;
}

export interface AnalyzeMomentsOptions {
  graph?: MomentGraphOptions;
  builder?: MomentBuilderOptions;
  ranker?: MomentRankerOptions;
}

type ScoreDimension =
  | "standaloneQuality"
  | "contextPayoff"
  | "surprise"
  | "rarity"
  | "readability"
  | "structuralStrength";

type MomentWeights = Record<ScoreDimension, number>;

const TYPE_WEIGHTS: Record<MomentType, MomentWeights> = {
  one_liner: {
    standaloneQuality: 0.42,
    contextPayoff: 0.08,
    surprise: 0.24,
    rarity: 0.08,
    readability: 0.12,
    structuralStrength: 0.06,
  },
  repeated_pattern: {
    standaloneQuality: 0.15,
    contextPayoff: 0.27,
    surprise: 0.10,
    rarity: 0.13,
    readability: 0.10,
    structuralStrength: 0.25,
  },
  boomerang: {
    standaloneQuality: 0.12,
    contextPayoff: 0.31,
    surprise: 0.25,
    rarity: 0.10,
    readability: 0.10,
    structuralStrength: 0.12,
  },
  false_dawn: {
    standaloneQuality: 0.13,
    contextPayoff: 0.32,
    surprise: 0.22,
    rarity: 0.10,
    readability: 0.11,
    structuralStrength: 0.12,
  },
  plot_twist: {
    standaloneQuality: 0.25,
    contextPayoff: 0.20,
    surprise: 0.28,
    rarity: 0.10,
    readability: 0.10,
    structuralStrength: 0.07,
  },
  correction_arc: {
    standaloneQuality: 0.12,
    contextPayoff: 0.30,
    surprise: 0.22,
    rarity: 0.10,
    readability: 0.08,
    structuralStrength: 0.18,
  },
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

function momentEvents(graph: MomentGraph, moment: Moment): Event[] {
  const events = byId(graph.events);
  return moment.eventIds
    .map((id) => events.get(id))
    .filter((event): event is Event => Boolean(event));
}

function momentRelations(graph: MomentGraph, moment: Moment): MomentRelation[] {
  const relations = byId(graph.relations);
  return moment.relationIds
    .map((id) => relations.get(id))
    .filter((relation): relation is MomentRelation => Boolean(relation));
}

function maxEventSignal(events: Event[], type: Parameters<typeof getEventStrength>[1]): number {
  return Math.max(0, ...events.map((event) => getEventStrength(event, type)));
}

function semanticEventStrength(events: Event[]): number {
  return Math.max(
    0,
    ...events.flatMap((event) =>
      Object.values(event.signals)
        .filter(Boolean)
        .map((signal) => signal?.strength ?? 0),
    ),
  );
}

function scoreStandalone(events: Event[]): number {
  if (events.length === 0) return 0;
  const values = events.map((event) => event.standaloneQuality);
  return clamp(Math.max(...values) * 0.72 + average(values) * 0.28);
}

function scoreStructuralStrength(events: Event[], relations: MomentRelation[]): number {
  const eventStrength = semanticEventStrength(events);
  const meaningful = relations.filter(
    (relation) => relation.type !== "followed_by" && relation.type !== "same_topic",
  );
  if (meaningful.length === 0) return clamp(eventStrength);
  const relationStrengths = meaningful.map((relation) => relation.strength);
  return clamp(Math.max(...relationStrengths) * 0.68 + eventStrength * 0.32);
}

function scoreContextPayoff(
  moment: Moment,
  structuralStrength: number,
): number {
  switch (moment.type) {
    case "one_liner":
      return moment.relatedTexts.length > 0 ? 25 : 8;
    case "repeated_pattern":
      return clamp(35 + Math.min(38, Math.max(0, (moment.count ?? 2) - 2) * 9) + structuralStrength * 0.24);
    case "boomerang":
      return clamp(55 + structuralStrength * 0.45);
    case "false_dawn":
      return clamp(52 + structuralStrength * 0.44);
    case "plot_twist":
      return clamp((moment.relatedTexts.length > 0 ? 46 : 24) + structuralStrength * 0.42);
    case "correction_arc":
      return clamp(64 + Math.min(12, Math.max(0, moment.eventIds.length - 3) * 4) + structuralStrength * 0.24);
  }
}

function scoreSurprise(
  moment: Moment,
  events: Event[],
  relations: MomentRelation[],
): number {
  const reversal = maxEventSignal(events, "reversal");
  const correction = maxEventSignal(events, "correction");
  const confusion = maxEventSignal(events, "confusion");
  const discovery = maxEventSignal(events, "discovery_claim");
  let structuralSurprise = 0;

  for (const relation of relations) {
    if (relation.type === "contradicts") structuralSurprise = Math.max(structuralSurprise, 96);
    else if (relation.type === "retracts") structuralSurprise = Math.max(structuralSurprise, 92);
    else if (relation.type === "celebrates_before") structuralSurprise = Math.max(structuralSurprise, 86);
  }

  const typeFloor: Record<MomentType, number> = {
    one_liner: 0,
    repeated_pattern: 28,
    boomerang: 90,
    false_dawn: 82,
    plot_twist: 72,
    correction_arc: 78,
  };

  return clamp(
    Math.max(
      typeFloor[moment.type],
      structuralSurprise,
      reversal,
      correction * 0.92,
      confusion * 0.82,
      discovery * 0.58,
    ),
  );
}

function scoreRarity(moment: Moment, allMoments: Moment[]): number {
  if (allMoments.length <= 1) return 100;
  const sameType = allMoments.filter((candidate) => candidate.type === moment.type).length;
  const typeShare = sameType / allMoments.length;
  return clamp(100 - typeShare * 68);
}

function scoreReadability(moment: Moment): number {
  const displayTexts = [moment.primaryText, ...moment.relatedTexts.slice(0, 2)].filter(Boolean);
  const totalLength = displayTexts.reduce((sum, text) => sum + text.trim().length, 0);
  if (totalLength === 0) return 0;
  if (totalLength < 8) return clamp(45 + totalLength * 6);
  if (totalLength <= 220) return 100;
  return clamp(100 - (totalLength - 220) * 0.22);
}

function scoreConfidence(events: Event[], relations: MomentRelation[]): number {
  if (events.length === 0) return 0;
  const eventConfidence = Math.min(...events.map((event) => event.confidence));
  const meaningful = relations.filter(
    (relation) => relation.type !== "followed_by" && relation.type !== "same_topic",
  );
  if (meaningful.length === 0) return clamp(eventConfidence);
  const relationConfidence = Math.min(...meaningful.map((relation) => relation.confidence));
  return clamp(relationConfidence * 0.68 + eventConfidence * 0.32);
}

function typeBonus(moment: Moment): number {
  switch (moment.type) {
    case "one_liner":
      return 0;
    case "repeated_pattern":
      return Math.min(10, Math.max(0, (moment.count ?? 2) - 2) * 2.5);
    case "boomerang":
      return 4;
    case "false_dawn":
      return 4;
    case "plot_twist":
      return 3;
    case "correction_arc":
      return 5;
  }
}

/**
 * P3: score a composed Moment on entertainment value and confidence separately.
 *
 * Confidence never multiplies `funScore`. A hilarious but uncertain semantic
 * candidate should remain visible to a future semantic reranker instead of
 * being silently demoted as "not funny".
 */
export function scoreMoment(
  graph: MomentGraph,
  moment: Moment,
  allMoments: Moment[] = [moment],
): MomentScores {
  const events = momentEvents(graph, moment);
  const relations = momentRelations(graph, moment);
  const standaloneQuality = scoreStandalone(events);
  const structuralStrength = scoreStructuralStrength(events, relations);
  const contextPayoff = scoreContextPayoff(moment, structuralStrength);
  const surprise = scoreSurprise(moment, events, relations);
  const rarity = scoreRarity(moment, allMoments);
  const readability = scoreReadability(moment);
  const confidence = scoreConfidence(events, relations);
  const weights = TYPE_WEIGHTS[moment.type];

  const funScore = clamp(
    standaloneQuality * weights.standaloneQuality +
      contextPayoff * weights.contextPayoff +
      surprise * weights.surprise +
      rarity * weights.rarity +
      readability * weights.readability +
      structuralStrength * weights.structuralStrength +
      typeBonus(moment),
  );

  return {
    funScore,
    confidence,
    standaloneQuality,
    contextPayoff,
    surprise,
    rarity,
    readability,
    structuralStrength,
  };
}

export function rankMoments(
  graph: MomentGraph,
  moments: Moment[],
  options: MomentRankerOptions = {},
): RankedMoment[] {
  const minFunScore = options.minFunScore ?? 0;
  const minConfidence = options.minConfidence ?? 0;
  const limit = options.limit ?? moments.length;

  return moments
    .map((moment) => ({
      ...moment,
      scores: scoreMoment(graph, moment, moments),
    }))
    .filter(
      (moment) =>
        moment.scores.funScore >= minFunScore &&
        moment.scores.confidence >= minConfidence,
    )
    .sort(
      (a, b) =>
        b.scores.funScore - a.scores.funScore ||
        b.scores.confidence - a.scores.confidence ||
        b.scores.contextPayoff - a.scores.contextPayoff ||
        (a.messageIndexes[0] ?? 0) - (b.messageIndexes[0] ?? 0),
    )
    .slice(0, Math.max(0, limit));
}

/** Build the P0/P1 graph, compose P2 moments, then rank them with P3. */
export function analyzeMoments(
  messages: TranscriptMessage[],
  options: AnalyzeMomentsOptions = {},
): RankedMoment[] {
  const graph = buildMomentGraph(messages, options.graph);
  const moments = buildMoments(graph, options.builder);
  return rankMoments(graph, moments, options.ranker);
}
