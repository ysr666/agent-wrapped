import { getEventStrength } from "../events/eventExtractor.js";
import type { Event } from "../events/types.js";
import type { MomentRelation } from "./types.js";

export interface SequenceRelationOptions {
  celebrationWindowMessages?: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildSequenceRelations(
  events: Event[],
  options: SequenceRelationOptions = {},
): MomentRelation[] {
  const celebrationWindowMessages = options.celebrationWindowMessages ?? 18;
  const sorted = [...events].sort(
    (a, b) => a.messageIndex - b.messageIndex || a.unitIndex - b.unitIndex,
  );
  const relations: MomentRelation[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    const before = sorted[index - 1];
    const after = sorted[index];
    if (!before || !after) continue;
    relations.push({
      id: `followed_by:${before.id}->${after.id}`,
      fromEventId: before.id,
      toEventId: after.id,
      type: "followed_by",
      strength: 100,
      confidence: 100,
      distance: Math.max(0, after.messageIndex - before.messageIndex),
      reasons: ["chronological adjacency"],
    });
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const before = sorted[index];
    if (!before) continue;
    const celebrationStrength = getEventStrength(before, "celebration");
    const resolutionStrength = getEventStrength(before, "resolution_claim");
    const celebration = Math.max(celebrationStrength, resolutionStrength);
    if (celebration < 60) continue;

    let best:
      | { event: Event; reversal: number; distance: number }
      | undefined;

    for (let laterIndex = index + 1; laterIndex < sorted.length; laterIndex += 1) {
      const after = sorted[laterIndex];
      if (!after) continue;
      const distance = after.messageIndex - before.messageIndex;
      if (distance > celebrationWindowMessages) break;
      if (distance <= 0 && after.messageIndex === before.messageIndex) continue;

      const reversal = Math.max(
        getEventStrength(after, "reversal"),
        getEventStrength(after, "correction"),
      );
      if (reversal < 70) continue;
      if (!best || reversal > best.reversal || (reversal === best.reversal && distance < best.distance)) {
        best = { event: after, reversal, distance };
      }
    }

    if (!best) continue;
    const closeness = Math.max(0, 1 - best.distance / Math.max(1, celebrationWindowMessages));
    // A concrete “fixed / solved / no problem now” claim is stronger false-dawn
    // evidence than a generic cheer such as “Perfect!”. Keep both, but prefer the
    // explicit resolution claim when several celebrations are later overturned.
    const resolutionBonus = resolutionStrength > 0 ? 20 : 0;
    relations.push({
      id: `celebrates_before:${before.id}->${best.event.id}`,
      fromEventId: before.id,
      toEventId: best.event.id,
      type: "celebrates_before",
      strength: clamp(
        celebration * 0.45 +
          best.reversal * 0.45 +
          closeness * 10 +
          resolutionBonus,
      ),
      confidence: clamp(Math.min(before.confidence, best.event.confidence) * 0.9 + 10),
      distance: best.distance,
      reasons: [
        resolutionStrength > 0
          ? "explicit resolution claim followed by an explicit correction or reversal"
          : "celebration followed by an explicit correction or reversal",
      ],
    });
  }

  return relations;
}
