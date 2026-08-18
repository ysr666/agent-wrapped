import type { AgentHost } from "../core/types.js";
import type { AwardKind } from "../awards/types.js";
import type { MomentType } from "../moments/types.js";

export interface EvaluationMomentSnapshot {
  id: string;
  type: MomentType;
  primaryText: string;
  relatedTexts: string[];
  funScore: number;
  confidence: number;
  selected: boolean;
  awardKind?: AwardKind;
  awardId?: string;
}

export interface PairwisePreferenceTask {
  id: string;
  sessionId: string;
  left: EvaluationMomentSnapshot;
  right: EvaluationMomentSnapshot;
  /** P3's current prediction, retained only for scoring after the human vote. */
  predictedWinnerId: string;
}

export interface SessionEvaluationCase {
  version: 1;
  sessionId: string;
  host: AgentHost;
  title?: string;
  model?: string;
  createdAt?: string;
  moments: EvaluationMomentSnapshot[];
  pairwiseTasks: PairwisePreferenceTask[];
}

export interface PairwisePreferenceVote {
  taskId: string;
  winner: "left" | "right" | "tie" | "skip";
}

export interface AwardPreferenceVote {
  awardId: string;
  verdict: "keep" | "drop";
  fun?: 1 | 2 | 3 | 4 | 5;
}

export interface MissedMomentNote {
  text: string;
  relatedText?: string;
  note?: string;
}

export interface SessionHumanReview {
  sessionId: string;
  awardVotes?: AwardPreferenceVote[];
  pairwiseVotes?: PairwisePreferenceVote[];
  /** Human-supplied moments the current pipeline failed to surface. */
  missedMoments?: MissedMomentNote[];
}

export interface PairwisePreferenceSummary {
  answered: number;
  decisive: number;
  ties: number;
  skipped: number;
  correct: number;
  accuracy: number;
  unknownTaskIds: string[];
}

export interface AwardKindCalibration {
  kind: AwardKind;
  votes: number;
  kept: number;
  keepRate: number;
  averageFun?: number;
}

export interface CalibrationReport {
  sessionsInDataset: number;
  sessionsReviewed: number;
  awardVotes: number;
  awardKeepRate: number;
  averageAwardFun?: number;
  pairwise: PairwisePreferenceSummary;
  missedMoments: number;
  byAwardKind: AwardKindCalibration[];
  reviewCoverage: number;
}
