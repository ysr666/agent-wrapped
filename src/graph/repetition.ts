import type { Event } from "../events/types.js";
import type { MomentRelation } from "./types.js";

export interface RepetitionOptions {
  fuzzy?: boolean;
  /** Max recent events inspected for conservative fuzzy matching. Defaults to 64. */
  fuzzyWindowEvents?: number;
}

export interface RepetitionCluster {
  key: string;
  canonicalText: string;
  count: number;
  variants: string[];
  messageIndexes: number[];
  confidence: number;
  family?: string;
  eventIds: string[];
  members: Event[];
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function ngrams(text: string, hasHan: boolean): Set<string> {
  if (!text) return new Set();
  if (hasHan) {
    const chars = [...text.replace(/\s+/gu, "")];
    if (chars.length <= 2) return new Set([chars.join("")]);
    const grams = new Set<string>();
    for (let index = 0; index < chars.length - 1; index += 1) {
      grams.add(chars.slice(index, index + 2).join(""));
    }
    return grams;
  }

  const tokens = text.split(/\s+/u).filter(Boolean);
  if (tokens.length <= 1) return new Set(tokens);
  const grams = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index += 1) {
    grams.add(`${tokens[index]} ${tokens[index + 1]}`);
  }
  for (const token of tokens) grams.add(token);
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function fuzzySimilarity(a: Event, b: Event): number {
  const aHan = /\p{Script=Han}/u.test(a.simplifiedText);
  const bHan = /\p{Script=Han}/u.test(b.simplifiedText);
  if (aHan !== bHan) return 0;

  const maxLength = Math.max(a.simplifiedText.length, b.simplifiedText.length);
  const minLength = Math.min(a.simplifiedText.length, b.simplifiedText.length);
  if (maxLength === 0 || minLength / maxLength < 0.58) return 0;

  const similarity = jaccard(
    ngrams(a.simplifiedText, aHan),
    ngrams(b.simplifiedText, bHan),
  );
  const threshold = aHan ? 0.56 : 0.68;
  return similarity >= threshold ? similarity : 0;
}

function relation(
  type: "repeats" | "similar_to",
  from: Event,
  to: Event,
  strength: number,
  confidence: number,
  reason: string,
): MomentRelation {
  return {
    id: `${type}:${from.id}->${to.id}`,
    fromEventId: from.id,
    toEventId: to.id,
    type,
    strength: clamp(strength),
    confidence: clamp(confidence),
    distance: Math.max(0, to.messageIndex - from.messageIndex),
    reasons: [reason],
  };
}

/**
 * Build repetition/similarity edges. Exact and known-family matches are indexed;
 * fuzzy matching only looks through a bounded recent window, keeping long-session
 * behavior close to O(n) instead of comparing every sentence with every other.
 */
export function buildRepetitionRelations(
  events: Event[],
  options: RepetitionOptions = {},
): MomentRelation[] {
  const fuzzy = options.fuzzy ?? true;
  const fuzzyWindowEvents = options.fuzzyWindowEvents ?? 64;
  const sorted = [...events].sort(
    (a, b) => a.messageIndex - b.messageIndex || a.unitIndex - b.unitIndex,
  );
  const relations: MomentRelation[] = [];
  const exactPrevious = new Map<string, Event>();
  const familyPrevious = new Map<string, Event>();
  const linkedPairs = new Set<string>();

  const add = (edge: MomentRelation): void => {
    const pair = `${edge.fromEventId}\u0000${edge.toEventId}`;
    if (linkedPairs.has(pair)) return;
    linkedPairs.add(pair);
    relations.push(edge);
  };

  sorted.forEach((event, index) => {
    const exact = exactPrevious.get(event.normalizedText);
    if (exact && exact.id !== event.id) {
      add(relation("repeats", exact, event, 100, 100, "exact normalized repetition"));
    }
    exactPrevious.set(event.normalizedText, event);

    if (!exact && event.verbalFamily) {
      const previousFamily = familyPrevious.get(event.verbalFamily);
      if (previousFamily && previousFamily.id !== event.id) {
        add(
          relation(
            "similar_to",
            previousFamily,
            event,
            94,
            96,
            `same verbal-tic family: ${event.verbalFamily}`,
          ),
        );
      }
      familyPrevious.set(event.verbalFamily, event);
    } else if (event.verbalFamily) {
      familyPrevious.set(event.verbalFamily, event);
    }

    if (!fuzzy || exact || event.verbalFamily) return;

    const start = Math.max(0, index - fuzzyWindowEvents);
    for (let previousIndex = index - 1; previousIndex >= start; previousIndex -= 1) {
      const previous = sorted[previousIndex];
      if (!previous || previous.verbalFamily) continue;
      if (previous.normalizedText === event.normalizedText) continue;
      const similarity = fuzzySimilarity(previous, event);
      if (similarity <= 0) continue;
      add(
        relation(
          "similar_to",
          previous,
          event,
          similarity * 100,
          68 + similarity * 25,
          "high local n-gram overlap",
        ),
      );
      // One conservative fuzzy parent is enough to connect this event into a cluster.
      break;
    }
  });

  return relations;
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent) {
      this.parent.set(id, id);
      return id;
    }
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootB, rootA);
  }
}

