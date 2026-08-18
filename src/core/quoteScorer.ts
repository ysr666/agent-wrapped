import type { QuoteHighlight, TranscriptMessage } from "./types.js";

export type QuoteSignal =
  | "punctuation"
  | "discovery"
  | "reversal"
  | "self-correction"
  | "confidence"
  | "dramatic-language"
  | "contrast"
  | "good-length"
  | "signal-synergy"
  | "generic-template"
  | "code-noise"
  | "repetition";

export interface QuoteScoreBreakdown {
  text: string;
  rawScore: number;
  score: number;
  signals: Partial<Record<QuoteSignal, number>>;
  reasons: string[];
}

export interface QuoteScorerOptions {
  limit?: number;
  minScore?: number;
  /**
   * Repeated lines are usually catchphrases, not one-off memorable quotes.
   * Keep this enabled for the default Agent Wrapped behavior.
   */
  penalizeRepetition?: boolean;
}

const DISCOVERY_PATTERNS = [
  /重大发现/u,
  /重大突破/u,
  /(?:我|我们)?(?:终于)?(?:发现|找到了|定位到|确认了)(?:真正|实际|确切)?(?:的)?(?:问题|根因|原因|bug|缺陷)?/iu,
  /(?:真正|实际|确切)(?:的)?(?:问题|根因|原因).{0,12}(?:找到|找到了|是|在这里)/iu,
  /原来(?:是|问题在|根因在)?/u,
  /\b(?:i|we)\s+(?:finally\s+)?(?:found|located|identified|confirmed)\b/iu,
  /\bfound it\b/iu,
  /\broot cause\b/iu,
  /\bexact\s+(?:bug|issue|defect|cause|break)\b/iu,
  /\bnow i (?:see|understand)\b/iu,
];

