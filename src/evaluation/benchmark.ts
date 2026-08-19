import type { AwardKind } from "../awards/types.js";
import type { IngestedSession } from "../ingest/types.js";
import { createWrappedReport, type CreateWrappedReportOptions } from "../wrapped/wrappedReport.js";
import type {
  AwardKindCalibration,
  AwardPreferenceVote,
  CalibrationReport,
  EvaluationMomentSnapshot,
  PairwisePreferenceSummary,
  PairwisePreferenceTask,
  PairwisePreferenceVote,
  SessionEvaluationCase,
  SessionHumanReview,
} from "./types.js";

export interface BuildEvaluationCaseOptions {
  /** Top P3 moments retained for human comparison. Defaults to 8, max 20. Selected awards are always retained too. */
  topMoments?: number;
  /** Maximum pairwise tasks generated per session. Defaults to 12, max 40. */
  maxPairwiseTasks?: number;
  wrapped?: Omit<CreateWrappedReportOptions, "includeRankedMoments">;
}

function clampCount(value: number | undefined, fallback: number, max: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) return fallback;
  return Math.max(0, Math.min(max, Math.floor(resolved)));
}

function selectedAwardMap(report: ReturnType<typeof createWrappedReport>): Map<string, { kind: AwardKind; id: string }> {
  return new Map(report.awards.map((award) => [award.momentId, { kind: award.kind, id: award.id }]));
}

function toSnapshot(
  moment: NonNullable<ReturnType<typeof createWrappedReport>["rankedMoments"]>[number],
  selected: Map<string, { kind: AwardKind; id: string }>,
): EvaluationMomentSnapshot {
  const award = selected.get(moment.id);
  return {
    id: moment.id,
    type: moment.type,
    primaryText: moment.primaryText,
    relatedTexts: [...moment.relatedTexts],
    family: moment.family,
    count: moment.count,
    variants: moment.variants ? [...moment.variants] : undefined,
    funScore: moment.scores.funScore,
    confidence: moment.scores.confidence,
    selected: award !== undefined,
    awardKind: award?.kind,
    awardId: award?.id,
  };
}

