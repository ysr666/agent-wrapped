import type {
  AwardPreferenceVote,
  EvaluationMomentSnapshot,
  PairwisePreferenceVote,
  SessionEvaluationCase,
  SessionHumanReview,
} from "../evaluation/types.js";
import {
  assessTextLocalization,
  localizeMomentStructure,
  type PresentationLocale,
} from "../presentation/localization.js";
import { presentRepeatedPattern } from "../presentation/repeatedPattern.js";
import { createReviewMetadata, isReviewProtocolCompatible } from "./protocol.js";
import type { ReviewIO, ReviewSessionOptions, ReviewSessionResult } from "./types.js";

const AWARD_LABELS_ZH: Record<string, string> = {
  quote: "🏆 本场金句",
  catchphrase: "📢 高频口癖",
  boomerang: "🤡 最大回旋镖",
  "wolf-cry": "🐺 狼来了奖",
  "premature-celebration": "🍾 香槟开早了",
  "plot-twist": "🧠 剧情急转弯",
  "emotional-peak": "💀 精神状态",
};

const AWARD_LABELS_EN: Record<string, string> = {
  quote: "🏆 Quote of the session",
  catchphrase: "📢 Catchphrase",
  boomerang: "🤡 Biggest boomerang",
  "wolf-cry": "🐺 Called it too early",
  "premature-celebration": "🍾 Premature celebration",
  "plot-twist": "🧠 Plot twist",
  "emotional-peak": "💀 Emotional peak",
};

interface DisplayedMoment {
  text: string;
  /** Safe to use as a Chinese preference judgment without known language bias. */
  reviewSafe: boolean;
}

function awardLabel(kind: string | undefined, locale: PresentationLocale): string {
  const labels = locale === "en" ? AWARD_LABELS_EN : AWARD_LABELS_ZH;
  return labels[kind ?? ""] ?? kind ?? "Award";
}

