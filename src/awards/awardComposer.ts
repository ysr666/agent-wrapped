import type { RankedMoment } from "../moments/types.js";
import type {
  Award,
  AwardComposerOptions,
  AwardComposition,
  AwardKind,
  AwardLocale,
  AwardRejectionReason,
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

function isRepeatedPattern(moment: RankedMoment): boolean {
  return moment.type === "repeated_pattern";
}

function isShareableRepeatedPattern(moment: RankedMoment): boolean {
  if (!isRepeatedPattern(moment)) return true;
  // Named verbal families are already constrained by the local event layer
  // (for example wait-reset or root-cause-found). For an unclassified exact or
  // fuzzy repeat, require a compact human-readable phrase before promoting it
  // to a user-facing catchphrase. This prevents Markdown separators, filenames,
  // repeated checklist prose, and sentence-split code fragments from becoming
  // "人格" by accident.
  if (moment.family) return true;
  if ((moment.count ?? 0) < 3) return false;

  const text = moment.primaryText.trim();
  if (text.length < 4 || text.length > 32) return false;
  if (/[`|]/u.test(text)) return false;
  if (/(?:^|[\s/])[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+(?:$|[\s,，。])/u.test(text)) return false;
  const humanCharacters = (text.match(/[\p{L}\p{Script=Han}]/gu) ?? []).length;
  const visibleCharacters = (text.match(/[^\s]/gu) ?? []).length;
  return humanCharacters >= 4 && humanCharacters / Math.max(1, visibleCharacters) >= 0.45;
}

function overlapReason(
  candidate: RankedMoment,
  candidateKind: AwardKind,
  selected: Array<{ moment: RankedMoment; kind: AwardKind }>,
  maxContainmentOverlap: number,
): AwardRejectionReason | undefined {
  const signature = displaySignature(candidate);

  for (const item of selected) {
    if (signature.length > 0 && signature === displaySignature(item.moment)) {
      return "overlaps-selected-moment";
    }

    const overlap = setOverlap(candidate.eventIds, item.moment.eventIds);
    if (overlap.intersection > 0) {
      // Identical event sets are the same underlying story even when P2 emitted
      // several structural views of it.
      if (
        overlap.containment === 1 &&
        new Set(candidate.eventIds).size === new Set(item.moment.eventIds).size
      ) {
        return "overlaps-selected-moment";
      }

      // Within the same user-visible award family, strongly overlapping graph
      // structures should collapse. Across different award families, sharing a
      // line can be valuable only when both cards have genuinely different
      // visible evidence.
      if (candidateKind === item.kind && overlap.containment > maxContainmentOverlap) {
        return "overlaps-selected-moment";
      }
    }

    // Event IDs can differ across P2 views of the same displayed messages.
    // A stronger plot card should therefore suppress a weaker constituent quote
    // or emotional line, instead of making the Wrapped repeat one episode in
    // several card costumes. Repetition remains an exception: its value is the
    // cross-session count and examples, so one shared instance is not enough to
    // make it redundant.
    const visibleOverlap = setOverlap(candidate.messageIndexes.map(String), item.moment.messageIndexes.map(String));
    if (
      !isRepeatedPattern(candidate) &&
      !isRepeatedPattern(item.moment) &&
      visibleOverlap.containment === 1
    ) {
      return "overlaps-selected-visible-evidence";
    }
  }

  return undefined;
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
 * Moment cards compete by entertainment score, subject to factual confidence,
 * card-kind diversity, and visible-evidence deduplication. A high-payoff plot
 * therefore beats weaker constituent quotes instead of turning one episode
 * into several near-identical cards. P3.5 never reparses or rewrites transcript
 * text.
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
    if (!isShareableRepeatedPattern(moment)) {
      rejected.push({ momentId: moment.id, reason: "not-shareable-repetition" });
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
    const overlap = overlapReason(
      candidate.moment,
      candidate.kind,
      selected,
      maxContainmentOverlap,
    );
    if (overlap) {
      reject(candidate, overlap);
      return false;
    }

    finalized.add(candidate.moment.id);
    awards.push(toAward(candidate.moment, candidate.kind, locale));
    selected.push({ moment: candidate.moment, kind: candidate.kind });
    kindCounts.set(candidate.kind, (kindCounts.get(candidate.kind) ?? 0) + 1);
    return true;
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
