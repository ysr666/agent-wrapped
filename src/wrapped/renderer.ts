import type { Award } from "../awards/types.js";
import type { WrappedRenderOptions, WrappedReport } from "./types.js";

function quoteMarkdown(text: string): string {
  return text
    .split(/\r?\n/u)
    .map((line) => `> ${line}`)
    .join("\n");
}

function chronologicalTexts(award: Award): string[] {
  if (award.sourceType === "correction_arc") {
    const before = award.relatedTexts[0];
    const after = award.relatedTexts[1];
    return [before, award.primaryText, after].filter((text): text is string => Boolean(text));
  }

  if (award.sourceType === "plot_twist" && award.relatedTexts.length > 0) {
    return [award.relatedTexts[0], award.primaryText];
  }

  return [award.primaryText, ...award.relatedTexts];
}

function markdownAwardBody(award: Award): string {
  const texts = chronologicalTexts(award);
  if (texts.length === 0) return "";

  const quoted = texts.map((text) => quoteMarkdown(text));
  const body = quoted.join("\n>\n> →\n>\n");
  const count = award.count && award.count > 1 ? `\n\n**× ${award.count}**` : "";
  return `${body}${count}`;
}

function plainAwardBody(award: Award): string {
  const texts = chronologicalTexts(award);
  const body = texts.map((text) => `“${text}”`).join("\n  →\n");
  const count = award.count && award.count > 1 ? ` × ${award.count}` : "";
  return `${body}${count}`;
}

function scoreLine(report: WrappedReport, award: Award): string {
  return report.locale === "en"
    ? `fun ${award.funScore} · confidence ${award.confidence}`
    : `好玩度 ${award.funScore} · 置信度 ${award.confidence}`;
}

function metricsLine(report: WrappedReport): string {
  const metrics = report.metrics;
  return report.locale === "en"
    ? `${metrics.assistantMessages} assistant messages · ${metrics.momentCandidates} moment candidates · ${metrics.awards} awards`
    : `${metrics.assistantMessages} 条 assistant 消息 · ${metrics.momentCandidates} 个 Moment 候选 · ${metrics.awards} 个奖项`;
}

/** Render a share-friendly Markdown recap without exposing internal diagnostics. */
export function renderWrappedMarkdown(
  report: WrappedReport,
  options: WrappedRenderOptions = {},
): string {
  const includeScores = options.includeScores ?? false;
  const includeMetrics = options.includeMetrics ?? true;
  const sections: string[] = [`# 🎬 ${report.title}`];

  if (report.awards.length === 0) {
    sections.push(
      report.locale === "en"
        ? "No moment was strong enough to make the highlight reel this time."
        : "这场暂时没有强到值得上榜的名场面。",
    );
  } else {
    for (const award of report.awards) {
      const section = [`## ${award.emoji} ${award.title}`, markdownAwardBody(award)];
      if (includeScores) section.push(`_${scoreLine(report, award)}_`);
      sections.push(section.filter(Boolean).join("\n\n"));
    }
  }

  if (includeMetrics) {
    sections.push(`---\n${metricsLine(report)}`);
  }

  return `${sections.join("\n\n")}\n`;
}

/** Render the same P4 report as compact terminal/plain-text output. */
export function renderWrappedText(
  report: WrappedReport,
  options: WrappedRenderOptions = {},
): string {
  const includeScores = options.includeScores ?? false;
  const includeMetrics = options.includeMetrics ?? true;
  const lines: string[] = [`🎬 ${report.title}`];

  if (report.awards.length === 0) {
    lines.push(
      "",
      report.locale === "en"
        ? "No moment was strong enough to make the highlight reel this time."
        : "这场暂时没有强到值得上榜的名场面。",
    );
  } else {
    for (const award of report.awards) {
      lines.push("", `${award.emoji} ${award.title}`, plainAwardBody(award));
      if (includeScores) lines.push(scoreLine(report, award));
    }
  }

  if (includeMetrics) lines.push("", metricsLine(report));
  return `${lines.join("\n")}\n`;
}
