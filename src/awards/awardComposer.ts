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

function isStructuralStoryMoment(moment: RankedMoment): boolean {
  return ["boomerang", "false_dawn", "plot_twist", "correction_arc"].includes(moment.type);
}

const STRUCTURAL_ANCHOR_STOPWORDS = new Set([
  "and", "are", "bug", "cause", "error", "fix", "fixed", "for", "from", "issue", "main", "problem", "root", "test", "tests", "that", "the", "this", "was", "with",
]);

function structuralAnchorTokens(moment: RankedMoment): Set<string> {
  const tokens = new Set<string>();
  for (const text of [moment.primaryText, ...moment.relatedTexts]) {
    for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9_-]{2,}/gu)) {
      const token = match[0]?.toLocaleLowerCase();
      if (token && !STRUCTURAL_ANCHOR_STOPWORDS.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

function messageSpanDistance(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) return Number.POSITIVE_INFINITY;
  const leftStart = Math.min(...left);
  const leftEnd = Math.max(...left);
  const rightStart = Math.min(...right);
  const rightEnd = Math.max(...right);
  if (leftStart <= rightEnd && rightStart <= leftEnd) return 0;
  return Math.min(Math.abs(rightStart - leftEnd), Math.abs(leftStart - rightEnd));
}

function sharesStructuralAnchor(left: RankedMoment, right: RankedMoment): boolean {
  if (messageSpanDistance(left.messageIndexes, right.messageIndexes) > 18) return false;
  const leftTokens = structuralAnchorTokens(left);
  const rightTokens = structuralAnchorTokens(right);
  for (const token of leftTokens) if (rightTokens.has(token)) return true;
  return false;
}

function isShareableRepeatedPattern(moment: RankedMoment): boolean {
  if (!isRepeatedPattern(moment)) return true;
  // For an unclassified exact or fuzzy repeat, require a compact
  // human-readable phrase before promoting it to a user-facing catchphrase.
  // This prevents Markdown separators, filenames, repeated checklist prose,
  // sentence-split code fragments, and routine completion notices from
  // becoming "人格" by accident.
  if (moment.family) {
    const family = moment.family.split(":", 1)[0];
    const variants = moment.variants?.length
      ? moment.variants
      : [moment.primaryText, ...moment.relatedTexts];

    // Repeated progress reports are workflow narration, not a personality.
    // The meaningful comic versions need an actual reset or an overconfident
    // root-cause declaration, not merely several uses of the same analytical
    // vocabulary.
    if (["clarity", "progress-near-cause", "resolution-confidence", "celebration"].includes(family)) {
      return false;
    }
    if (family === "wait-reset") {
      const requiredTurns = variants.length === 1 ? 1 : 2;
      return variants.filter((text) =>
        /^(?:等等|等一下|先等等|wait|hold on).{0,36}(?:不对|错了|反了|怎么|奇怪|更严重|问题|no|wrong|weird|strange|seriously|actually)/iu.test(text.trim()),
      ).length >= requiredTurns;
    }
    if (family === "root-cause-found") {
      // One exact declaration repeated several times is a real tic. For a
      // paraphrase family, require three actual cause declarations: broad
      // "confirmed issue / found bug" worklog lines must not inflate a wolf cry.
      const requiredAssertions = variants.length === 1 ? 1 : 3;
      return variants.filter((text) =>
        /(?:找到|找到了|定位到|确认了|锁定).{0,16}(?:根因|原因)|(?:根因|原因).{0,20}(?:就是|是|找到|确认|定位|锁定)|(?:root cause|actual cause).{0,20}(?:found|confirmed|identified|located|is)\b|\b(?:found|located|identified|confirmed).{0,20}\b(?:root cause|actual cause)\b/iu.test(text),
      ).length >= requiredAssertions;
    }
    return (moment.count ?? 0) >= 3;
  }
  if ((moment.count ?? 0) < 3) return false;

  const text = moment.primaryText.trim();
  if (text.length < 4 || text.length > 32) return false;
  if (/^(?:#{1,6}\s|[-*>]\s|\d+[.)、]\s*|[①-⑳])/u.test(text)) return false;
  if (/[`|/\\]/u.test(text)) return false;
  if (/^[A-Za-z0-9_.-]+:\s*$/u.test(text)) return false;
  if (/^[A-Za-z][A-Za-z0-9_.-]{1,24}:\s*[A-Za-z0-9_.-]{1,40}$/u.test(text)) return false;
  if (/\b[A-Za-z_$][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*\b/u.test(text)) return false;
  if (/^(?:(?:全部|任务|工作)?(?:已|已经)?(?:完成|搞定|结束|收尾)(?:了)?)[\s\p{P}\p{S}]*$/u.test(text)) return false;
  if (/^(?:解决方案|你要做的|下一步|处理方式|验证结果|验证配置)[：:]?$/u.test(text)) return false;
  if (/^(?:(?:核心|审查|检查)?结论(?:属实|不属实|正确|成立|如下)?(?:[，,:：。.!！\s]|$)|(?:重启|运行|执行|打开|关闭|安装|删除)(?:\s|$)|(?:restart|run|execute|open|close|install|delete)\b)/iu.test(text)) return false;
  if (/^(?:现在)?(?:结构|架构|链路|情况).{0,10}(?:清楚|明确|清晰)(?:了)?[。！!]?$/u.test(text)) return false;
  if (/^(?:(?:再|重新|继续)(?:测|测试|跑|运行)|(?:retest|rerun|run again))/iu.test(text)) return false;
  if (/(?:^|[\s/])[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+(?:$|[\s,，。])/u.test(text)) return false;
  const humanCharacters = (text.match(/[\p{L}\p{Script=Han}]/gu) ?? []).length;
  const visibleCharacters = (text.match(/[^\s]/gu) ?? []).length;
  return humanCharacters >= 4 && humanCharacters / Math.max(1, visibleCharacters) >= 0.45;
}

function hasVisibleDramaticTurn(text: string): boolean {
  return /(?:[！!]{2,}|等等|不对|重大发现|完全错|根本没|离谱|诡异|居然|竟然|高兴早了|wait|hold on|i was wrong|completely wrong|plot twist|ridiculous|weird)/iu.test(text);
}

function isShareableOneLiner(moment: RankedMoment): boolean {
  if (moment.type !== "one_liner") return true;
  const text = moment.primaryText.trim();
  if (hasVisibleDramaticTurn(text)) return true;
  if (/^(?:(?:确认了|已确认|核心结论|审查结论|检查结论|结论[:：]|你说得对|抱歉|对不起)(?:[，,:：。.!！\s]|$)|(?:confirmed|conclusion|review result|you(?:'re| are) right|sorry)\b)/iu.test(text)) return false;
  if (/(?:未发现|没有发现|不存在).{0,48}(?:问题|风险|漏洞|注入|死锁|篡改)|\b(?:no|did not find)\b.{0,40}\b(?:issue|risk|vulnerabilit|problem)\b/iu.test(text)) return false;
  return true;
}

function isStandaloneVictoryClaim(text: string): boolean {
  const trimmed = text.trim();
  return /^(?:(?:太好了|太棒了|漂亮|完美|搞定)(?:[，,:：。.!！\s]|$)|(?:great news|perfect|nailed it|we got it)\b)/iu.test(trimmed) ||
    /(?:这次|现在|终于|已经|问题|bug|修复|测试|tests?).{0,36}(?:修好|解决|搞定|没问题|全部通过|全绿|完成|fixed|solved|done|all pass|passed)/iu.test(trimmed) ||
    /\b\d+\s*\/\s*\d+\b.{0,24}(?:通过|pass(?:ed)?)|(?:通过|pass(?:ed)?).{0,24}\b\d+\s*\/\s*\d+\b/iu.test(trimmed);
}

function isShareableCorrection(moment: RankedMoment): boolean {
  if (moment.type !== "plot_twist" && moment.type !== "correction_arc") return true;
  const text = moment.primaryText.trim();
  return /(?:等等|等一下|先等等|wait|hold on).{0,36}(?:不对|错|反|wrong|no)/iu.test(text) ||
    /(?:我|我们|i|we).{0,32}(?:判断|诊断|路线|方向|思路|方案|看|做|搞|改|assumption|diagnosis|approach|direction|plan).{0,16}(?:错|反|偏|有误|wrong|mistake)/iu.test(text) ||
    /(?:第一轮|上一轮|每次|总是|一直).{0,36}(?:没|没有|失误|坏习惯|错)|(?:没有任何借口|no excuse|bad habit)/iu.test(text);
}

function isShareableBoomerang(moment: RankedMoment): boolean {
  if (moment.type !== "boomerang") return true;
  const visible = [moment.primaryText, ...moment.relatedTexts].join(" → ").trim();
  if (visible.length > 220) return false;
  if (visible.length > 140 && /[`*]/u.test(visible)) return false;
  return true;
}

function isShowableHighlight(moment: RankedMoment): boolean {
  if (!isShareableOneLiner(moment)) return false;
  if (!isShareableCorrection(moment)) return false;
  if (!isShareableBoomerang(moment)) return false;
  if (moment.type === "false_dawn" && !isStandaloneVictoryClaim(moment.primaryText)) return false;
  return true;
}

function sharesExactVisibleLine(left: RankedMoment, right: RankedMoment): boolean {
  if (isRepeatedPattern(left) === isRepeatedPattern(right)) return false;
  const repeated = isRepeatedPattern(left) ? left : right;
  const other = repeated === left ? right : left;
  const repeatedLines = [repeated.primaryText, ...repeated.relatedTexts, ...(repeated.variants ?? [])]
    .map(normalizeText)
    .filter(Boolean);
  const otherLines = [other.primaryText, ...other.relatedTexts]
    .map(normalizeText)
    .filter(Boolean);
  return setOverlap(repeatedLines, otherLines).intersection > 0;
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
    if (sharesExactVisibleLine(candidate, item.moment)) {
      return "overlaps-selected-visible-evidence";
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

      // One correction/failure pivot can be emitted as a false dawn, a
      // boomerang and a three-step arc. Those are alternate views of one
      // episode, not three cards for the same punchline.
      if (isStructuralStoryMoment(candidate) && isStructuralStoryMoment(item.moment)) {
        return "overlaps-selected-episode";
      }

      // Within the same user-visible award family, strongly overlapping graph
      // structures should collapse. Across different award families, sharing a
      // line can be valuable only when both cards have genuinely different
      // visible evidence.
      if (candidateKind === item.kind && overlap.containment > maxContainmentOverlap) {
        return "overlaps-selected-moment";
      }
    }

    // Structural views can describe the same local episode without sharing an
    // exact extracted unit. A nearby, specific visible anchor (for example a
    // package, file, or component name) is enough to make them competing
    // versions of the same punchline.
    if (
      isStructuralStoryMoment(candidate) &&
      isStructuralStoryMoment(item.moment) &&
      sharesStructuralAnchor(candidate, item.moment)
    ) {
      return "overlaps-selected-episode";
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
    if (!isShowableHighlight(moment)) {
      rejected.push({ momentId: moment.id, reason: "not-showable-highlight" });
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
