import { buildCalibrationReport } from "../evaluation/benchmark.js";
import { prepareLocalDshEvaluation, type PrepareLocalDshEvaluationOptions } from "../evaluation/localDsh.js";
import type { SessionEvaluationCase, SessionHumanReview } from "../evaluation/types.js";
import type { PresentationLocale } from "../presentation/localization.js";
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
  /** Reader language bound to the resulting human-review workspace. */
  reviewLocale?: PresentationLocale;
}

export interface SaveReviewCheckpointOptions {
  store?: string;
  completed?: boolean;
}

export interface DshReviewIngestionHealth {
  discoveredSessions: number;
  sessionsWithAssistantMessages: number;
  assistantMessages: number;
  sessionsWithMoments: number;
  ingestionWarnings: number;
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
): Promise<ReviewWorkspaceRefreshResult & { path: string; ingestion: DshReviewIngestionHealth }> {
  const batch = await prepareLocalDshEvaluation({
    ingest: options.ingest,
    evaluation: options.evaluation,
  });

  // A batch of several real sessions with zero assistant text is almost never a
  // legitimate "quiet session" result. It means the adapter likely stopped
  // understanding DSH's durable message envelope. Fail before overwriting a
  // useful review workspace with empty cases.
  if (batch.discoveredSessions >= 3 && batch.assistantMessages === 0) {
    throw new Error(
      `DSH ingestion recovered 0 visible assistant messages from ${batch.discoveredSessions} sessions. ` +
      "This usually means the DSH session format is not being parsed correctly; the review workspace was not refreshed.",
    );
  }

  const previous = await tryLoadExisting(options.store);
  const maxSessions = options.ingest?.maxSessions ?? 30;
  const refreshed = createOrRefreshReviewWorkspace(
    batch.cases,
    {
      host: "dsh",
      root: options.ingest?.root,
      maxSessions,
      sessionIdHashes: options.ingest?.sessionIdHashes,
    },
    previous,
    { presentationLocale: options.reviewLocale },
  );
  const path = await saveReviewWorkspace(refreshed.workspace, options.store);
  return {
    ...refreshed,
    path,
    ingestion: {
      discoveredSessions: batch.discoveredSessions,
      sessionsWithAssistantMessages: batch.sessionsWithAssistantMessages,
      assistantMessages: batch.assistantMessages,
      sessionsWithMoments: batch.sessionsWithMoments,
      ingestionWarnings: batch.ingestionWarnings,
    },
  };
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
  return workspace.reviews.find(
    (entry) =>
      entry.sessionId === sessionId &&
      entry.protocolVersion === workspace.protocolVersion &&
      entry.presentationLocale === workspace.presentationLocale,
  );
}

export function nextIncompleteCase(workspace: ReviewWorkspace): SessionEvaluationCase | undefined {
  const compatibleReviewIds = new Set(
    workspace.reviews
      .filter(
        (review) =>
          review.protocolVersion === workspace.protocolVersion &&
          review.presentationLocale === workspace.presentationLocale,
      )
      .map((review) => review.sessionId),
  );
  const complete = new Set(
    workspace.completedSessionIds.filter((sessionId) => compatibleReviewIds.has(sessionId)),
  );
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
  const compatibleReviews = workspace.reviews.filter(
    (review) =>
      review.protocolVersion === workspace.protocolVersion &&
      review.presentationLocale === workspace.presentationLocale,
  );
  return {
    report: buildCalibrationReport(workspace.cases, compatibleReviews),
    progress: computeReviewProgress(workspace),
  };
}