const REVERSAL_PATTERNS = [
  /不对[，,。.!！]?/u,
  /(?:之前|前面|刚才|先前).{0,20}(?:错(?:了|的)?|不对|判断有误|搞反了|走偏了)/u,
  /(?:路线|方向|思路|假设|判断|结论|方案).{0,20}(?:完全)?(?:错(?:了|的)?|不对|反了|走偏了)/u,
  /(?:完全|根本)(?:走错|错了|不对)/u,
  /(?:不是|并非).{0,32}(?:而是|其实是|真正是)/u,
  /(?:推翻|撤回|收回)(?:我|我们)?(?:之前|刚才|前面)?/u,
  /(?:重新来|从头来|换个方向|换条路)/u,
  /\b(?:i|we)\s+(?:was|were)\s+wrong\b/iu,
  /\b(?:our|the)\s+(?:approach|assumption|direction|theory|path).{0,24}\bwrong\b/iu,
  /\bnot\b.{0,32}\bbut\b/iu,
  /\b(?:scratch that|start over|take that back|retract(?:ing)?)\b/iu,
  /\bwait[,—\s-]*(?:no|that's wrong|i was wrong)\b/iu,
];

const SELF_CORRECTION_PATTERNS = [
  /(?:我|我们)(?:刚才|之前|前面)?(?:说错了|判断错了|搞错了|错了)/u,
  /(?:你说得对|你质疑得对|你是对的)/u,
  /(?:我收回|我撤回|更正一下|纠正一下)/u,
  /\b(?:i was wrong|we were wrong|you(?:'re| are) right|i stand corrected|my mistake)\b/iu,
  /\b(?:take that back|retract that|correction:)\b/iu,
];

const CONFIDENCE_PATTERNS = [
  /(?:已经|现在)?(?:可以)?(?:确定|确认|肯定|明确)(?:了)?/u,
  /毫无疑问/u,
  /可以排除/u,
  /(?:真正|确切|唯一)(?:的)?(?:根因|原因|问题)/u,
  /(?:根因|原因)(?:就是|是)/u,
  /完全/u,
  /\b(?:definitely|certainly|clearly|exactly|without a doubt)\b/iu,
  /\bthe root cause is\b/iu,
  /\bwe can rule out\b/iu,
  /\bthis is the (?:exact|real) (?:issue|bug|cause)\b/iu,
];

const DRAMATIC_PATTERNS = [
  /(?:等等|等一下|先等等)/u,
  /(?:重大发现|重大突破)/u,
  /好消息.{0,30}坏消息/u,
  /(?:事情|情况)(?:开始)?变得(?:有趣|奇怪|诡异|复杂)/u,
  /(?:这就|这下)(?:有意思|有趣|奇怪)了/u,
  /居然|竟然|没想到/u,
  /\b(?:wait|hold on|plot twist|this is interesting|things just got interesting)\b/iu,
  /\b(?:surprisingly|unexpectedly)\b/iu,
];

const CONTRAST_PATTERNS = [
  /(?:但|但是|然而|可是|结果|却|反而)/u,
  /(?:好消息|坏消息)/u,
  /\b(?:but|however|except|instead|turns out)\b/iu,
];

const GENERIC_TEMPLATE_PATTERNS = [
  /^(?:好的?[，,\s]*)?(?:现在|目前)?(?:这个)?问题(?:已经)?(?:非常|很)?明确了?[。.!！]*$/u,
  /^(?:好的?[，,\s]*)?(?:我|我们)(?:现在)?(?:已经)?找到(?:了)?(?:问题|根因|原因)[。.!！]*$/u,
  /^(?:okay[,\s]*)?(?:now\s+)?(?:the\s+)?problem is (?:very\s+)?clear[.!]*$/iu,
  /^(?:i|we) found the (?:issue|problem|root cause)[.!]*$/iu,
  /^(?:got it|understood|makes sense)[.!]*$/iu,
];

function countMatches(text: string, regex: RegExp): number {
  const flags = regex.flags.includes("g") ? regex.flags : `${regex.flags}g`;
  const global = new RegExp(regex.source, flags);
  return [...text.matchAll(global)].length;
}

function matchCount(text: string, patterns: RegExp[]): number {
  return patterns.reduce((sum, pattern) => sum + (pattern.test(text) ? 1 : 0), 0);
}

function normalizeForRepetition(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[“”"'`*_~]/gu, "")
    .replace(/[。！？!?…，,；;：:\s]+/gu, " ")
    .trim();
}

function isCodeLike(text: string): boolean {
  if (/```|(?:^|\s)(?:npm|pnpm|yarn|git|curl|cd|ls|grep|cat)\s/iu.test(text)) return true;
  if (/\b(?:TypeError|ReferenceError|SyntaxError|stack trace|node_modules)\b/iu.test(text)) return true;
  if (/(?:\/[\w.-]+){3,}/u.test(text)) return true;

  const syntaxChars = countMatches(text, /[{}[\]<>:=;]/u);
  return text.length > 24 && syntaxChars / text.length > 0.12;
}

function splitIntoSentenceLikeUnits(text: string): string[] {
  const normalized = text.replace(/\r\n?/gu, "\n");
  const units: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine
      .replace(/^\s*(?:[-*+]\s+|>+\s*|#{1,6}\s+)/u, "")
      .trim();
    if (!line) continue;

    const matches = line.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/gu);
    if (!matches) {
      units.push(line);
      continue;
    }

    for (const match of matches) {
      const sentence = match.trim();
      if (sentence) units.push(sentence);
    }
  }

  return units;
}

function addSignal(
  signals: Partial<Record<QuoteSignal, number>>,
  reasons: string[],
  signal: QuoteSignal,
  value: number,
  reason: string,
): number {
  if (value === 0) return 0;
  signals[signal] = (signals[signal] ?? 0) + value;
  reasons.push(reason);
  return value;
}

function scorePunctuation(text: string): number {
  const exclamations = countMatches(text, /[!！]/u);
  const questions = countMatches(text, /[?？]/u);
  const ellipses = countMatches(text, /(?:…{2,}|\.{3,})/u);

  let score = Math.min(exclamations, 3) * 0.55;
  if (exclamations >= 3) score += 0.55;
  if (questions >= 2) score += 0.35;
  if (ellipses > 0) score += 0.25;

  return Math.min(score, 2.5);
}

export function scoreQuote(
  text: string,
  repetitionCount = 1,
  penalizeRepetition = true,
): QuoteScoreBreakdown {
  const candidate = text.trim();
  const signals: Partial<Record<QuoteSignal, number>> = {};
  const reasons: string[] = [];
  let rawScore = 0;

  const punctuation = scorePunctuation(candidate);
  if (punctuation > 0) {
    rawScore += addSignal(signals, reasons, "punctuation", punctuation, "expressive punctuation");
  }

  const discoveryHits = matchCount(candidate, DISCOVERY_PATTERNS);
  if (discoveryHits > 0) {
    const value = Math.min(2.8, 1.45 + discoveryHits * 0.65);
    rawScore += addSignal(signals, reasons, "discovery", value, "discovery / root-cause declaration");
  }

  const reversalHits = matchCount(candidate, REVERSAL_PATTERNS);
  if (reversalHits > 0) {
    const value = Math.min(4.4, 2.4 + reversalHits * 0.9);
    rawScore += addSignal(signals, reasons, "reversal", value, "explicit reversal of an earlier direction");
  }

  const correctionHits = matchCount(candidate, SELF_CORRECTION_PATTERNS);
  if (correctionHits > 0) {
    const value = Math.min(2.8, 1.65 + correctionHits * 0.7);
    rawScore += addSignal(signals, reasons, "self-correction", value, "explicit self-correction");
  }

  const confidenceHits = matchCount(candidate, CONFIDENCE_PATTERNS);
  if (confidenceHits > 0) {
    const value = Math.min(1.9, 0.75 + confidenceHits * 0.45);
    rawScore += addSignal(signals, reasons, "confidence", value, "high-confidence wording");
  }

  const dramaticHits = matchCount(candidate, DRAMATIC_PATTERNS);
  if (dramaticHits > 0) {
    const value = Math.min(2.2, 0.9 + dramaticHits * 0.6);
    rawScore += addSignal(signals, reasons, "dramatic-language", value, "dramatic / surprising language");
  }

  const contrastHits = matchCount(candidate, CONTRAST_PATTERNS);
  if (contrastHits > 0) {
    const value = Math.min(1.4, 0.55 + contrastHits * 0.35);
    rawScore += addSignal(signals, reasons, "contrast", value, "contains an explicit contrast or twist");
  }

  if (candidate.length >= 10 && candidate.length <= 180) {
    rawScore += addSignal(signals, reasons, "good-length", 0.8, "compact enough to work as a quote");
  } else if (candidate.length < 6) {
    rawScore -= 1.1;
  } else if (candidate.length > 320) {
    rawScore -= 1.4;
  }

  const hasDiscovery = discoveryHits > 0;
  const hasReversal = reversalHits > 0;
  const hasCorrection = correctionHits > 0;
  const hasDrama = dramaticHits > 0 || punctuation >= 1.1;
  const hasConfidence = confidenceHits > 0;

  let synergy = 0;
  if (hasDiscovery && hasReversal) synergy += 1.7;
  if (hasReversal && hasDrama) synergy += 1.25;
  if (hasCorrection && hasReversal) synergy += 0.8;
  if (hasConfidence && hasReversal) synergy += 0.65;
  if (hasDiscovery && hasDrama) synergy += 0.55;
  synergy = Math.min(synergy, 3.6);

  if (synergy > 0) {
    rawScore += addSignal(signals, reasons, "signal-synergy", synergy, "multiple dramatic signals reinforce each other");
  }

  if (GENERIC_TEMPLATE_PATTERNS.some((pattern) => pattern.test(candidate))) {
    const penalty = -2.7;
    rawScore += addSignal(signals, reasons, "generic-template", penalty, "generic agent template rather than a unique quote");
  }

  if (isCodeLike(candidate)) {
    const penalty = -3.2;
    rawScore += addSignal(signals, reasons, "code-noise", penalty, "looks like code, a command, or stack-trace noise");
  }

  if (penalizeRepetition && repetitionCount > 1) {
    const penalty = -Math.min(2.8, Math.log2(repetitionCount) * 0.9);
    rawScore += addSignal(signals, reasons, "repetition", penalty, `repeated ${repetitionCount} times; likely a catchphrase instead`);
  }

  const score = Math.max(0, Math.min(100, Math.round((rawScore / 16) * 100)));

  return {
    text: candidate,
    rawScore: Number(rawScore.toFixed(3)),
    score,
    signals,
    reasons,
  };
}

export function rankQuoteCandidates(
  messages: TranscriptMessage[],
  options: QuoteScorerOptions = {},
): QuoteHighlight[] {
  const limit = options.limit ?? 10;
  const minScore = options.minScore ?? 12;
  const penalizeRepetition = options.penalizeRepetition ?? true;

  const candidates: Array<{ text: string; messageIndex: number }> = [];

  messages.forEach((message, messageIndex) => {
    if (message.role !== "assistant") return;

    for (const text of splitIntoSentenceLikeUnits(message.text)) {
      if (text.length < 4) continue;
      candidates.push({ text, messageIndex });
    }
  });

  const repetitionCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = normalizeForRepetition(candidate.text);
    repetitionCounts.set(key, (repetitionCounts.get(key) ?? 0) + 1);
  }

  return candidates
    .map((candidate) => {
      const repetitionCount = repetitionCounts.get(normalizeForRepetition(candidate.text)) ?? 1;
      const scored = scoreQuote(candidate.text, repetitionCount, penalizeRepetition);

      return {
        kind: "quote" as const,
        text: candidate.text,
        score: scored.score,
        messageIndex: candidate.messageIndex,
        reasons: scored.reasons,
      };
    })
    .filter((candidate) => candidate.score >= minScore)
    .sort((a, b) => b.score - a.score || a.messageIndex - b.messageIndex)
    .slice(0, limit);
}
