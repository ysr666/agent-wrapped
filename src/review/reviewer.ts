import type {
  AwardPreferenceVote,
  EvaluationMomentSnapshot,
  PairwisePreferenceVote,
  SessionEvaluationCase,
  SessionHumanReview,
} from "../evaluation/types.js";
import {
  localizeAgentPhrase,
  type PresentationLocale,
} from "../presentation/localization.js";
import { presentRepeatedPattern } from "../presentation/repeatedPattern.js";
import type { ReviewIO, ReviewSessionOptions, ReviewSessionResult } from "./types.js";

const AWARD_LABELS: Record<string, string> = {
  quote: "🏆 本场金句",
  catchphrase: "📢 高频口癖",
  boomerang: "🤡 最大回旋镖",
  "wolf-cry": "🐺 狼来了奖",
  "premature-celebration": "🍾 香槟开早了",
  "plot-twist": "🧠 剧情急转弯",
  "emotional-peak": "💀 精神状态",
};

function cloneReview(existing: SessionHumanReview | undefined, sessionId: string): SessionHumanReview {
  return {
    sessionId,
    awardVotes: [...(existing?.awardVotes ?? [])],
    pairwiseVotes: [...(existing?.pairwiseVotes ?? [])],
    missedMoments: [...(existing?.missedMoments ?? [])],
  };
}

function latestAwardVotes(review: SessionHumanReview): Map<string, AwardPreferenceVote> {
  return new Map((review.awardVotes ?? []).map((vote) => [vote.awardId, vote]));
}

function latestPairwiseVotes(review: SessionHumanReview): Map<string, PairwisePreferenceVote> {
  return new Map((review.pairwiseVotes ?? []).map((vote) => [vote.taskId, vote]));
}

function upsertAwardVote(review: SessionHumanReview, vote: AwardPreferenceVote): void {
  const votes = review.awardVotes ?? [];
  const index = votes.findIndex((entry) => entry.awardId === vote.awardId);
  if (index >= 0) votes[index] = vote;
  else votes.push(vote);
  review.awardVotes = votes;
}

function upsertPairwiseVote(review: SessionHumanReview, vote: PairwisePreferenceVote): void {
  const votes = review.pairwiseVotes ?? [];
  const index = votes.findIndex((entry) => entry.taskId === vote.taskId);
  if (index >= 0) votes[index] = vote;
  else votes.push(vote);
  review.pairwiseVotes = votes;
}

function displaySourceLine(text: string, locale: PresentationLocale): string {
  const hint = localizeAgentPhrase(text, locale);
  return hint
    ? `  “${text}”\n    ↳ 中文提示：${hint}`
    : `  “${text}”`;
}

function displayMoment(moment: EvaluationMomentSnapshot, locale: PresentationLocale): string {
  if (moment.type === "repeated_pattern") {
    const presentation = presentRepeatedPattern(moment, 3, locale);
    const examples = presentation.examples.filter(
      (text) => text.trim().toLocaleLowerCase() !== presentation.label.trim().toLocaleLowerCase(),
    );
    const lines = presentation.localizedLabel
      ? [
          `  中文口癖：${presentation.localizedLabel} × ${presentation.count}`,
          ...(presentation.localizedSummary ? [`  ${presentation.localizedSummary}`] : []),
          `  原文关键词：“${presentation.label}”`,
        ]
      : [`  “${presentation.label}” × ${presentation.count}`];
    if (examples.length > 0) {
      lines.push(
        presentation.localizedLabel ? "  原文例：" : "  例：",
        ...examples.map((text) => `    · “${text}”`),
      );
    }
    return lines.join("\n");
  }

  return [moment.primaryText, ...moment.relatedTexts]
    .map((text) => displaySourceLine(text, locale))
    .join("\n    ↓\n");
}

async function checkpoint(review: SessionHumanReview, options: ReviewSessionOptions): Promise<void> {
  await options.onCheckpoint?.(review);
}

async function askAwardVote(
  io: ReviewIO,
  awardId: string,
): Promise<{ vote?: AwardPreferenceVote; quit: boolean }> {
  for (;;) {
    const answer = (await io.ask("保留这张卡？ [k]eep / [d]rop / [q]uit: ")).trim().toLowerCase();
    if (answer === "q" || answer === "quit") return { quit: true };
    if (!["k", "keep", "d", "drop"].includes(answer)) continue;
    const verdict = answer.startsWith("k") ? "keep" : "drop";

    for (;;) {
      const fun = (await io.ask("好玩度 1–5（直接回车=不评分）: ")).trim();
      if (!fun) return { vote: { awardId, verdict }, quit: false };
      const numeric = Number(fun);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) {
        return {
          vote: { awardId, verdict, fun: numeric as 1 | 2 | 3 | 4 | 5 },
          quit: false,
        };
      }
    }
  }
}

