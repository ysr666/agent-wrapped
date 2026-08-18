import { scoreQuote } from "./quoteScorer.js";

export interface QuoteFacetScores {
  /** One-off quote-of-the-session potential. */
  quote: number;
  /** Emotional / theatrical intensity, regardless of whether the line is profound. */
  drama: number;
  /** Discovery / root-cause announcement energy. */
  discovery: number;
  /** Explicit self-reversal / correction energy. */
  reversal: number;
  /** Progress-report / getting-closer announcement energy. */
  progress: number;
  /** Victory-lap / self-congratulation energy. */
  celebration: number;
  /** Repetition-driven verbal-tic potential. Requires session repetitionCount. */
  catchphrase: number;
  /** Repeated discovery declarations: candidate for the wolf-cried-again award. */
  wolfCry: number;
}

const DISCOVERY_PATTERNS = [
  /重大发现|重大突破/u,
  /(?:找到|找到了|定位到|确认了)(?:真正|实际|确切)?(?:的)?(?:问题|根因|原因|bug|缺陷)?/iu,
  /(?:真正|实际|确切)(?:的)?(?:问题|根因|原因)/u,
  /\b(?:found it|found the (?:issue|problem|root cause)|root cause|exact (?:bug|issue|defect|cause|break))\b/iu,
];

const CONFIDENCE_PATTERNS = [
  /(?:可以)?(?:确定|确认|肯定|明确)(?:了)?/u,
  /(?:真正|确切|唯一)(?:的)?(?:根因|原因|问题)/u,
  /(?:根因|原因)(?:就是|是)/u,
  /\b(?:definitely|certainly|clearly|exactly|without a doubt)\b/iu,
];

const REVERSAL_PATTERNS = [
  /(?:等等|等一下|先等等).{0,18}(?:不对|错了|反了)/u,
  /(?:之前|前面|刚才|先前).{0,24}(?:错(?:了|的)?|不对|判断有误|搞反了|走偏了|推翻)/u,
  /(?:路线|方向|思路|假设|判断|结论|方案).{0,24}(?:完全)?(?:错(?:了|的)?|不对|反了|走偏了)/u,
  /(?:收回|撤回|推翻)(?:我|我们)?(?:之前|刚才|前面)?/u,
  /(?:不是|并非).{0,36}(?:而是|其实是|真正是)/u,
  /\b(?:i|we)\s+(?:was|were)\s+wrong\b/iu,
  /\b(?:our|the)\s+(?:approach|assumption|direction|theory|path).{0,28}\bwrong\b/iu,
  /\b(?:take that back|scratch that|retract(?:ing)?|start over)\b/iu,
];

