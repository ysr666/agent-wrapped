import { getEventStrength } from "../events/eventExtractor.js";
import type { Event } from "../events/types.js";
import { clusterRepetitionEvents } from "../graph/repetition.js";
import type { MomentGraph, MomentRelation } from "../graph/types.js";
import type { Moment } from "./types.js";

export interface MomentBuilderOptions {
  /** Minimum standalone-quality signal for one-line moments. Defaults to 28. */
  minOneLinerQuality?: number;
  /** Minimum members required for a repeated-pattern moment. Defaults to 2. */
  minRepeatedCount?: number;
  /** Minimum correction/reversal strength for plot-twist candidates. Defaults to 65. */
  minPlotTwistStrength?: number;
  /** Message window used when assembling three-step correction arcs. Defaults to 60. */
  correctionArcWindowMessages?: number;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function eventMap(graph: MomentGraph): Map<string, Event> {
  return new Map(graph.events.map((event) => [event.id, event]));
}

function relationsOfType(graph: MomentGraph, type: MomentRelation["type"]): MomentRelation[] {
  return graph.relations.filter((relation) => relation.type === type);
}

function internalRelationIds(graph: MomentGraph, eventIds: string[]): string[] {
  const ids = new Set(eventIds);
  return graph.relations
    .filter((relation) => ids.has(relation.fromEventId) && ids.has(relation.toEventId))
    .map((relation) => relation.id);
}

function strongestSignals(event: Event): string[] {
  return Object.entries(event.signals)
    .filter((entry): entry is [string, { strength: number; confidence: number; cues: string[] }] => Boolean(entry[1]))
    .sort((a, b) => b[1].strength - a[1].strength)
    .slice(0, 3)
    .map(([type, signal]) => `${type}:${signal.strength}`);
}

function makeOneLiners(graph: MomentGraph, minQuality: number): Moment[] {
  return graph.events
    .filter(
      (event) =>
        event.primaryType !== "neutral" &&
        Math.max(event.standaloneQuality, event.drama) >= minQuality,
    )
    .map((event) => ({
      id: `one_liner:${event.id}`,
      type: "one_liner" as const,
      eventIds: [event.id],
      relationIds: [],
      messageIndexes: [event.messageIndex],
      primaryText: event.text,
      relatedTexts: [],
      topic: event.topics[0]?.topic,
      topicLabel: event.topics[0]?.label,
      evidence: strongestSignals(event),
    }));
}

function makeRepeatedPatterns(graph: MomentGraph, minCount: number): Moment[] {
  return clusterRepetitionEvents(graph.events, graph.relations, minCount).map((cluster) => ({
    id: `repeated_pattern:${cluster.eventIds.join("+")}`,
    type: "repeated_pattern" as const,
    eventIds: cluster.eventIds,
    relationIds: internalRelationIds(graph, cluster.eventIds).filter((relationId) =>
      /^(?:repeats|similar_to):/u.test(relationId),
    ),
    messageIndexes: cluster.messageIndexes,
    primaryText: cluster.canonicalText,
    relatedTexts: cluster.variants.filter((variant) => variant !== cluster.canonicalText),
    family: cluster.family,
    count: cluster.count,
    variants: cluster.variants,
    evidence: [
      `repeated ${cluster.count} times`,
      ...(cluster.family ? [`verbal family: ${cluster.family}`] : []),
      `cluster confidence: ${cluster.confidence}`,
    ],
  }));
}

function makeBoomerangs(graph: MomentGraph, byId: Map<string, Event>): Moment[] {
  const moments: Moment[] = [];
  for (const relation of relationsOfType(graph, "contradicts")) {
    const before = byId.get(relation.fromEventId);
    const after = byId.get(relation.toEventId);
    if (!before || !after) continue;
    moments.push({
      id: `boomerang:${relation.id}`,
      type: "boomerang",
      eventIds: [before.id, after.id],
      relationIds: [relation.id],
      messageIndexes: uniqueSorted([before.messageIndex, after.messageIndex]),
      primaryText: before.text,
      relatedTexts: [after.text],
      topic: relation.topic,
      topicLabel: relation.topicLabel,
      evidence: [...relation.reasons],
    });
  }
  return moments;
}

function makeFalseDawns(graph: MomentGraph, byId: Map<string, Event>): Moment[] {
  const moments: Moment[] = [];
  for (const relation of relationsOfType(graph, "celebrates_before")) {
    const before = byId.get(relation.fromEventId);
    const after = byId.get(relation.toEventId);
    if (!before || !after) continue;
    moments.push({
      id: `false_dawn:${relation.id}`,
      type: "false_dawn",
      eventIds: [before.id, after.id],
      relationIds: [relation.id],
      messageIndexes: uniqueSorted([before.messageIndex, after.messageIndex]),
      primaryText: before.text,
      relatedTexts: [after.text],
      evidence: [...relation.reasons],
    });
  }
  return moments;
}

function makePlotTwists(
  graph: MomentGraph,
  byId: Map<string, Event>,
  minStrength: number,
): Moment[] {
  const moments: Moment[] = [];
  const retractedTargets = new Set<string>();

  for (const relation of relationsOfType(graph, "retracts")) {
    const before = byId.get(relation.fromEventId);
    const after = byId.get(relation.toEventId);
    if (!before || !after) continue;
    retractedTargets.add(after.id);
    moments.push({
      id: `plot_twist:${relation.id}`,
      type: "plot_twist",
      eventIds: [before.id, after.id],
      relationIds: [relation.id],
      messageIndexes: uniqueSorted([before.messageIndex, after.messageIndex]),
      primaryText: after.text,
      relatedTexts: [before.text],
      topic: relation.topic,
      topicLabel: relation.topicLabel,
      evidence: [...relation.reasons, "explicit retraction/reversal"],
    });
  }

  for (const event of graph.events) {
    if (retractedTargets.has(event.id)) continue;
    const strength = Math.max(
      getEventStrength(event, "reversal"),
      getEventStrength(event, "correction"),
    );
    if (strength < minStrength) continue;
    moments.push({
      id: `plot_twist:${event.id}`,
      type: "plot_twist",
      eventIds: [event.id],
      relationIds: [],
      messageIndexes: [event.messageIndex],
      primaryText: event.text,
      relatedTexts: [],
      topic: event.topics[0]?.topic,
      topicLabel: event.topics[0]?.label,
      evidence: [`explicit correction/reversal strength: ${strength}`],
    });
  }

  return moments;
}

function qualifiesBeforeCorrection(event: Event): boolean {
  return (
    getEventStrength(event, "discovery_claim") >= 50 ||
    getEventStrength(event, "resolution_claim") >= 55 ||
    getEventStrength(event, "confidence_claim") >= 65 ||
    event.claims.length > 0
  );
}

function qualifiesAfterCorrection(event: Event): boolean {
  return (
    getEventStrength(event, "discovery_claim") >= 50 ||
    getEventStrength(event, "resolution_claim") >= 55 ||
    getEventStrength(event, "correction") >= 65 ||
    getEventStrength(event, "reversal") >= 65 ||
    event.claims.length > 0
  );
}

function makeCorrectionArcs(graph: MomentGraph, windowMessages: number): Moment[] {
  const sorted = [...graph.events].sort(
    (a, b) => a.messageIndex - b.messageIndex || a.unitIndex - b.unitIndex,
  );
  const moments: Moment[] = [];
  const seen = new Set<string>();

  for (let pivotIndex = 0; pivotIndex < sorted.length; pivotIndex += 1) {
    const pivot = sorted[pivotIndex];
    if (!pivot) continue;
    const correctionStrength = Math.max(
      getEventStrength(pivot, "correction"),
      getEventStrength(pivot, "reversal"),
    );
    if (correctionStrength < 65) continue;

    let before: Event | undefined;
    for (let index = pivotIndex - 1; index >= 0; index -= 1) {
      const candidate = sorted[index];
      if (!candidate) continue;
      const distance = pivot.messageIndex - candidate.messageIndex;
      if (distance > windowMessages) break;
      if (qualifiesBeforeCorrection(candidate)) {
        before = candidate;
        break;
      }
    }

    let after: Event | undefined;
    for (let index = pivotIndex + 1; index < sorted.length; index += 1) {
      const candidate = sorted[index];
      if (!candidate) continue;
      const distance = candidate.messageIndex - pivot.messageIndex;
      if (distance > windowMessages) break;
      if (qualifiesAfterCorrection(candidate)) {
        after = candidate;
        break;
      }
    }

    if (!before || !after) continue;
    const eventIds = [before.id, pivot.id, after.id];
    const key = eventIds.join("+");
    if (seen.has(key)) continue;
    seen.add(key);

    moments.push({
      id: `correction_arc:${key}`,
      type: "correction_arc",
      eventIds,
      relationIds: internalRelationIds(graph, eventIds),
      messageIndexes: uniqueSorted([before.messageIndex, pivot.messageIndex, after.messageIndex]),
      primaryText: pivot.text,
      relatedTexts: [before.text, after.text],
      topic: pivot.topics[0]?.topic ?? after.topics[0]?.topic ?? before.topics[0]?.topic,
      topicLabel: pivot.topics[0]?.label ?? after.topics[0]?.label ?? before.topics[0]?.label,
      evidence: [
        "earlier confident/discovery state",
        "explicit correction/reversal pivot",
        "later renewed diagnosis/discovery state",
      ],
    });
  }

  return moments;
}

/**
 * P2: compose graph events and relations into human-readable Moment candidates.
 *
 * The builder deliberately does not rank candidates or decide awards. It may
 * emit overlapping moments (for example one line can belong to both a
 * plot-twist and a correction arc); P3 handles ranking and P3.5 handles final
 * presentation diversity.
 */
export function buildMoments(
  graph: MomentGraph,
  options: MomentBuilderOptions = {},
): Moment[] {
  const minOneLinerQuality = options.minOneLinerQuality ?? 28;
  const minRepeatedCount = options.minRepeatedCount ?? 2;
  const minPlotTwistStrength = options.minPlotTwistStrength ?? 65;
  const correctionArcWindowMessages = options.correctionArcWindowMessages ?? 60;
  const byId = eventMap(graph);

  return [
    ...makeOneLiners(graph, minOneLinerQuality),
    ...makeRepeatedPatterns(graph, minRepeatedCount),
    ...makeBoomerangs(graph, byId),
    ...makeFalseDawns(graph, byId),
    ...makePlotTwists(graph, byId, minPlotTwistStrength),
    ...makeCorrectionArcs(graph, correctionArcWindowMessages),
  ];
}
