import type { RankedMoment } from "../moments/types.js";
import type {
  Award,
  AwardComposerOptions,
  AwardComposition,
  AwardKind,
  AwardLocale,
  RejectedAwardCandidate,
} from "./types.js";

interface AwardLabel {
  emoji: string;
  zh: string;
  en: string;
}

interface AwardCandidate {
  moment: RankedMoment;
  kind: AwardKind;
}

const LABELS: Record<AwardKind, AwardLabel> = {
  quote: { emoji: "🏆", zh: "本场金句", en: "Quote of the session" },
  catchphrase: { emoji: "📢", zh: "高频口癖", en: "Catchphrase" },
  boomerang: { emoji: "🤡", zh: "最大回旋镖", en: "Biggest boomerang" },
  "wolf-cry": { emoji: "🐺", zh: "狼来了奖", en: "Called it too early" },
  "premature-celebration": { emoji: "🍾", zh: "香槟开早了", en: "Premature celebration" },
  "plot-twist": { emoji: "🧠", zh: "剧情急转弯", en: "Plot twist" },
  "emotional-peak": { emoji: "💀", zh: "精神状态", en: "Emotional peak" },
};

function clampCount(value: number | undefined, fallback: number, max: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(resolved)));
}

function hasEvidence(moment: RankedMoment, prefix: string): boolean {
  return moment.evidence.some((entry) => entry.startsWith(prefix));
}

function awardKindFor(moment: RankedMoment): AwardKind {
  switch (moment.type) {
    case "repeated_pattern":
      return moment.family?.startsWith("root-cause-found:") ? "wolf-cry" : "catchphrase";
    case "boomerang":
      return "boomerang";
    case "false_dawn":
      return "premature-celebration";
    case "plot_twist":
    case "correction_arc":
      return "plot-twist";
    case "one_liner": {
      const emotional = hasEvidence(moment, "confusion:") || hasEvidence(moment, "celebration:");
      const substantive =
        hasEvidence(moment, "discovery_claim:") ||
        hasEvidence(moment, "reversal:") ||
        hasEvidence(moment, "correction:");
      return emotional && !substantive ? "emotional-peak" : "quote";
    }
  }
}

function titleFor(kind: AwardKind, locale: AwardLocale, moment: RankedMoment): string {
  if (kind === "plot-twist" && moment.type === "correction_arc") {
    return locale === "en" ? "Three-act plot twist" : "三段式反转";
  }
  return locale === "en" ? LABELS[kind].en : LABELS[kind].zh;
}

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function setOverlap(a: string[], b: string[]): { intersection: number; containment: number } {
  if (a.length === 0 || b.length === 0) return { intersection: 0, containment: 0 };
  const aSet = new Set(a);
  const bSet = new Set(b);
  let intersection = 0;
  for (const value of aSet) {
    if (bSet.has(value)) intersection += 1;
  }
  const smaller = Math.min(aSet.size, bSet.size);
  return {
    intersection,
    containment: smaller === 0 ? 0 : intersection / smaller,
  };
}

function displaySignature(moment: RankedMoment): string {
  return [moment.primaryText, ...moment.relatedTexts]
    .map(normalizeText)
    .filter(Boolean)
    .join("→");
}

function overlapsSelectedStory(
  candidate: RankedMoment,
  candidateKind: AwardKind,
  selected: Array<{ moment: RankedMoment; kind: AwardKind }>,
  maxContainmentOverlap: number,
): boolean {
  const signature = displaySignature(candidate);

  for (const item of selected) {
    if (signature.length > 0 && signature === displaySignature(item.moment)) return true;

    const overlap = setOverlap(candidate.eventIds, item.moment.eventIds);
    if (overlap.intersection === 0) continue;

    // Identical event sets are the same underlying story even when P2 emitted
    // several structural views of it.
    if (
      overlap.containment === 1 &&
      new Set(candidate.eventIds).size === new Set(item.moment.eventIds).size
    ) {
      return true;
    }

    // Within the same user-visible award family, strongly overlapping graph
    // structures should collapse. Across different award families, sharing a
    // line is allowed when the extra context genuinely changes the joke.
    if (candidateKind === item.kind && overlap.containment > maxContainmentOverlap) {
      return true;
    }
  }

  return false;
}