async function askPairwiseVote(
  io: ReviewIO,
  taskId: string,
): Promise<{ vote?: PairwisePreferenceVote; quit: boolean }> {
  for (;;) {
    const answer = (await io.ask("哪个更值得进 Wrapped？ [1]A / [2]B / [t]ie / [s]kip / [q]uit: "))
      .trim()
      .toLowerCase();
    if (answer === "q" || answer === "quit") return { quit: true };
    if (answer === "1" || answer === "a") return { vote: { taskId, winner: "left" }, quit: false };
    if (answer === "2" || answer === "b") return { vote: { taskId, winner: "right" }, quit: false };
    if (answer === "t" || answer === "tie") return { vote: { taskId, winner: "tie" }, quit: false };
    if (answer === "s" || answer === "skip") return { vote: { taskId, winner: "skip" }, quit: false };
  }
}

async function collectMissedMoments(
  io: ReviewIO,
  review: SessionHumanReview,
  options: ReviewSessionOptions,
): Promise<boolean> {
  for (;;) {
    const answer = (await io.ask("有系统漏掉的名场面吗？ [y]es / [n]o / [q]uit: ")).trim().toLowerCase();
    if (answer === "q" || answer === "quit") return true;
    if (answer === "n" || answer === "no" || answer === "") return false;
    if (answer !== "y" && answer !== "yes") continue;

    const text = (await io.ask("漏掉的原话: ")).trim();
    if (!text) continue;
    const relatedText = (await io.ask("相关前/后一句（可空）: ")).trim();
    const note = (await io.ask("备注（可空）: ")).trim();
    const missed = review.missedMoments ?? [];
    missed.push({
      text,
      ...(relatedText ? { relatedText } : {}),
      ...(note ? { note } : {}),
    });
    review.missedMoments = missed;
    await checkpoint(review, options);
  }
}

/**
 * Review one P6 evaluation case without exposing machine ranking scores during
 * human choices. Existing answers are skipped, which makes the flow resumable.
 * Chinese review is the default; common English agent-speak gets a local
 * semantic hint while source wording remains visible as evidence.
 */
export async function reviewEvaluationCase(
  evaluationCase: SessionEvaluationCase,
  existing: SessionHumanReview | undefined,
  io: ReviewIO,
  options: ReviewSessionOptions = {},
): Promise<ReviewSessionResult> {
  const review = cloneReview(existing, evaluationCase.sessionId);
  const locale = options.locale ?? "zh-CN";
  io.write(`\n=== ${evaluationCase.title ?? evaluationCase.sessionId} ===`);
  if (evaluationCase.model) io.write(`模型: ${evaluationCase.model}`);

  const seenAwardVotes = latestAwardVotes(review);
  const selectedMoments = evaluationCase.moments.filter((moment) => moment.selected && moment.awardId);
  for (const moment of selectedMoments) {
    if (!moment.awardId || seenAwardVotes.has(moment.awardId)) continue;
    io.write(`\n${AWARD_LABELS[moment.awardKind ?? ""] ?? moment.awardKind ?? "Award"}`);
    io.write(displayMoment(moment, locale));
    const answer = await askAwardVote(io, moment.awardId);
    if (answer.quit) return { review, completed: false, quitRequested: true };
    if (!answer.vote) continue;
    upsertAwardVote(review, answer.vote);
    seenAwardVotes.set(answer.vote.awardId, answer.vote);
    await checkpoint(review, options);
  }

  const seenPairs = latestPairwiseVotes(review);
  for (const task of evaluationCase.pairwiseTasks) {
    if (seenPairs.has(task.id)) continue;
    io.write("\nA:");
    io.write(displayMoment(task.left, locale));
    io.write("\nB:");
    io.write(displayMoment(task.right, locale));
    const answer = await askPairwiseVote(io, task.id);
    if (answer.quit) return { review, completed: false, quitRequested: true };
    if (!answer.vote) continue;
    upsertPairwiseVote(review, answer.vote);
    seenPairs.set(answer.vote.taskId, answer.vote);
    await checkpoint(review, options);
  }

  const quitDuringMissed = await collectMissedMoments(io, review, options);
  if (quitDuringMissed) return { review, completed: false, quitRequested: true };
  await checkpoint(review, options);
  return { review, completed: true, quitRequested: false };
}
