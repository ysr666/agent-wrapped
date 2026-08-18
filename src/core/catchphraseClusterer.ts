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

interface PreparedInput extends CatchphraseInput {
  index: number;
  normalized: string;
  simplified: string;
  family?: string;
  grams: Set<string>;
  hasHan: boolean;
}

const FAMILY_RULES: Array<{ family: string; patterns: RegExp[] }> = [
  {
    family: "clarity",
    patterns: [
      /(?:问题|关键点|情况|原因).{0,12}(?:明确|清楚|清晰|明朗)/u,
      /(?:明确|清楚|清晰).{0,10}(?:问题|关键点|原因)/u,
      /\b(?:problem|issue|cause).{0,18}\b(?:clear|obvious|understood)\b/iu,
      /\b(?:clear|obvious).{0,18}\b(?:problem|issue|cause)\b/iu,
    ],
  },
  {
    family: "root-cause-found",
    patterns: [
      /(?:找到|找到了|定位到|确认了|确认|锁定).{0,12}(?:真正的?)?(?:根因|原因|问题|bug|缺陷)/iu,
      /(?:真正的?)?(?:根因|原因|问题).{0,14}(?:找到|确认|定位|锁定|就是|就在)/u,
      /\b(?:found|located|identified|confirmed|isolated).{0,20}\b(?:root cause|issue|problem|bug|defect)\b/iu,
      /\b(?:root cause|exact issue|real issue).{0,20}\b(?:found|confirmed|identified|is)\b/iu,
    ],
  },
  {
    family: "progress-near-cause",
    patterns: [
      /(?:重大|关键)?进展/u,
      /(?:接近|很接近|非常接近|快接近).{0,10}(?:根因|答案|问题)/u,
      /(?:范围|问题范围).{0,12}(?:缩小|收窄)/u,
      /\b(?:progress|getting closer|narrowed it down|close to the root cause)\b/iu,
    ],
  },
  {
    family: "resolution-confidence",
    patterns: [
      /(?:应该|这次|现在|目前).{0,12}(?:修好|修复|解决|没问题|可以结束|搞定)/u,
      /(?:问题|bug|缺陷).{0,10}(?:解决|修好|修复|搞定)/u,
      /\b(?:should be fixed|should be solved|looks fixed|problem is solved|issue is fixed)\b/iu,
    ],
  },
  {
    family: "wait-reset",
    patterns: [
      /^(?:等等|等一下|先等等|先等一下)(?:[，,:：—\s-]|$)/u,
      /^(?:wait|hold on)(?:[,!:—\s-]|$)/iu,
    ],
  },
  {
    family: "celebration",
    patterns: [
      /^(?:漂亮|完美|太好了|太棒了|很好)(?:[！!，,。.]|$)/u,
      /^(?:perfect|great news|nice|nailed it)(?:[!,.\s]|$)/iu,
    ],
  },
];