const CORRECTION_PATTERNS = [
  /(?:我|我们)(?:刚才|之前|前面)?(?:说错了|判断错了|搞错了|错了)/u,
  /(?:你说得对|你质疑得对|你是对的)/u,
  /(?:我收回|我撤回|更正一下|纠正一下)/u,
  /\b(?:i was wrong|we were wrong|you(?:'re| are) right|i stand corrected|my mistake)\b/iu,
];

const CONTRAST_PATTERNS = [
  /(?:但|但是|然而|可是|结果|却|反而|其实)/u,
  /\b(?:but|however|instead|turns out|actually)\b/iu,
];

const DRAMATIC_PATTERNS = [
  /(?:等等|等一下|先等等)/u,
  /(?:重大发现|重大突破|重大进展|关键进展)/u,
  /(?:离谱|诡异|奇怪|有意思|好家伙|没想到|居然|竟然)/u,
  /好消息|坏消息/u,
  /\b(?:wait|hold on|plot twist|found it|great news|this is interesting|surprisingly|unexpectedly)\b/iu,
];

const PROGRESS_PATTERNS = [
  /(?:重大|关键)?进展/u,
  /(?:接近|非常接近|快接近)(?:真正的)?(?:根因|答案|问题)/u,
  /(?:范围|问题范围).{0,12}(?:缩小|收窄)/u,
  /(?:方向|路线).{0,12}(?:基本对|对了|正确)/u,
  /(?:取得|有了).{0,10}(?:突破|进展)/u,
  /\b(?:progress|getting closer|narrowed it down|close to the root cause)\b/iu,
];

const CELEBRATION_PATTERNS = [
  /(?:太棒了|太好了|漂亮|完美|好家伙)/u,
  /(?:搞定了|修好了|解决了|完成了|命中|终于对了|没问题了|可以结束了)/u,
  /(?:问题解决|修复完成|检查都通过)/u,
  /\b(?:great news|perfect|fixed|solved|done|nailed it|success|we got it|all checks pass)\b/iu,
];

const CATCHPHRASE_TEMPLATE_PATTERNS = [
  /(?:问题|关键点|情况).{0,10}(?:清楚|明确)/u,
  /(?:找到|定位到|确认)(?:了)?(?:问题|根因|原因)/u,
  /(?:应该|这次应该)(?:真的)?(?:没问题|修好|可以)/u,
  /\b(?:problem is (?:very )?clear|found the (?:issue|root cause)|this should be fixed)\b/iu,
];

function hitCount(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function punctuationEnergy(text: string): number {
  const exclamations = [...text.matchAll(/[!！]/gu)].length;
  const questions = [...text.matchAll(/[?？]/gu)].length;
  const ellipses = [...text.matchAll(/(?:…{2,}|\.{3,})/gu)].length;
  return Math.min(45, Math.min(exclamations, 3) * 12 + Math.min(questions, 2) * 6 + Math.min(ellipses, 1) * 8);
}

/**
 * Score a line on several independent entertainment facets.
 *
 * `repetitionCount` must come from session-level normalization. Without it,
 * catchphrase and wolfCry intentionally stay at zero: a single line cannot be
 * a verbal tic or repeated false-alarm by itself.
 *
 * These facets are candidate signals, not final awards. Later context can turn
 * a modest line such as "应该修好了" into a great premature-celebration moment.
 */
export function scoreQuoteFacets(text: string, repetitionCount = 1): QuoteFacetScores {
  const candidate = text.trim();
  const punctuation = punctuationEnergy(candidate);
  const discoveryHits = hitCount(candidate, DISCOVERY_PATTERNS);
  const confidenceHits = hitCount(candidate, CONFIDENCE_PATTERNS);
  const reversalHits = hitCount(candidate, REVERSAL_PATTERNS);
  const correctionHits = hitCount(candidate, CORRECTION_PATTERNS);
  const contrastHits = hitCount(candidate, CONTRAST_PATTERNS);
  const dramaticHits = hitCount(candidate, DRAMATIC_PATTERNS);
  const progressHits = hitCount(candidate, PROGRESS_PATTERNS);
  const celebrationHits = hitCount(candidate, CELEBRATION_PATTERNS);
  const catchphraseTemplateHits = hitCount(candidate, CATCHPHRASE_TEMPLATE_PATTERNS);

  const quote = scoreQuote(candidate, repetitionCount, true).score;
  const drama = clampScore(punctuation + dramaticHits * 30 + contrastHits * 8);
  const discovery = clampScore(discoveryHits * 45 + confidenceHits * 15 + Math.min(punctuation, 15));
  const reversal = clampScore(reversalHits * 60 + correctionHits * 35 + contrastHits * 10);
  const progress = clampScore(progressHits * 60 + confidenceHits * 10 + Math.min(punctuation, 15));
  const celebration = clampScore(celebrationHits * 55 + Math.min(punctuation, 36));

  const repetitionEnergy = repetitionCount > 1 ? Math.log2(repetitionCount) : 0;
  const catchphrase = repetitionCount > 1
    ? clampScore(35 + repetitionEnergy * 18 + Math.min(catchphraseTemplateHits, 1) * 15)
    : 0;

  const wolfCry = repetitionCount > 1 && discoveryHits > 0
    ? clampScore(35 + discovery * 0.35 + repetitionEnergy * 18)
    : 0;

  return {
    quote,
    drama,
    discovery,
    reversal,
    progress,
    celebration,
    catchphrase,
    wolfCry,
  };
}
