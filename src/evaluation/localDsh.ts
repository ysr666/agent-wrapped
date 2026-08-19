import { loadDshSessions, type LoadDshSessionsOptions } from "../ingest/dshFilesystem.js";
import { buildEvaluationDataset, type BuildEvaluationCaseOptions } from "./benchmark.js";
import type { SessionEvaluationCase } from "./types.js";

export interface PrepareLocalDshEvaluationOptions {
  ingest?: LoadDshSessionsOptions;
  evaluation?: BuildEvaluationCaseOptions;
}

export interface LocalDshEvaluationBatch {
  discoveredSessions: number;
  evaluatedSessions: number;
  /** Sessions from which at least one visible assistant text message was recovered. */
  sessionsWithAssistantMessages: number;
  /** Total visible assistant messages passed into P0. */
  assistantMessages: number;
  /** Sessions that produced at least one P6 moment snapshot. */
  sessionsWithMoments: number;
  /** Warning-level P5 diagnostics across the ingested batch. */
  ingestionWarnings: number;
  cases: SessionEvaluationCase[];
}

/**
 * P5→P6 convenience path for local calibration runs.
 *
 * This deliberately returns only evaluation cases and aggregate ingestion
 * health, not full transcript copies. The health counters make schema drift
 * visible before a reviewer wastes time judging an empty workspace.
 */
export async function prepareLocalDshEvaluation(
  options: PrepareLocalDshEvaluationOptions = {},
): Promise<LocalDshEvaluationBatch> {
  const sessions = await loadDshSessions(options.ingest);
  const cases = buildEvaluationDataset(sessions, options.evaluation);
  const assistantCounts = sessions.map(
    (session) => session.messages.filter((message) => message.role === "assistant").length,
  );

  return {
    discoveredSessions: sessions.length,
    evaluatedSessions: cases.length,
    sessionsWithAssistantMessages: assistantCounts.filter((count) => count > 0).length,
    assistantMessages: assistantCounts.reduce((sum, count) => sum + count, 0),
    sessionsWithMoments: cases.filter((entry) => entry.moments.length > 0).length,
    ingestionWarnings: sessions.reduce(
      (sum, session) => sum + session.diagnostics.filter((entry) => entry.level === "warning").length,
      0,
    ),
    cases,
  };
}
