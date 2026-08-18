import type { TranscriptMessage } from "../core/types.js";
import type { MomentBuilderOptions } from "../moments/momentBuilder.js";
import type { MomentRankerOptions } from "../moments/momentRanker.js";
import type { RankedMoment } from "../moments/types.js";
import type { MomentGraphOptions } from "../graph/types.js";
import type {
  Award,
  AwardComposerOptions,
  AwardLocale,
  RejectedAwardCandidate,
} from "../awards/types.js";

export interface WrappedMetrics {
  messages: number;
  assistantMessages: number;
  events: number;
  relations: number;
  momentCandidates: number;
  rankedMoments: number;
  awards: number;
  topFunScore: number;
}

export interface WrappedDiagnostics {
  rejectedAwards: RejectedAwardCandidate[];
}

export interface WrappedReport {
  version: 1;
  locale: AwardLocale;
  title: string;
  awards: Award[];
  metrics: WrappedMetrics;
  diagnostics: WrappedDiagnostics;
  /** Optional debug/evaluation payload. Disabled by default for share output. */
  rankedMoments?: RankedMoment[];
}

export interface CreateWrappedReportOptions {
  locale?: AwardLocale;
  title?: string;
  graph?: MomentGraphOptions;
  builder?: MomentBuilderOptions;
  ranker?: MomentRankerOptions;
  awards?: AwardComposerOptions;
  /** Include P3 ranked moments for evaluation/debugging. Defaults to false. */
  includeRankedMoments?: boolean;
}

export interface WrappedRenderOptions {
  /** Include compact score metadata underneath each award. Defaults to false. */
  includeScores?: boolean;
  /** Include session candidate counts in the footer. Defaults to true. */
  includeMetrics?: boolean;
}

export interface WrappedPreferenceVote {
  awardId: string;
  verdict: "keep" | "drop";
  /** Optional 1-5 human fun rating. */
  fun?: 1 | 2 | 3 | 4 | 5;
}

export interface WrappedPreferenceSummary {
  voted: number;
  kept: number;
  dropped: number;
  keepRate: number;
  averageFun?: number;
  missingAwardIds: string[];
}

export type WrappedTranscript = TranscriptMessage[];
