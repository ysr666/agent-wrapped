import { getEventStrength } from "../events/eventExtractor.js";
import { topicsMatch } from "../events/topicResolver.js";
import type { Event, EventClaim, TopicRef } from "../events/types.js";
import type { MomentRelation } from "./types.js";

export interface ContradictionOptions {
  maxMessageDistance?: number;
  /** Bounded recent-event scan for long sessions. Defaults to 80. */
  recentEventWindow?: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function bestTopicMatch(
  before: Event,
  after: Event,
): { before: TopicRef; after: TopicRef; similarity: number } | undefined {
  let best: { before: TopicRef; after: TopicRef; similarity: number } | undefined;
  for (const left of before.topics) {
    for (const right of after.topics) {
      const match = topicsMatch(left, right);
      if (!match.match) continue;
      if (!best || match.similarity > best.similarity) {
        best = { before: left, after: right, similarity: match.similarity };
      }
    }
  }
  return best;
}

function claimsContradict(before: EventClaim, after: EventClaim): boolean {
  return (
    (before.stance === "exclude" && (after.stance === "blame" || after.stance === "affirm")) ||
    ((before.stance === "blame" || before.stance === "affirm") && after.stance === "exclude")
  );
}

function bestContradictingClaims(
  before: Event,
  after: Event,
): { before: EventClaim; after: EventClaim; similarity: number } | undefined {
  let best:
    | { before: EventClaim; after: EventClaim; similarity: number; score: number }
    | undefined;

  for (const left of before.claims) {
    for (const right of after.claims) {
      if (!claimsContradict(left, right)) continue;
      const match = topicsMatch(left, right);
      if (!match.match) continue;
      const score = left.strength + right.strength + match.similarity * 40;
      if (!best || score > best.score) {
        best = { before: left, after: right, similarity: match.similarity, score };
      }
    }
  }

  if (!best) return undefined;
  return { before: best.before, after: best.after, similarity: best.similarity };
}

function sameTopicRelation(
  before: Event,
  after: Event,
  topicMatch: { before: TopicRef; after: TopicRef; similarity: number },
): MomentRelation {
  return {
    id: `same_topic:${before.id}->${after.id}:${topicMatch.before.topic}`,
    fromEventId: before.id,
    toEventId: after.id,
    type: "same_topic",
    strength: clamp(72 + topicMatch.similarity * 28),
    confidence: clamp(Math.min(topicMatch.before.confidence, topicMatch.after.confidence)),
    distance: Math.max(0, after.messageIndex - before.messageIndex),
    topic: topicMatch.before.topic,
    topicLabel: topicMatch.before.label,
    reasons: [`same topic: ${topicMatch.before.label}`],
  };
}

function contradictionRelation(
  before: Event,
  after: Event,
  claims: { before: EventClaim; after: EventClaim; similarity: number },
  maxMessageDistance: number,
): MomentRelation {
  const distance = Math.max(0, after.messageIndex - before.messageIndex);
  const laterCorrection = Math.max(
    getEventStrength(after, "correction"),
    getEventStrength(after, "reversal"),
  );
  const closeness = Math.max(0, 1 - distance / Math.max(1, maxMessageDistance));
  const strength = clamp(
    24 +
      (claims.before.strength + claims.after.strength) * 0.31 +
      claims.similarity * 12 +
      closeness * 8 +
      laterCorrection * 0.08,
  );
  const confidence = clamp(
    Math.min(claims.before.confidence, claims.after.confidence) * 0.82 +
      claims.similarity * 18,
  );
  const reasons = [
    `same topic: ${claims.before.topicLabel}`,
    `${claims.before.stance} → ${claims.after.stance}`,
  ];
  if (claims.before.stance === "exclude" && claims.after.stance === "blame") {
    reasons.push("classic rule-out → root-cause reversal");
  }
  if (laterCorrection >= 70) reasons.push("later line explicitly corrects/reverses the earlier view");

  return {
    id: `contradicts:${before.id}->${after.id}:${claims.before.topic}`,
    fromEventId: before.id,
    toEventId: after.id,
    type: "contradicts",
    strength,
    confidence,
    distance,
    topic: claims.before.topic,
    topicLabel: claims.before.topicLabel,
    fromStance: claims.before.stance,
    toStance: claims.after.stance,
    fromClaim: claims.before,
    toClaim: claims.after,
    reasons,
  };
}

function retractionRelation(
  before: Event,
  after: Event,
  topic: TopicRef,
  contradiction?: MomentRelation,
): MomentRelation {
  const correction = Math.max(
    getEventStrength(after, "correction"),
    getEventStrength(after, "reversal"),
  );
  return {
    id: `retracts:${before.id}->${after.id}:${topic.topic}`,
    fromEventId: before.id,
    toEventId: after.id,
    type: "retracts",
    strength: clamp(correction * 0.65 + (contradiction?.strength ?? 60) * 0.35),
    confidence: clamp(Math.min(after.confidence, contradiction?.confidence ?? topic.confidence)),
    distance: Math.max(0, after.messageIndex - before.messageIndex),
    topic: topic.topic,
    topicLabel: topic.label,
    reasons: ["later event explicitly retracts or reverses an earlier same-topic view"],
  };
}

/** Build same-topic, contradiction, and explicit-retraction edges. */
export function buildContradictionRelations(
  events: Event[],
  options: ContradictionOptions = {},
): MomentRelation[] {
  const maxMessageDistance = options.maxMessageDistance ?? 120;
  const recentEventWindow = options.recentEventWindow ?? 80;
  const sorted = [...events].sort(
    (a, b) => a.messageIndex - b.messageIndex || a.unitIndex - b.unitIndex,
  );
  const relations: MomentRelation[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const after = sorted[index];
    if (!after) continue;
    const start = Math.max(0, index - recentEventWindow);

    for (let previousIndex = index - 1; previousIndex >= start; previousIndex -= 1) {
      const before = sorted[previousIndex];
      if (!before) continue;
      const distance = after.messageIndex - before.messageIndex;
      if (distance < 0 || distance > maxMessageDistance) continue;

      const topicMatch = bestTopicMatch(before, after);
      if (!topicMatch) continue;
      relations.push(sameTopicRelation(before, after, topicMatch));

      const claims = bestContradictingClaims(before, after);
      let contradiction: MomentRelation | undefined;
      if (claims) {
        contradiction = contradictionRelation(before, after, claims, maxMessageDistance);
        relations.push(contradiction);
      }

      const laterCorrection = Math.max(
        getEventStrength(after, "correction"),
        getEventStrength(after, "reversal"),
      );
      if (laterCorrection >= 70 && (contradiction || topicMatch.similarity >= 0.9)) {
        relations.push(retractionRelation(before, after, topicMatch.after, contradiction));
      }
    }
  }

  return relations;
}