function cloneReview(
  existing: SessionHumanReview | undefined,
  sessionId: string,
  locale: PresentationLocale,
): SessionHumanReview {
  if (!isReviewProtocolCompatible(existing, locale)) {
    return {
      sessionId,
      ...createReviewMetadata(locale),
      awardVotes: [],
      pairwiseVotes: [],
      missedMoments: [],
    };
  }
  return {
    sessionId,
    protocolVersion: existing.protocolVersion,
    presentationLocale: existing.presentationLocale,
    awardVotes: [...(existing.awardVotes ?? [])],
    pairwiseVotes: [...(existing.pairwiseVotes ?? [])],
    missedMoments: [...(existing.missedMoments ?? [])],
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

function displaySourceLines(texts: string[], locale: PresentationLocale): DisplayedMoment {
  const assessment = assessTextLocalization(texts, locale);
  const rendered = assessment.lines.map((line) => {
    if (line.hint) return `  “${line.text}”\n    ↳ 中文提示：${line.hint}`;
    return `  “${line.text}”`;
  });
  return {
    text: rendered.join("\n    ↓\n"),
    reviewSafe: assessment.reviewSafe,
  };
}

function displayMoment(moment: EvaluationMomentSnapshot, locale: PresentationLocale): DisplayedMoment {
  if (moment.type === "repeated_pattern") {
    const presentation = presentRepeatedPattern(moment, 3, locale);
    const examples = presentation.examples.filter(
      (text) => text.trim().toLocaleLowerCase() !== presentation.label.trim().toLocaleLowerCase(),
    );
    const assessment = assessTextLocalization([presentation.label, ...examples], locale);
    const reviewSafe = Boolean(presentation.localizedLabel) || assessment.reviewSafe;
    const lines = presentation.localizedLabel
      ? [
          `  中文口癖：${presentation.localizedLabel} × ${presentation.count}`,
          ...(presentation.localizedSummary ? [`  ${presentation.localizedSummary}`] : []),
          `  原文关键词：“${presentation.label}”`,
        ]
      : [`  “${presentation.label}” × ${presentation.count}`];
    if (examples.length > 0) {
      lines.push(
        presentation.localizedLabel ? "  原文例：" : locale === "en" ? "  Examples:" : "  例：",
        ...examples.map((text) => `    · “${text}”`),
      );
    }
    if (!reviewSafe && locale === "zh-CN") {
      lines.push("  ⚠ 当前没有足够可靠的中文释义；建议跳过，避免把英语阅读负担算成‘不好玩’。");
    }
    return { text: lines.join("\n"), reviewSafe };
  }

  const sourceTexts = [moment.primaryText, ...moment.relatedTexts];
  const displayed = displaySourceLines(sourceTexts, locale);
  const structureHint = localizeMomentStructure(moment.type, locale);
  const lines = [displayed.text];
  if (structureHint) lines.push(`  ${structureHint}`);
  if (!displayed.reviewSafe && locale === "zh-CN") {
    lines.push("  ⚠ 这段仍有未中文化的英文信息；建议跳过，避免语言偏差污染评分。");
  }
  return { text: lines.join("\n"), reviewSafe: displayed.reviewSafe };
}

async function checkpoint(review: SessionHumanReview, options: ReviewSessionOptions): Promise<void> {
  await options.onCheckpoint?.(review);
}

async function askAwardVote(
  io: ReviewIO,
  awardId: string,
  locale: PresentationLocale,
  preferSkip: boolean,
): Promise<{ vote?: AwardPreferenceVote; quit: boolean }> {
  for (;;) {
    const prompt = locale === "en"
      ? "Keep this card? [k]eep / [d]rop / [s]kip / [q]uit: "
      : preferSkip
        ? "保留这张卡？ [k]eep / [d]rop / [s]kip / [q]uit（建议 s，回车也会跳过）: "
        : "保留这张卡？ [k]eep / [d]rop / [s]kip / [q]uit: ";
    const answer = (await io.ask(prompt)).trim().toLowerCase();
    if (answer === "q" || answer === "quit") return { quit: true };
    if ((answer === "" && preferSkip) || answer === "s" || answer === "skip") {
      return { vote: { awardId, verdict: "skip" }, quit: false };
    }
    if (!["k", "keep", "d", "drop"].includes(answer)) continue;
    const verdict = answer.startsWith("k") ? "keep" : "drop";

    for (;;) {
      const funPrompt = locale === "en"
        ? "Fun 1–5 (Enter = no rating): "
        : "好玩度 1–5（直接回车=不评分）: ";
      const fun = (await io.ask(funPrompt)).trim();
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
  locale: PresentationLocale,
): Promise<{ vote?: PairwisePreferenceVote; quit: boolean }> {
  for (;;) {
    const prompt = locale === "en"
      ? "Which belongs in Wrapped? [1]A / [2]B / [t]ie / [s]kip / [q]uit: "
      : "哪个更值得进 Wrapped？ [1]A / [2]B / [t]ie / [s]kip / [q]uit: ";
    const answer = (await io.ask(prompt)).trim().toLowerCase();
    if (answer === "q" || answer === "quit") return { quit: true };
    if (answer === "1" || answer === "a") return { vote: { taskId, winner: "left" }, quit: false };
    if (answer === "2" || answer === "b") return { vote: { taskId, winner: "right" }, quit: false };
    if (answer === "t" || answer === "tie") return { vote: { taskId, winner: "tie" }, quit: false };
    if (answer === "s" || answer === "skip") {
      return { vote: { taskId, winner: "skip", reason: "human-skip" }, quit: false };
    }
  }
}

async function collectMissedMoments(
  io: ReviewIO,
  review: SessionHumanReview,
  options: ReviewSessionOptions,
  locale: PresentationLocale,
): Promise<boolean> {
  for (;;) {
    const prompt = locale === "en"
      ? "Any memorable moment the system missed? [y]es / [n]o / [q]uit: "
      : "有系统漏掉的名场面吗？ [y]es / [n]o / [q]uit: ";
    const answer = (await io.ask(prompt)).trim().toLowerCase();
    if (answer === "q" || answer === "quit") return true;
    if (answer === "n" || answer === "no" || answer === "") return false;
    if (answer !== "y" && answer !== "yes") continue;

    const text = (await io.ask(locale === "en" ? "Missed source quote: " : "漏掉的原话: ")).trim();
    if (!text) continue;
    const relatedText = (await io.ask(
      locale === "en" ? "Related before/after quote (optional): " : "相关前/后一句（可空）: ",
    )).trim();
    const note = (await io.ask(locale === "en" ? "Note (optional): " : "备注（可空）: ")).trim();
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
 * human choices. Existing answers are reused only when review protocol+locale
 * match. Chinese review adds semantic hints and automatically skips A/B tasks
 * with incomplete language coverage so language friction cannot masquerade as
 * ranking preference.
 */
export async function reviewEvaluationCase(
  evaluationCase: SessionEvaluationCase,
  existing: SessionHumanReview | undefined,
  io: ReviewIO,
  options: ReviewSessionOptions = {},
): Promise<ReviewSessionResult> {
  const locale = options.locale ?? "zh-CN";
  const review = cloneReview(existing, evaluationCase.sessionId, locale);
  io.write(`\n=== ${evaluationCase.title ?? evaluationCase.sessionId} ===`);
  if (evaluationCase.model) io.write(locale === "en" ? `Model: ${evaluationCase.model}` : `模型: ${evaluationCase.model}`);

  const seenAwardVotes = latestAwardVotes(review);
  const selectedMoments = evaluationCase.moments.filter((moment) => moment.selected && moment.awardId);
  for (const moment of selectedMoments) {
    if (!moment.awardId || seenAwardVotes.has(moment.awardId)) continue;
    io.write(`\n${awardLabel(moment.awardKind, locale)}`);
    const displayed = displayMoment(moment, locale);
    io.write(displayed.text);
    const answer = await askAwardVote(io, moment.awardId, locale, !displayed.reviewSafe);
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
    const left = displayMoment(task.left, locale);
    io.write(left.text);
    io.write("\nB:");
    const right = displayMoment(task.right, locale);
    io.write(right.text);

    if (locale === "zh-CN" && (!left.reviewSafe || !right.reviewSafe)) {
      const vote: PairwisePreferenceVote = {
        taskId: task.id,
        winner: "skip",
        reason: "language-coverage",
      };
      io.write("⚠ 这组 A/B 含未充分中文化的英文内容，已自动跳过，不计入 Pairwise accuracy。");
      upsertPairwiseVote(review, vote);
      seenPairs.set(vote.taskId, vote);
      await checkpoint(review, options);
      continue;
    }

    const answer = await askPairwiseVote(io, task.id, locale);
    if (answer.quit) return { review, completed: false, quitRequested: true };
    if (!answer.vote) continue;
    upsertPairwiseVote(review, answer.vote);
    seenPairs.set(answer.vote.taskId, answer.vote);
    await checkpoint(review, options);
  }

  const quitDuringMissed = await collectMissedMoments(io, review, options, locale);
  if (quitDuringMissed) return { review, completed: false, quitRequested: true };
  await checkpoint(review, options);
  return { review, completed: true, quitRequested: false };
}