function toAward(moment: RankedMoment, kind: AwardKind, locale: AwardLocale): Award {
  const label = LABELS[kind];
  return {
    id: `award:${kind}:${moment.id}`,
    kind,
    title: titleFor(kind, locale, moment),
    emoji: label.emoji,
    momentId: moment.id,
    sourceType: moment.type,
    messageIndexes: [...moment.messageIndexes],
    primaryText: moment.primaryText,
    relatedTexts: [...moment.relatedTexts],
    family: moment.family,
    count: moment.count,
    variants: moment.variants ? [...moment.variants] : undefined,
    topic: moment.topic,
    topicLabel: moment.topicLabel,
    funScore: moment.scores.funScore,
    confidence: moment.scores.confidence,
    scores: { ...moment.scores },
    evidence: [...moment.evidence],
  };
}

/**
 * P3.5: turn ranked Moments into a small, diverse set of user-facing awards.
 *
 * The first pass protects the three MVP questions when strong candidates exist:
 * the best quote, the strongest repeated verbal pattern, and the biggest
 * boomerang. The second pass fills the remaining slots with the best diverse
 * side moments. P3.5 never reparses or rewrites transcript text.
 */
export function composeAwards(
  rankedMoments: RankedMoment[],
  options: AwardComposerOptions = {},
): AwardComposition {
  const locale = options.locale ?? "zh-CN";
  const maxAwards = Math.max(0, Math.min(7, clampCount(options.maxAwards, 5, 7)));
  const minFunScore = options.minFunScore ?? 42;
  const minConfidence = options.minConfidence ?? 0;
  const maxPerKind = Math.max(1, clampCount(options.maxPerKind, 1, 7));
  const maxContainmentOverlap = Math.max(
    0,
    Math.min(1, options.maxContainmentOverlap ?? 0.74),
  );

  const ordered = [...rankedMoments].sort(
    (a, b) =>
      b.scores.funScore - a.scores.funScore ||
      b.scores.confidence - a.scores.confidence ||
      (a.messageIndexes[0] ?? 0) - (b.messageIndexes[0] ?? 0),
  );

  const rejected: RejectedAwardCandidate[] = [];
  const eligible: AwardCandidate[] = [];
  for (const moment of ordered) {
    if (moment.scores.funScore < minFunScore) {
      rejected.push({ momentId: moment.id, reason: "below-fun-threshold" });
      continue;
    }
    if (moment.scores.confidence < minConfidence) {
      rejected.push({ momentId: moment.id, reason: "below-confidence-threshold" });
      continue;
    }
    eligible.push({ moment, kind: awardKindFor(moment) });
  }

  const awards: Award[] = [];
  const selected: Array<{ moment: RankedMoment; kind: AwardKind }> = [];
  const kindCounts = new Map<AwardKind, number>();
  const finalized = new Set<string>();

  function reject(candidate: AwardCandidate, reason: RejectedAwardCandidate["reason"]): void {
    if (finalized.has(candidate.moment.id)) return;
    finalized.add(candidate.moment.id);
    rejected.push({ momentId: candidate.moment.id, reason });
  }

  function trySelect(candidate: AwardCandidate): boolean {
    if (finalized.has(candidate.moment.id)) return false;
    if (awards.length >= maxAwards) {
      reject(candidate, "award-limit");
      return false;
    }
    if ((kindCounts.get(candidate.kind) ?? 0) >= maxPerKind) {
      reject(candidate, "duplicate-award-kind");
      return false;
    }
    if (
      overlapsSelectedStory(
        candidate.moment,
        candidate.kind,
        selected,
        maxContainmentOverlap,
      )
    ) {
      reject(candidate, "overlaps-selected-moment");
      return false;
    }

    finalized.add(candidate.moment.id);
    awards.push(toAward(candidate.moment, candidate.kind, locale));
    selected.push({ moment: candidate.moment, kind: candidate.kind });
    kindCounts.set(candidate.kind, (kindCounts.get(candidate.kind) ?? 0) + 1);
    return true;
  }

  const coreGroups: Array<(candidate: AwardCandidate) => boolean> = [
    (candidate) => candidate.kind === "quote",
    (candidate) => candidate.kind === "catchphrase" || candidate.kind === "wolf-cry",
    (candidate) => candidate.kind === "boomerang",
  ];

  for (const matchesCoreGroup of coreGroups) {
    if (awards.length >= maxAwards) break;
    for (const candidate of eligible) {
      if (finalized.has(candidate.moment.id) || !matchesCoreGroup(candidate)) continue;
      if (trySelect(candidate)) break;
    }
  }

  for (const candidate of eligible) {
    if (finalized.has(candidate.moment.id)) continue;
    trySelect(candidate);
  }

  return {
    awards,
    consideredMoments: rankedMoments.length,
    rejected,
  };
}
