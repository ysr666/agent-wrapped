import type { SemanticStoryPersonaReport } from "./types.js";

export function renderSemanticStoryPersonaText(report: SemanticStoryPersonaReport): string {
  const zh = report.locale === "zh-CN";
  const lines: string[] = [];

  if (report.story) {
    lines.push(zh ? `🎬 本场剧情：${report.story.title}` : `🎬 Session story: ${report.story.title}`);
    lines.push(report.story.synopsis);
    lines.push("");
    report.story.beats.forEach((beat, index) => {
      lines.push(`${index + 1}. ${beat.title}`);
      lines.push(`   ${beat.summary}`);
    });
    if (report.story.commentary) {
      lines.push("");
      lines.push(zh ? `🎙️ 赛后解说：${report.story.commentary}` : `🎙️ Post-game commentary: ${report.story.commentary}`);
    }
  }

  if (report.persona) {
    if (lines.length > 0) lines.push("");
    lines.push(zh ? `🎭 本场角色：${report.persona.label}` : `🎭 Session character: ${report.persona.label}`);
    lines.push(report.persona.tagline);
    for (const dimension of report.persona.dimensions) {
      lines.push(`  · ${dimension.label}: ${dimension.score}/100 — ${dimension.rationale}`);
    }
  }

  if (report.insufficientEvidence) {
    if (lines.length > 0) lines.push("");
    lines.push(zh ? `证据不足：${report.insufficientEvidence}` : `Insufficient evidence: ${report.insufficientEvidence}`);
  }

  return lines.join("\n");
}
