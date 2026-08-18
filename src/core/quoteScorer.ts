import { extractEventFromText, getEventStrength } from "../events/eventExtractor.js";
import { punctuationEnergy } from "../events/lexicon.js";
import {
  extractTranscriptUnits,
  normalizeUnitText,
} from "../transcript/unitExtractor.js";
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

const CONTRAST_PATTERNS = [
  /(?:但|但是|然而|可是|结果|却|反而|其实)/u,
  /(?:好消息|坏消息)/u,
  /\b(?:but|however|except|instead|turns out|actually)\b/iu,
];

const GENERIC_TEMPLATE_PATTERNS = [
  /^(?:好的?[，,\s]*)?(?:现在|目前)?(?:这个)?问题(?:已经)?(?:非常|很)?(?:明确|清楚)了?[。.!！]*$/u,
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

function isCodeLike(text: string): boolean {
  if (/```|(?:^|\s)(?:npm|pnpm|yarn|git|curl|cd|ls|grep|cat)\s/iu.test(text)) return true;
  if (/\b(?:TypeError|ReferenceError|SyntaxError|stack trace|node_modules)\b/iu.test(text)) return true;
  if (/(?:\/[\w.-]+){3,}/u.test(text)) return true;

  const syntaxChars = countMatches(text, /[{}[\]<>:=;]/u);
  return text.length > 24 && syntaxChars / text.length > 0.12;
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

function punctuationRawScore(text: string): number {
  // EventExtractor owns the punctuation measurement; this converts 0-100 energy
  // into the historical QuoteScorer raw-score scale.
  return Math.min(2.5, punctuationEnergy(text) / 16);
}

function strengthValue(strength: number, base: number, extra: number, cap: number): number {
  if (strength <= 0) return 0;
  return Math.min(cap, base + (strength / 100) * extra);
}

/**
 * Standalone quote scorer. Semantic cues come from EventExtractor; this layer
 * only decides how well one line works as a screenshot-worthy quote.
 */
export function scoreQuote(
  text: string,
  repetitionCount = 1,
  penalizeRepetition = true,
): QuoteScoreBreakdown {
  const candidate = text.trim();
  const event = extractEventFromText(candidate);
  const signals: Partial<Record<QuoteSignal, number>> = {};
  const reasons: string[] = [];
  let rawScore = 0;

  const punctuation = punctuationRawScore(candidate);
  if (punctuation > 0) {
    rawScore += addSignal(signals, reasons, "punctuation", punctuation, "expressive punctuation");
  }

  const discoveryStrength = getEventStrength(event, "discovery_claim");
  const reversalStrength = getEventStrength(event, "reversal");
  const correctionStrength = getEventStrength(event, "correction");
  const confidenceStrength = getEventStrength(event, "confidence_claim");
  const confusionStrength = getEventStrength(event, "confusion");
  const celebrationStrength = getEventStrength(event, "celebration");
  const progressStrength = getEventStrength(event, "progress_claim");

  const discovery = strengthValue(discoveryStrength, 1.45, 1.65, 2.8);
  if (discovery > 0) {
    rawScore += addSignal(signals, reasons, "discovery", discovery, "discovery / root-cause declaration");
  }

  const reversal = strengthValue(reversalStrength, 2.35, 2.25, 4.4);
  if (reversal > 0) {
    rawScore += addSignal(signals, reasons, "reversal", reversal, "explicit reversal of an earlier direction");
  }

  const correction = strengthValue(correctionStrength, 1.55, 1.55, 2.8);
  if (correction > 0) {
    rawScore += addSignal(signals, reasons, "self-correction", correction, "explicit self-correction");
  }

  const confidence = strengthValue(confidenceStrength, 0.65, 1.25, 1.9);
  if (confidence > 0) {
    rawScore += addSignal(signals, reasons, "confidence", confidence, "high-confidence wording");
  }

  const dramaticStrength = Math.max(confusionStrength, celebrationStrength * 0.8, progressStrength * 0.7);
  const dramatic = strengthValue(dramaticStrength, 0.7, 1.45, 2.2);
  if (dramatic > 0) {
    rawScore += addSignal(signals, reasons, "dramatic-language", dramatic, "dramatic / surprising language");
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

  const hasDiscovery = discoveryStrength > 0;
  const hasReversal = reversalStrength > 0;
  const hasCorrection = correctionStrength > 0;
  const hasDrama = dramaticStrength > 0 || punctuation >= 1.1;
  const hasConfidence = confidenceStrength > 0;

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
  const candidates = extractTranscriptUnits(messages, { assistantOnly: true }).filter(
    (unit) => unit.text.length >= 4,
  );

  const repetitionCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = normalizeUnitText(candidate.text);
    repetitionCounts.set(key, (repetitionCounts.get(key) ?? 0) + 1);
  }

  return candidates
    .map((candidate) => {
      const repetitionCount = repetitionCounts.get(normalizeUnitText(candidate.text)) ?? 1;
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
