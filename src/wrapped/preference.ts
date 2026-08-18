import type {
  WrappedPreferenceSummary,
  WrappedPreferenceVote,
  WrappedReport,
} from "./types.js";

/**
 * Summarize lightweight human preference votes for a generated Wrapped report.
 *
 * P4 intentionally keeps this local and data-format-only: UI layers can collect
 * thumbs-up/down or 1-5 fun ratings without changing the analysis engine.
 */
export function summarizeWrappedPreferences(
  report: WrappedReport,
  votes: WrappedPreferenceVote[],
): WrappedPreferenceSummary {
  const validAwardIds = new Set(report.awards.map((award) => award.id));
  const latestByAward = new Map<string, WrappedPreferenceVote>();

  for (const vote of votes) {
    if (!validAwardIds.has(vote.awardId)) continue;
    latestByAward.set(vote.awardId, vote);
  }

  const accepted = [...latestByAward.values()];
  const kept = accepted.filter((vote) => vote.verdict === "keep").length;
  const dropped = accepted.length - kept;
  const funRatings = accepted
    .map((vote) => vote.fun)
    .filter((value): value is 1 | 2 | 3 | 4 | 5 => value !== undefined);
  const averageFun =
    funRatings.length > 0
      ? Number((funRatings.reduce((sum, value) => sum + value, 0) / funRatings.length).toFixed(2))
      : undefined;

  const summary: WrappedPreferenceSummary = {
    voted: accepted.length,
    kept,
    dropped,
    keepRate: accepted.length === 0 ? 0 : Number((kept / accepted.length).toFixed(4)),
    missingAwardIds: report.awards
      .map((award) => award.id)
      .filter((awardId) => !latestByAward.has(awardId)),
  };

  if (averageFun !== undefined) summary.averageFun = averageFun;
  return summary;
}
