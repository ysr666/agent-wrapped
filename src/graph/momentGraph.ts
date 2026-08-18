import type { TranscriptMessage } from "../core/types.js";
import { extractEvents } from "../events/eventExtractor.js";
import type { Event } from "../events/types.js";
import { buildContradictionRelations } from "./contradiction.js";
import { buildRepetitionRelations } from "./repetition.js";
import { buildSequenceRelations } from "./sequence.js";
import type { MomentGraph, MomentGraphOptions, MomentRelation } from "./types.js";

function dedupeRelations(relations: MomentRelation[]): MomentRelation[] {
  const map = new Map<string, MomentRelation>();
  for (const relation of relations) {
    const key = [
      relation.type,
      relation.fromEventId,
      relation.toEventId,
      relation.topic ?? "",
    ].join("\u0000");
    const existing = map.get(key);
    if (!existing || relation.strength > existing.strength) {
      map.set(key, relation);
      continue;
    }
    if (existing) {
      existing.reasons = [...new Set([...existing.reasons, ...relation.reasons])];
      existing.confidence = Math.max(existing.confidence, relation.confidence);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.distance - b.distance ||
      a.fromEventId.localeCompare(b.fromEventId) ||
      a.toEventId.localeCompare(b.toEventId) ||
      a.type.localeCompare(b.type),
  );
}

export function buildMomentGraphFromEvents(
  events: Event[],
  options: MomentGraphOptions = {},
): MomentGraph {
  const relations = dedupeRelations([
    ...buildRepetitionRelations(events, { fuzzy: options.fuzzyRepetition ?? true }),
    ...buildContradictionRelations(events, {
      maxMessageDistance: options.maxMessageDistance ?? 120,
    }),
    ...buildSequenceRelations(events, {
      celebrationWindowMessages: options.celebrationWindowMessages ?? 18,
    }),
  ]);

  return { events, relations };
}

export function buildMomentGraph(
  messages: TranscriptMessage[],
  options: MomentGraphOptions = {},
): MomentGraph {
  return buildMomentGraphFromEvents(extractEvents(messages, { includeNeutral: true }), options);
}

export function eventMap(graph: MomentGraph): Map<string, Event> {
  return new Map(graph.events.map((event) => [event.id, event]));
}

export function relationsOfType(
  graph: MomentGraph,
  type: MomentRelation["type"],
): MomentRelation[] {
  return graph.relations.filter((relation) => relation.type === type);
}
