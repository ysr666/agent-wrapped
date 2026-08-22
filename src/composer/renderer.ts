import { renderAwardPlainBody } from "../wrapped/renderer.js";
import type { SemanticEvidenceBundle, StoryBeatKind } from "../semantic/types.js";
import type {
  ComposedStoryCard,
  ComposedWrappedRenderOptions,
  ComposedWrappedReport,
} from "./types.js";

const ZH_BEATS: Record<StoryBeatKind, string> = {
  setup: "铺垫",
  claim: "下结论",
  attempt: "开始尝试",
  failure: "失败",
  block: "被拦住",
  user_pushback: "用户打脸",
  work_reopened: "工作又来了",
  capability_gap: "能力缺口",
  breakdown: "当场破防",
  correction: "改口纠正",
  workaround: "换路继续",
  recovery: "恢复干活",
  success: "可观察动作成功",
  reversal: "反转",
};

const EN_BEATS: Record<StoryBeatKind, string> = {
  setup: "Setup",
  claim: "Claim",
  attempt: "Attempt",
  failure: "Failure",
  block: "Blocked",
  user_pushback: "User pushback",
  work_reopened: "Work reopened",
  capability_gap: "Capability gap",
  breakdown: "Breakdown",
  correction: "Correction",
  workaround: "Workaround",
  recovery: "Recovery",
  success: "Observable action succeeded",
  reversal: "Reversal",
};

function plainNarrativeText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/\[([^\]]+)\]\([^\s)]+\)/gu, "$1")
    .replace(/(?:\*\*|__)(.+?)(?:\*\*|__)/gu, "$1")
    .replace(/^\s*#{1,6}\s+/gmu, "")
    .replace(/^\s*[-*+]\s+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function clip(text: string, max: number): string {
  const normalized = plainNarrativeText(text);
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function narrativeExcerptLimit(
  beatKind: StoryBeatKind,
  actor: SemanticEvidenceBundle["events"][number]["actor"],
): number {
  if (actor === "user") return 96;
  if (beatKind === "user_pushback" || beatKind === "work_reopened") return 96;
  if (beatKind === "breakdown" || beatKind === "correction" || beatKind === "reversal") return 88;
  if (beatKind === "failure" || beatKind === "block" || beatKind === "capability_gap") return 84;
  if (beatKind === "workaround" || beatKind === "recovery") return 80;
  return 72;
}

function safeEventExcerpt(
  event: SemanticEvidenceBundle["events"][number],
  beatKind: StoryBeatKind,
): string | undefined {
  if (event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "tool_error") {
    if (!event.toolName) return undefined;
    const details = [
      event.toolCategory,
      event.outcome,
      event.exitCode === undefined ? undefined : `exit ${event.exitCode}`,
    ].filter((value): value is string => value !== undefined);
    return `${event.toolName}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
  }
  return event.text ? clip(event.text, narrativeExcerptLimit(beatKind, event.actor)) : undefined;
}

function storyLines(
  card: ComposedStoryCard,
  evidence: SemanticEvidenceBundle | undefined,
  zh: boolean,
): string[] {
  const lines = [`🎬 ${zh ? `本场剧情：${card.title}` : `Session story: ${card.title}`}`];
  const eventById = new Map((evidence?.events ?? []).map((event) => [event.id, event]));
  for (const [storyIndex, story] of card.stories.entries()) {
    if (card.episodeCount > 1) {
      lines.push(zh ? `  第 ${storyIndex + 1} 幕` : `  Episode ${storyIndex + 1}`);
    }
    for (const beat of story.beats) {
      const label = zh ? ZH_BEATS[beat.kind] : EN_BEATS[beat.kind];
      const excerpts = beat.evidenceIds
        .map((id) => eventById.get(id))
        .filter((event): event is SemanticEvidenceBundle["events"][number] => !!event)
        .map((event) => safeEventExcerpt(event, beat.kind))
        .filter((text): text is string => !!text);
      lines.push(`  ${card.episodeCount > 1 ? "  " : ""}→ ${label}${excerpts.length > 0 ? ` — ${excerpts.join(" / ")}` : ""}`);
    }
  }
  if (card.commentary) lines.push(zh ? `🎙️ 赛后解说：${card.commentary}` : `🎙️ Post-game commentary: ${card.commentary}`);
  return lines;
}

function scoreLine(report: ComposedWrappedReport, score: number, confidence: number): string {
  return report.locale === "zh-CN"
    ? `好玩度 ${score} · 置信度 ${confidence}`
    : `fun ${score} · confidence ${confidence}`;
}

/** Render only the final selected cards; diagnostics and rejected candidates stay out of the show. */
export function renderComposedWrappedText(
  report: ComposedWrappedReport,
  evidence?: SemanticEvidenceBundle,
  options: ComposedWrappedRenderOptions = {},
): string {
  const zh = report.locale === "zh-CN";
  const lines = [zh ? "🎬 本场 Agent Wrapped" : "🎬 This Session's Agent Wrapped"];
  if (report.cards.length === 0) {
    lines.push("", zh
      ? "这场暂时没有强到值得上榜的名场面。"
      : "No moment was strong enough to make the highlight reel this time.");
    return `${lines.join("\n")}\n`;
  }

  for (const card of report.cards) {
    lines.push("");
    if (card.type === "award") {
      lines.push(card.title, renderAwardPlainBody(card.award, report.locale));
    } else if (card.type === "story") {
      lines.push(...storyLines(card, evidence, zh));
    } else {
      lines.push(card.title, card.tagline);
    }
    if (options.includeScores) lines.push(scoreLine(report, card.score, card.confidence));
  }
  return `${lines.join("\n")}\n`;
}