function chooseCanonical(members: Event[]): string {
  const variants = new Map<string, { text: string; count: number; first: number }>();
  for (const member of members) {
    const existing = variants.get(member.normalizedText);
    if (existing) {
      existing.count += 1;
      existing.first = Math.min(existing.first, member.messageIndex);
    } else {
      variants.set(member.normalizedText, {
        text: member.text.trim(),
        count: 1,
        first: member.messageIndex,
      });
    }
  }
  return [...variants.values()].sort(
    (a, b) => b.count - a.count || a.text.length - b.text.length || a.first - b.first,
  )[0]?.text ?? members[0]?.text ?? "";
}

export function clusterRepetitionEvents(
  events: Event[],
  relations: MomentRelation[],
  minCount = 1,
): RepetitionCluster[] {
  const byId = new Map(events.map((event) => [event.id, event]));
  const unionFind = new UnionFind();
  for (const event of events) unionFind.add(event.id);

  const repetitionRelations = relations.filter(
    (edge) => edge.type === "repeats" || edge.type === "similar_to",
  );
  for (const edge of repetitionRelations) {
    if (byId.has(edge.fromEventId) && byId.has(edge.toEventId)) {
      unionFind.union(edge.fromEventId, edge.toEventId);
    }
  }

  const groups = new Map<string, Event[]>();
  for (const event of events) {
    const root = unionFind.find(event.id);
    const group = groups.get(root) ?? [];
    group.push(event);
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter((members) => members.length >= minCount)
    .map((members) => {
      const memberIds = new Set(members.map((member) => member.id));
      const edges = repetitionRelations.filter(
        (edge) => memberIds.has(edge.fromEventId) && memberIds.has(edge.toEventId),
      );
      const normalized = new Set(members.map((member) => member.normalizedText));
      const familySet = new Set(members.map((member) => member.verbalFamily).filter(Boolean));
      const family = familySet.size === 1 ? [...familySet][0] : undefined;
      const confidence =
        normalized.size === 1
          ? 100
          : family
            ? 96
            : edges.length > 0
              ? clamp(edges.reduce((sum, edge) => sum + edge.confidence, 0) / edges.length)
              : 60;

      const variantMap = new Map<string, { text: string; count: number; first: number }>();
      for (const member of members) {
        const existing = variantMap.get(member.normalizedText);
        if (existing) existing.count += 1;
        else {
          variantMap.set(member.normalizedText, {
            text: member.text.trim(),
            count: 1,
            first: member.messageIndex,
          });
        }
      }

      const variants = [...variantMap.values()]
        .sort((a, b) => b.count - a.count || a.first - b.first)
        .map((variant) => variant.text);
      const canonicalText = chooseCanonical(members);

      return {
        key: family ?? `fuzzy:${members[0]?.normalizedText ?? ""}`,
        canonicalText,
        count: members.length,
        variants,
        messageIndexes: [...new Set(members.map((member) => member.messageIndex))].sort((a, b) => a - b),
        confidence,
        family,
        eventIds: members.map((member) => member.id),
        members: [...members].sort(
          (a, b) => a.messageIndex - b.messageIndex || a.unitIndex - b.unitIndex,
        ),
      };
    })
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.confidence - a.confidence ||
        (a.messageIndexes[0] ?? 0) - (b.messageIndexes[0] ?? 0),
    );
}