function snapshotMoments(
  report: ReturnType<typeof createWrappedReport>,
  topMoments: number,
): EvaluationMomentSnapshot[] {
  const selected = selectedAwardMap(report);
  const ranked = report.rankedMoments ?? [];
  const retained = new Map<string, EvaluationMomentSnapshot>();

  for (const moment of ranked.slice(0, topMoments)) {
    retained.set(moment.id, toSnapshot(moment, selected));
  }

  for (const moment of ranked) {
    if (!selected.has(moment.id) || retained.has(moment.id)) continue;
    retained.set(moment.id, toSnapshot(moment, selected));
  }

  return [...retained.values()].sort(
    (a, b) => b.funScore - a.funScore || b.confidence - a.confidence || a.id.localeCompare(b.id),
  );
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

function buildPairwiseTasks(
  sessionId: string,
  moments: EvaluationMomentSnapshot[],
  maxTasks: number,
): PairwisePreferenceTask[] {
  const output: PairwisePreferenceTask[] = [];
  const seen = new Set<string>();

  const add = (left: EvaluationMomentSnapshot | undefined, right: EvaluationMomentSnapshot | undefined): void => {
    if (!left || !right || left.id === right.id || output.length >= maxTasks) return;
    const key = pairKey(left.id, right.id);
    if (seen.has(key)) return;
    seen.add(key);
    const predictedWinnerId =
      left.funScore > right.funScore ||
      (left.funScore === right.funScore && left.confidence >= right.confidence)
        ? left.id
        : right.id;
    output.push({
      id: `${sessionId}:pair:${output.length + 1}`,
      sessionId,
      left,
      right,
      predictedWinnerId,
    });
  };

  for (let index = 0; index + 1 < moments.length && output.length < maxTasks; index += 1) {
    add(moments[index], moments[index + 1]);
  }

  const selected = moments.filter((moment) => moment.selected);
  const rejected = moments.filter((moment) => !moment.selected);
  for (const chosen of selected) {
    for (const alternative of rejected.slice(0, 3)) {
      add(chosen, alternative);
      if (output.length >= maxTasks) break;
    }
    if (output.length >= maxTasks) break;
  }

  return output;
}

export function buildSessionEvaluationCase(
  session: IngestedSession,
  options: BuildEvaluationCaseOptions = {},
): SessionEvaluationCase {
  const topMoments = clampCount(options.topMoments, 8, 20);
  const maxPairwiseTasks = clampCount(options.maxPairwiseTasks, 12, 40);
  const report = createWrappedReport(session.messages, {
    ...options.wrapped,
    includeRankedMoments: true,
  });
  const moments = snapshotMoments(report, topMoments);

  return {
    version: 1,
    sessionId: session.id,
    host: session.host,
    title: session.title,
    model: session.model,
    createdAt: session.createdAt,
    moments,
    pairwiseTasks: buildPairwiseTasks(session.id, moments, maxPairwiseTasks),
  };
}

export function buildEvaluationDataset(
  sessions: IngestedSession[],
  options: BuildEvaluationCaseOptions = {},
): SessionEvaluationCase[] {
  return sessions.map((session) => buildSessionEvaluationCase(session, options));
}

export function summarizePairwisePreferences(
  tasks: PairwisePreferenceTask[],
  votes: PairwisePreferenceVote[],
): PairwisePreferenceSummary {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const latest = new Map<string, PairwisePreferenceVote>();
  const unknown = new Set<string>();

  for (const vote of votes) {
    if (!byId.has(vote.taskId)) {
      unknown.add(vote.taskId);
      continue;
    }
    latest.set(vote.taskId, vote);
  }

  let decisive = 0;
  let ties = 0;
  let skipped = 0;
  let languageCoverageSkipped = 0;
  let correct = 0;

  for (const vote of latest.values()) {
    const task = byId.get(vote.taskId);
    if (!task) continue;
    if (vote.winner === "skip") {
      skipped += 1;
      if (vote.reason === "language-coverage") languageCoverageSkipped += 1;
      continue;
    }
    if (vote.winner === "tie") {
      ties += 1;
      continue;
    }
    decisive += 1;
    const humanWinnerId = vote.winner === "left" ? task.left.id : task.right.id;
    if (humanWinnerId === task.predictedWinnerId) correct += 1;
  }

  return {
    answered: latest.size,
    decisive,
    ties,
    skipped,
    languageCoverageSkipped,
    correct,
    accuracy: decisive === 0 ? 0 : Number((correct / decisive).toFixed(4)),
    unknownTaskIds: [...unknown].sort(),
  };
}

interface KindAccumulator {
  votes: number;
  decisive: number;
  skipped: number;
  kept: number;
  funTotal: number;
  funCount: number;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export function buildCalibrationReport(
  dataset: SessionEvaluationCase[],
  reviews: SessionHumanReview[],
): CalibrationReport {
  const cases = new Map(dataset.map((entry) => [entry.sessionId, entry]));
  const latestReviews = new Map<string, SessionHumanReview>();
  for (const review of reviews) {
    if (cases.has(review.sessionId)) latestReviews.set(review.sessionId, review);
  }

  const allTasks = dataset.flatMap((entry) => entry.pairwiseTasks);
  const pairwiseVotes = [...latestReviews.values()].flatMap((review) => review.pairwiseVotes ?? []);
  const pairwise = summarizePairwisePreferences(allTasks, pairwiseVotes);

  let awardVotes = 0;
  let awardDecisiveVotes = 0;
  let awardSkipped = 0;
  let kept = 0;
  let missedMoments = 0;
  const funRatings: number[] = [];
  const byKind = new Map<AwardKind, KindAccumulator>();

  for (const review of latestReviews.values()) {
    const evaluationCase = cases.get(review.sessionId);
    if (!evaluationCase) continue;
    missedMoments += review.missedMoments?.length ?? 0;
    const awardsById = new Map(
      evaluationCase.moments
        .filter((moment) => moment.awardId && moment.awardKind)
        .map((moment) => [moment.awardId as string, moment]),
    );
    const latestAwardVotes = new Map<string, AwardPreferenceVote>();
    for (const vote of review.awardVotes ?? []) {
      if (awardsById.has(vote.awardId)) latestAwardVotes.set(vote.awardId, vote);
    }

    for (const vote of latestAwardVotes.values()) {
      const moment = awardsById.get(vote.awardId);
      if (!moment?.awardKind) continue;
      awardVotes += 1;

      const accumulator = byKind.get(moment.awardKind) ?? {
        votes: 0,
        decisive: 0,
        skipped: 0,
        kept: 0,
        funTotal: 0,
        funCount: 0,
      };
      accumulator.votes += 1;

      if (vote.verdict === "skip") {
        awardSkipped += 1;
        accumulator.skipped += 1;
        byKind.set(moment.awardKind, accumulator);
        continue;
      }

      awardDecisiveVotes += 1;
      accumulator.decisive += 1;
      if (vote.verdict === "keep") {
        kept += 1;
        accumulator.kept += 1;
      }
      if (vote.fun !== undefined) {
        funRatings.push(vote.fun);
        accumulator.funTotal += vote.fun;
        accumulator.funCount += 1;
      }
      byKind.set(moment.awardKind, accumulator);
    }
  }

  const byAwardKind: AwardKindCalibration[] = [...byKind.entries()]
    .map(([kind, stats]) => ({
      kind,
      votes: stats.votes,
      decisive: stats.decisive,
      skipped: stats.skipped,
      kept: stats.kept,
      keepRate: stats.decisive === 0 ? 0 : Number((stats.kept / stats.decisive).toFixed(4)),
      averageFun:
        stats.funCount === 0 ? undefined : Number((stats.funTotal / stats.funCount).toFixed(2)),
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));

  return {
    sessionsInDataset: dataset.length,
    sessionsReviewed: latestReviews.size,
    awardVotes,
    awardDecisiveVotes,
    awardSkipped,
    awardKeepRate:
      awardDecisiveVotes === 0 ? 0 : Number((kept / awardDecisiveVotes).toFixed(4)),
    averageAwardFun: average(funRatings),
    pairwise,
    missedMoments,
    byAwardKind,
    reviewCoverage:
      dataset.length === 0 ? 0 : Number((latestReviews.size / dataset.length).toFixed(4)),
  };
}
