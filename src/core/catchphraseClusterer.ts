import { extractEventFromText } from "../events/eventExtractor.js";
import {
  buildRepetitionRelations,
  clusterRepetitionEvents,
} from "../graph/repetition.js";

export interface CatchphraseInput {
  text: string;
  messageIndex: number;
}

export interface CatchphraseCluster {
  /** Stable-enough local key for this analysis run; not intended for persistence. */
  key: string;
  canonicalText: string;
  count: number;
  variants: string[];
  messageIndexes: number[];
  /** 0-100 confidence that the members belong to the same verbal tic family. */
  confidence: number;
  family?: string;
  members: CatchphraseInput[];
}

export interface CatchphraseClusterOptions {
  /** Minimum members required for a cluster to be returned. Defaults to 1. */
  minCount?: number;
  /** Enable conservative fuzzy matching for phrases without a known template family. */
  fuzzy?: boolean;
}

/**
 * Compatibility wrapper around the P1 repetition graph.
 *
 * Catchphrase family detection and fuzzy similarity no longer live in this
 * awards-era module. They are shared graph relations, so SessionAnalyzer,
 * future MomentBuilder code, and this public helper all see the same grouping.
 */
export function clusterCatchphraseCandidates(
  inputs: CatchphraseInput[],
  options: CatchphraseClusterOptions = {},
): CatchphraseCluster[] {
  const minCount = options.minCount ?? 1;
  const fuzzy = options.fuzzy ?? true;
  const events = inputs.map((input, index) =>
    extractEventFromText(input.text, input.messageIndex, index),
  );
  const relations = buildRepetitionRelations(events, { fuzzy });

  return clusterRepetitionEvents(events, relations, minCount).map((cluster) => ({
    key: cluster.key,
    canonicalText: cluster.canonicalText,
    count: cluster.count,
    variants: cluster.variants,
    messageIndexes: cluster.messageIndexes,
    confidence: cluster.confidence,
    family: cluster.family,
    members: cluster.members.map((member) => ({
      text: member.text,
      messageIndex: member.messageIndex,
    })),
  }));
}
