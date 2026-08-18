import { scoreQuote } from "./quoteScorer.js";
import { extractEventFromText, getEventStrength } from "../events/eventExtractor.js";

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

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Compatibility scorer for the existing awards layer.
 *
 * Language understanding now comes from the shared EventExtractor. This file
 * converts unified event strengths into the older facet surface while P2 moves
 * SessionAnalyzer from awards-first output to Moment objects.
 */
export function scoreQuoteFacets(text: string, repetitionCount = 1): QuoteFacetScores {
  const candidate = text.trim();
  const event = extractEventFromText(candidate);

  const discoveryStrength = getEventStrength(event, "discovery_claim");
  const confidenceStrength = getEventStrength(event, "confidence_claim");
  const reversalStrength = getEventStrength(event, "reversal");
  const correctionStrength = getEventStrength(event, "correction");
  const progressStrength = getEventStrength(event, "progress_claim");
  const celebrationStrength = getEventStrength(event, "celebration");
  const resolutionStrength = getEventStrength(event, "resolution_claim");

  const quote = scoreQuote(candidate, repetitionCount, true).score;
  const drama = event.drama;
  const discovery = clampScore(
    discoveryStrength * 0.88 + confidenceStrength * 0.18 + Math.min(event.drama, 15),
  );
  const reversal = clampScore(
    reversalStrength + correctionStrength * 0.42,
  );
  const progress = clampScore(
    progressStrength + confidenceStrength * 0.12 + Math.min(event.drama, 12),
  );
  const celebration = clampScore(
    Math.max(celebrationStrength, resolutionStrength * 0.82) + Math.min(event.drama, 24) * 0.35,
  );

  const repetitionEnergy = repetitionCount > 1 ? Math.log2(repetitionCount) : 0;
  const catchphrase = repetitionCount > 1
    ? clampScore(35 + repetitionEnergy * 18 + (event.verbalFamily ? 15 : 0))
    : 0;

  const wolfCry = repetitionCount > 1 && discoveryStrength > 0
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
