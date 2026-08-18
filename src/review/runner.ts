import { buildCalibrationReport } from "../evaluation/benchmark.js";
import { prepareLocalDshEvaluation, type PrepareLocalDshEvaluationOptions } from "../evaluation/localDsh.js";
import type { SessionEvaluationCase, SessionHumanReview } from "../evaluation/types.js";
import type { ReviewCalibrationResult, ReviewWorkspace, ReviewWorkspaceRefreshResult } from "./types.js";
import {
  computeReviewProgress,
  createOrRefreshReviewWorkspace,
  loadReviewWorkspace,
  markSessionReviewComplete,
  saveReviewWorkspace,
  upsertSessionReview,
} from "./workspace.js";

export interface RefreshLocalDshReviewOptions extends PrepareLocalDshEvaluationOptions {
  store?: string;
}

export interface SaveReviewCheckpointOptions {
  store?: string;
  completed?: boolean;
}

async function tryLoadExisting(store?: string): Promise<ReviewWorkspace | undefined> {
  try {
    return await loadReviewWorkspace(store);
  } catch (error) {
    if (error instanceof Error && error.message.includes("No review workspace found")) return undefined;
    throw error;
  }
}

/** Discover current local DSH sessions, build P6 cases, and atomically refresh the review workspace. */
export async function refreshLocalDshReviewWorkspace(
  options: RefreshLocalDshReviewOptions = {},
): Promise<ReviewWorkspaceRefreshResult & { path: string }> {
  const batch = await prepareLocalDshEvaluation({
    ingest: options.ingest,
    evaluation: options.evaluation,
  });
  const previous = await tryLoadExisting(options.store);
  const maxSessions = options.ingest?.maxSessions ?? 30;
  const refreshed = createOrRefreshReviewWorkspace(
    batch.cases,
    {
      host: "dsh",
      root: options.ingest?.root,
      maxSessions,
    },
    previous,
  );
  const path = await saveReviewWorkspace(refreshed.workspace, options.store);
  return { ...refreshed, path };
}

export function findEvaluationCase(
  workspace: ReviewWorkspace,
  sessionId: string,
): SessionEvaluationCase | undefined {
  return workspace.cases.find((entry) => entry.sessionId === sessionId);
}

export function findSessionReview(
  workspace: ReviewWorkspace,
  sessionId: string,
): SessionHumanReview | undefined {
  return workspace.reviews.find((entry) => entry.sessionId === sessionId);
}

export function nextIncompleteCase(workspace: ReviewWorkspace): SessionEvaluationCase | undefined {
  const complete = new Set(workspace.completedSessionIds);
  return workspace.cases.find((entry) => !complete.has(entry.sessionId));
}

/** Save one partial/completed review. Used after every answer so Ctrl+C can resume safely. */
export async function saveReviewCheckpoint(
  workspace: ReviewWorkspace,
  review: SessionHumanReview,
  options: SaveReviewCheckpointOptions = {},
): Promise<string> {
  upsertSessionReview(workspace, review);
  if (options.completed) markSessionReviewComplete(workspace, review.sessionId);
  return saveReviewWorkspace(workspace, options.store);
}

export function calibrateReviewWorkspace(workspace: ReviewWorkspace): ReviewCalibrationResult {
  return {
    report: buildCalibrationReport(workspace.cases, workspace.reviews),
    progress: computeReviewProgress(workspace),
  };
}
