import { extractEvents } from "../events/eventExtractor.js";
import type { EventClaim } from "../events/types.js";
import { buildMomentGraph, eventMap, relationsOfType } from "../graph/momentGraph.js";
import type { TranscriptMessage } from "./types.js";

export type BoomerangStance = "exclude" | "blame";

export interface BoomerangClaim {
  text: string;
  messageIndex: number;
  topic: string;
  topicLabel: string;
  stance: BoomerangStance;
  strength: number;
  confidence: number;
  cue: string;
}

export interface BoomerangMatch {
  kind: "boomerang";
  topic: string;
  topicLabel: string;
  beforeText: string;
  afterText: string;
  beforeMessageIndex: number;
  afterMessageIndex: number;
  distance: number;
  score: number;
  reasons: string[];
  beforeClaim: BoomerangClaim;
  afterClaim: BoomerangClaim;
}

export interface BoomerangDetectorOptions {
  /** Maximum transcript-message distance between opposite claims. Defaults to 120. */
  maxMessageDistance?: number;
  /** Minimum 0-100 score for a returned pair. Defaults to 45. */
  minScore?: number;
  /** Maximum matches returned. Defaults to 10. */
  limit?: number;
}

function legacyClaim(
  text: string,
  messageIndex: number,
  claim: EventClaim,
): BoomerangClaim | undefined {
  if (claim.stance !== "exclude" && claim.stance !== "blame") return undefined;
  return {
    text,
    messageIndex,
    topic: claim.topic,
    topicLabel: claim.topicLabel,
    stance: claim.stance,
    strength: claim.strength,
    confidence: claim.confidence,
    cue: claim.cue,
  };
}

/**
 * Compatibility API backed by the unified EventExtractor.
 * Topic aliases, stance extraction, and claim confidence now have one source of
 * truth instead of being reimplemented inside BoomerangDetector.
 */
export function extractBoomerangClaims(messages: TranscriptMessage[]): BoomerangClaim[] {
  return extractEvents(messages, { includeNeutral: true }).flatMap((event) =>
    event.claims
      .map((claim) => legacyClaim(event.text, event.messageIndex, claim))
      .filter((claim): claim is BoomerangClaim => Boolean(claim)),
  );
}

/**
 * Compatibility API backed by `MomentGraph.contradicts` relations.
 *
 * v0 remains conservative: it detects explicit opposite stances on a shared
 * canonical topic. More implicit NLI-style contradictions belong to the later
 * optional semantic layer.
 */
export function detectBoomerangs(
  messages: TranscriptMessage[],
  options: BoomerangDetectorOptions = {},
): BoomerangMatch[] {
  const maxMessageDistance = options.maxMessageDistance ?? 120;
  const minScore = options.minScore ?? 45;
  const limit = options.limit ?? 10;
  const graph = buildMomentGraph(messages, { maxMessageDistance });
  const events = eventMap(graph);

  return relationsOfType(graph, "contradicts")
    .filter((relation) => relation.strength >= minScore)
    .map((relation): BoomerangMatch | undefined => {
      const before = events.get(relation.fromEventId);
      const after = events.get(relation.toEventId);
      const beforeClaim = relation.fromClaim;
      const afterClaim = relation.toClaim;
      if (!before || !after || !beforeClaim || !afterClaim || !relation.topic || !relation.topicLabel) {
        return undefined;
      }
      const legacyBefore = legacyClaim(before.text, before.messageIndex, beforeClaim);
      const legacyAfter = legacyClaim(after.text, after.messageIndex, afterClaim);
      if (!legacyBefore || !legacyAfter) return undefined;

      return {
        kind: "boomerang",
        topic: relation.topic,
        topicLabel: relation.topicLabel,
        beforeText: before.text,
        afterText: after.text,
        beforeMessageIndex: before.messageIndex,
        afterMessageIndex: after.messageIndex,
        distance: relation.distance,
        score: relation.strength,
        reasons: relation.reasons,
        beforeClaim: legacyBefore,
        afterClaim: legacyAfter,
      };
    })
    .filter((match): match is BoomerangMatch => Boolean(match))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.distance - b.distance ||
        a.beforeMessageIndex - b.beforeMessageIndex,
    )
    .slice(0, limit);
}
