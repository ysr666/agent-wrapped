import type { CalibrationReport, SessionEvaluationCase, SessionHumanReview } from "../evaluation/types.js";

export interface ReviewWorkspaceSource {
  host: "dsh";
  root?: string;
  maxSessions: number;
}

/**
 * Local P7 review state. It stores P6 evaluation cases and human judgments,
 * never the original full transcript artifacts.
 */
export interface ReviewWorkspace {
  version: 1;
  createdAt: string;
  updatedAt: string;
  source: ReviewWorkspaceSource;
  cases: SessionEvaluationCase[];
  caseFingerprints: Record<string, string>;
  reviews: SessionHumanReview[];
  completedSessionIds: string[];
}

export interface ReviewWorkspaceProgress {
  sessions: number;
  completedSessions: number;
  remainingSessions: number;
  awardCards: number;
  awardVotes: number;
  pairwiseTasks: number;
  pairwiseVotes: number;
  missedMoments: number;
}

export interface ReviewWorkspaceRefreshResult {
  workspace: ReviewWorkspace;
  addedSessions: number;
  preservedReviews: number;
  invalidatedReviews: number;
}

export interface ReviewSessionResult {
  review: SessionHumanReview;
  completed: boolean;
  quitRequested: boolean;
}

export interface ReviewIO {
  write(text: string): void;
  ask(prompt: string): Promise<string>;
}

export interface ReviewSessionOptions {
  /** Persist partial progress after every accepted answer. */
  onCheckpoint?: (review: SessionHumanReview) => void | Promise<void>;
}

export interface ReviewCalibrationResult {
  report: CalibrationReport;
  progress: ReviewWorkspaceProgress;
}
