import type {
  SemanticEvidenceBundle,
  SemanticStoryPersonaReport,
  StoryBeatKind,
} from "./types.js";

const ZH_BEATS: Record<StoryBeatKind, string> = {
  setup: "铺垫",
  claim: "下结论",
  attempt: "开始尝试",
  failure: "失败",
  block: "被拦住",
  user_pushback: "用户打脸",
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
  capability_gap: "Capability gap",
  breakdown: "Breakdown",
  correction: "Correction",
  workaround: "Workaround",
  recovery: "Recovery",
  success: "Observable action succeeded",
  reversal: "Reversal",
};

function clip(text: string, max = 140): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function levelLabel(level: "low" | "medium" | "high", zh: boolean): string {
  if (zh) return level === "high" ? "高" : level === "medium" ? "中" : "低";
  return level;
}

function safeEventExcerpt(event: SemanticEvidenceBundle["events"][number]): string | undefined {
  if (event.text) return clip(event.text);
  if (!event.toolName) return undefined;
  const details = [event.toolCategory, event.outcome, event.exitCode === undefined ? undefined : `exit ${event.exitCode}`]
    .filter((value): value is string => value !== undefined);
  return `${event.toolName}${details.length > 0 ? ` (${details.join(", ")})` : ""}`;
}

export function renderSemanticStoryPersonaText(
  report: SemanticStoryPersonaReport,
  evidence?: SemanticEvidenceBundle,
): string {
  const zh = report.locale === "zh-CN";
  const lines: string[] = [];
  const eventById = new Map((evidence?.events ?? []).map((event) => [event.id, event]));
  const cardByStoryId = new Map((report.narration?.storyCards ?? []).map((card) => [card.storyId, card]));

  for (const story of report.stories) {
    const card = cardByStoryId.get(story.id);
    lines.push(zh
      ? `🎬 本场剧情：${card?.title ?? story.arcKind}`
      : `🎬 Session story: ${card?.title ?? story.arcKind}`);
    story.beats.forEach((beat, index) => {
      const label = zh ? ZH_BEATS[beat.kind] : EN_BEATS[beat.kind];
      const excerpts = beat.evidenceIds
        .map((id) => eventById.get(id))
        .filter((event): event is SemanticEvidenceBundle["events"][number] => !!event)
        .map(safeEventExcerpt)
        .filter((text): text is string => !!text);
      lines.push(`${index + 1}. ${label}${excerpts.length > 0 ? ` — ${excerpts.join(" / ")}` : ""}`);
    });
    if (card?.commentary) {
      lines.push("");
      lines.push(zh ? `🎙️ 赛后解说：${card.commentary}` : `🎙️ Post-game commentary: ${card.commentary}`);
    }
    lines.push("");
  }

  if (report.narration?.persona) {
    lines.push(zh ? `🎭 本场角色：${report.narration.persona.label}` : `🎭 Session character: ${report.narration.persona.label}`);
    lines.push(report.narration.persona.tagline);
  } else if (report.personaSignals.length > 0) {
    lines.push(zh ? "🎭 本场行为信号" : "🎭 Session behavior signals");
  }

  for (const signal of report.personaSignals) {
    lines.push(`  · ${signal.label}: ${levelLabel(signal.level, zh)} · ${signal.count}`);
  }

  if (report.insufficientEvidence) {
    if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
    lines.push(zh ? `证据不足：${report.insufficientEvidence}` : `Insufficient evidence: ${report.insufficientEvidence}`);
  }

  return lines.join("\n").trimEnd();
}
