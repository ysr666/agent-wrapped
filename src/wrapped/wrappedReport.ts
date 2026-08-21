import type { TranscriptMessage } from "../core/types.js";
import { buildMomentGraph } from "../graph/momentGraph.js";
import { buildMoments } from "../moments/momentBuilder.js";
import { rankMoments } from "../moments/momentRanker.js";
import { composeAwards } from "../awards/awardComposer.js";
import type { CreateWrappedReportOptions, WrappedReport } from "./types.js";

export type { CreateWrappedReportOptions } from "./types.js";

function defaultTitle(locale: WrappedReport["locale"]): string {
  return locale === "en" ? "Tonight's Agent Wrapped" : "今晚的 Agent Wrapped";
}

/**
 * P4 end-to-end product API.
 *
 * It keeps the analysis pipeline layered internally, then returns a compact
 * share-oriented report. Ranked P3 candidates are only included when explicitly
 * requested for debugging or human preference evaluation.
 */
export function createWrappedReport(
  messages: TranscriptMessage[],
  options: CreateWrappedReportOptions = {},
): WrappedReport {
  const locale = options.locale ?? options.awards?.locale ?? "zh-CN";
  const currentMessages = messages.filter((message) => message.metadata?.inheritedContext !== true);
  const graph = buildMomentGraph(currentMessages, options.graph);
  const moments = buildMoments(graph, options.builder);
  const ranked = rankMoments(graph, moments, options.ranker);
  const composition = composeAwards(ranked, {
    ...options.awards,
    locale,
  });

  const report: WrappedReport = {
    version: 1,
    locale,
    title: options.title?.trim() || defaultTitle(locale),
    awards: composition.awards,
    metrics: {
      messages: currentMessages.length,
      assistantMessages: currentMessages.filter((message) => message.role === "assistant").length,
      events: graph.events.length,
      relations: graph.relations.length,
      momentCandidates: moments.length,
      rankedMoments: ranked.length,
      awards: composition.awards.length,
      topFunScore: ranked[0]?.scores.funScore ?? 0,
    },
    diagnostics: {
      rejectedAwards: composition.rejected,
    },
  };

  if (options.includeRankedMoments) {
    report.rankedMoments = ranked;
  }

  return report;
}