function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[`*_~“”"']/gu, "")
    .replace(/[。！？!?…，,；;：:\s]+/gu, " ")
    .trim();
}

function simplify(text: string): string {
  const normalized = normalize(text);
  if (/\p{Script=Han}/u.test(normalized)) {
    return normalized
      .replace(/(?:好的?|那么|所以|然后|现在|已经|目前|基本|非常|真的|这下|这个|这里|一下|先|终于|比较|可以)/gu, "")
      .replace(/\s+/gu, "")
      .trim();
  }

  return normalized
    .replace(/\b(?:okay|ok|so|now|already|really|very|finally|basically|actually|just|the|a|an)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function polarity(text: string): "negative" | "positive" {
  return /(?:不明确|不清楚|没解决|没有解决|没修好|没有修好|不是根因|并非根因|\bnot\b|\bnever\b|\bno longer\b|\bun(?:clear|fixed)\b)/iu.test(text)
    ? "negative"
    : "positive";
}

function detectFamily(text: string): string | undefined {
  for (const rule of FAMILY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return `${rule.family}:${polarity(text)}`;
    }
  }
  return undefined;
}

function ngrams(text: string, hasHan: boolean): Set<string> {
  if (!text) return new Set();

  if (hasHan) {
    const chars = [...text.replace(/\s+/gu, "")];
    if (chars.length <= 2) return new Set([chars.join("")]);
    const grams = new Set<string>();
    for (let i = 0; i < chars.length - 1; i += 1) {
      grams.add(chars.slice(i, i + 2).join(""));
    }
    return grams;
  }

  const tokens = text.split(/\s+/u).filter(Boolean);
  if (tokens.length <= 1) return new Set(tokens);
  const grams = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i += 1) {
    grams.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  for (const token of tokens) grams.add(token);
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) {
    if (b.has(value)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function fuzzySimilarity(a: PreparedInput, b: PreparedInput): number {
  if (a.hasHan !== b.hasHan) return 0;
  const maxLength = Math.max(a.simplified.length, b.simplified.length);
  const minLength = Math.min(a.simplified.length, b.simplified.length);
  if (maxLength === 0 || minLength / maxLength < 0.58) return 0;

  const similarity = jaccard(a.grams, b.grams);
  const threshold = a.hasHan ? 0.56 : 0.68;
  return similarity >= threshold ? similarity : 0;
}

class UnionFind {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, index) => index);
  }

  find(value: number): number {
    const parent = this.parent[value];
    if (parent === undefined) return value;
    if (parent === value) return value;
    this.parent[value] = this.find(parent);
    return this.parent[value] ?? value;
  }

  union(a: number, b: number): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent[rootB] = rootA;
  }
}

function chooseCanonical(members: PreparedInput[]): string {
  const variants = new Map<string, { count: number; firstIndex: number; text: string }>();
  for (const member of members) {
    const normalized = normalize(member.text);
    const existing = variants.get(normalized);
    if (existing) {
      existing.count += 1;
      existing.firstIndex = Math.min(existing.firstIndex, member.messageIndex);
    } else {
      variants.set(normalized, { count: 1, firstIndex: member.messageIndex, text: member.text.trim() });
    }
  }

  return [...variants.values()].sort(
    (a, b) => b.count - a.count || a.text.length - b.text.length || a.firstIndex - b.firstIndex,
  )[0]?.text ?? members[0]?.text ?? "";
}

function clusterConfidence(members: PreparedInput[]): number {
  if (members.length <= 1) return 100;
  const families = new Set(members.map((member) => member.family).filter(Boolean));
  if (families.size === 1 && [...families][0]) return 96;

  const normalized = new Set(members.map((member) => member.normalized));
  if (normalized.size === 1) return 100;

  let total = 0;
  let pairs = 0;
  for (let i = 0; i < members.length; i += 1) {
    for (let j = i + 1; j < members.length; j += 1) {
      total += jaccard(members[i]?.grams ?? new Set(), members[j]?.grams ?? new Set());
      pairs += 1;
    }
  }
  return Math.max(60, Math.min(95, Math.round((pairs > 0 ? total / pairs : 0) * 100)));
}

/**
 * Cluster exact and near-duplicate verbal tics without embeddings or another LLM.
 *
 * The v0 strategy is intentionally conservative:
 * 1. exact normalized matches always merge;
 * 2. a small multilingual set of catchphrase families merges common paraphrases;
 * 3. everything else may merge only through high-overlap local fuzzy matching.
 *
 * This is meant for repeated wording/style, not semantic contradiction detection.
 */
export function clusterCatchphraseCandidates(
  inputs: CatchphraseInput[],
  options: CatchphraseClusterOptions = {},
): CatchphraseCluster[] {
  const minCount = options.minCount ?? 1;
  const fuzzy = options.fuzzy ?? true;

  const prepared: PreparedInput[] = inputs
    .map((input, index) => {
      const normalized = normalize(input.text);
      const simplified = simplify(input.text);
      const hasHan = /\p{Script=Han}/u.test(simplified);
      return {
        ...input,
        index,
        normalized,
        simplified,
        family: detectFamily(input.text),
        grams: ngrams(simplified, hasHan),
        hasHan,
      };
    })
    .filter((input) => input.normalized.length >= 2);

  const unionFind = new UnionFind(prepared.length);
  const exact = new Map<string, number>();
  const family = new Map<string, number>();

  for (const item of prepared) {
    const exactMatch = exact.get(item.normalized);
    if (exactMatch !== undefined) unionFind.union(item.index, exactMatch);
    else exact.set(item.normalized, item.index);

    if (item.family) {
      const familyMatch = family.get(item.family);
      if (familyMatch !== undefined) unionFind.union(item.index, familyMatch);
      else family.set(item.family, item.index);
    }
  }

  if (fuzzy) {
    for (let i = 0; i < prepared.length; i += 1) {
      const a = prepared[i];
      if (!a || a.family) continue;
      for (let j = i + 1; j < prepared.length; j += 1) {
        const b = prepared[j];
        if (!b || b.family) continue;
        if (fuzzySimilarity(a, b) > 0) unionFind.union(a.index, b.index);
      }
    }
  }

  const groups = new Map<number, PreparedInput[]>();
  for (const item of prepared) {
    const root = unionFind.find(item.index);
    const group = groups.get(root) ?? [];
    group.push(item);
    groups.set(root, group);
  }

  return [...groups.values()]
    .filter((members) => members.length >= minCount)
    .map((members) => {
      const canonicalText = chooseCanonical(members);
      const familyName = members.find((member) => member.family)?.family;
      const variantStats = new Map<string, { text: string; count: number; first: number }>();
      for (const member of members) {
        const key = normalize(member.text);
        const existing = variantStats.get(key);
        if (existing) existing.count += 1;
        else variantStats.set(key, { text: member.text.trim(), count: 1, first: member.messageIndex });
      }

      const variants = [...variantStats.values()]
        .sort((a, b) => b.count - a.count || a.first - b.first)
        .map((variant) => variant.text);
      const messageIndexes = [...new Set(members.map((member) => member.messageIndex))].sort((a, b) => a - b);
      const key = familyName ?? `fuzzy:${normalize(canonicalText)}`;

      return {
        key,
        canonicalText,
        count: members.length,
        variants,
        messageIndexes,
        confidence: clusterConfidence(members),
        family: familyName,
        members: members.map(({ text, messageIndex }) => ({ text, messageIndex })),
      };
    })
    .sort((a, b) => b.count - a.count || b.confidence - a.confidence || a.messageIndexes[0]! - b.messageIndexes[0]!);
}
