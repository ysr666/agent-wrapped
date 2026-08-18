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
  cases: SessionEvaluationCase[];
}

/**
 * P5→P6 convenience path for local calibration runs.
 *
 * This deliberately returns only evaluation cases, not full transcript copies.
 * A future CLI/UI can persist these cases and collect human votes without
 * changing the core ingestion or calibration APIs.
 */
export async function prepareLocalDshEvaluation(
  options: PrepareLocalDshEvaluationOptions = {},
): Promise<LocalDshEvaluationBatch> {
  const sessions = await loadDshSessions(options.ingest);
  const cases = buildEvaluationDataset(sessions, options.evaluation);
  return {
    discoveredSessions: sessions.length,
    evaluatedSessions: cases.length,
    cases,
  };
}
