#!/usr/bin/env node

import { stdin as processStdin, stdout as processStdout, stderr as processStderr } from "node:process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { PresentationLocale } from "./presentation/localization.js";
import { reviewEvaluationCase } from "./review/reviewer.js";
import {
  calibrateReviewWorkspace,
  findEvaluationCase,
  findSessionReview,
  nextIncompleteCase,
  refreshLocalDshReviewWorkspace,
  saveReviewCheckpoint,
} from "./review/runner.js";
import { CURRENT_REVIEW_PROTOCOL_VERSION, DEFAULT_REVIEW_LOCALE } from "./review/protocol.js";
import { computeReviewProgress, loadReviewWorkspace, resolveReviewWorkspacePath } from "./review/workspace.js";
import type { ReviewIO, ReviewWorkspaceProgress } from "./review/types.js";

interface ParsedArgs {
  command?: string;
  flags: Map<string, string | boolean>;
  positional: string[];
}

export interface CliTextOutput {
  write(text: string): void;
}

export interface RunCliOptions {
  stdout?: CliTextOutput;
  stderr?: CliTextOutput;
  reviewIO?: ReviewIO;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token?.startsWith("--")) {
      if (token) positional.push(token);
      continue;
    }

    const equal = token.indexOf("=");
    if (equal > 2) {
      flags.set(token.slice(2, equal), token.slice(equal + 1));
      continue;
    }

    const name = token.slice(2);
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(name, next);
      index += 1;
    } else {
      flags.set(name, true);
    }
  }

  return { command, flags, positional };
}

function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

function booleanFlag(args: ParsedArgs, name: string): boolean {
  return args.flags.get(name) === true;
}

function numberFlag(args: ParsedArgs, name: string, fallback: number): number {
  const value = stringFlag(args, name);
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }
  return numeric;
}

function parseLocale(value: string | undefined, fallback: PresentationLocale): PresentationLocale {
  const resolved = value ?? fallback;
  if (resolved === "zh-CN" || resolved === "en") return resolved;
  throw new Error("--locale must be zh-CN or en.");
}

function out(target: CliTextOutput, text = ""): void {
  target.write(`${text}\n`);
}

function helpText(): string {
  return `Agent Wrapped — local review runner

Usage:
  agent-wrapped dsh [--latest 30] [--root PATH] [--store PATH] [--locale zh-CN|en]
  agent-wrapped review [--store PATH] [--session ID] [--all] [--locale zh-CN|en]
  agent-wrapped calibration [--store PATH] [--json]
  agent-wrapped status [--store PATH] [--json]

P7 workflow:
  1. agent-wrapped dsh --latest 30
  2. agent-wrapped review
  3. agent-wrapped calibration

DSH options:
  --latest N        newest sessions to prepare (default 30)
  --root PATH       override DSH sessions root
  --top-moments N   P6 moments kept per session (default 8)
  --pairs N         pairwise review tasks per session (default 12)
  --reasoning       include reasoning blocks only if the host surface exposed them
  --locale LOCALE   bind a new workspace to zh-CN (default) or en;
                    existing workspace locale is preserved when omitted

Review options:
  --session ID      review one specific session
  --all             continue through all incomplete sessions
  --locale LOCALE   optional safety check; must match workspace locale
                    switch locale by re-running dsh --locale LOCALE, which invalidates old labels

Storage:
  --store PATH      review-workspace.json path
                    default: $AGENT_WRAPPED_HOME/review-workspace.json
                    fallback: ~/.agent-wrapped/review-workspace.json
`;
}

function progressObject(progress: ReviewWorkspaceProgress): Record<string, number> {
  return {
    sessions: progress.sessions,
    completedSessions: progress.completedSessions,
    remainingSessions: progress.remainingSessions,
    awardCards: progress.awardCards,
    awardVotes: progress.awardVotes,
    pairwiseTasks: progress.pairwiseTasks,
    pairwiseVotes: progress.pairwiseVotes,
    missedMoments: progress.missedMoments,
  };
}

function printProgress(stdout: CliTextOutput, progress: ReviewWorkspaceProgress): void {
  out(stdout, `会话：${progress.completedSessions}/${progress.sessions} 已完成，${progress.remainingSessions} 待评`);
  out(stdout, `奖项：${progress.awardVotes}/${progress.awardCards} 已评分/跳过`);
  out(stdout, `二选一：${progress.pairwiseVotes}/${progress.pairwiseTasks} 已回答/自动跳过`);
  out(stdout, `人工补录漏报：${progress.missedMoments}`);
}

async function makeTerminalReviewIO(): Promise<{ io: ReviewIO; close(): void }> {
  const rl = createInterface({ input: processStdin, output: processStdout });
  return {
    io: {
      write(text: string) {
        processStdout.write(`${text}\n`);
      },
      ask(prompt: string) {
        return rl.question(prompt);
      },
    },
    close() {
      rl.close();
    },
  };
}

async function commandDsh(args: ParsedArgs, stdout: CliTextOutput): Promise<number> {
  const latest = numberFlag(args, "latest", 30);
  const topMoments = numberFlag(args, "top-moments", 8);
  const pairs = numberFlag(args, "pairs", 12);
  const store = stringFlag(args, "store");
  const root = stringFlag(args, "root");
  const requestedReviewLocale = stringFlag(args, "locale");
  const reviewLocale = requestedReviewLocale === undefined
    ? undefined
    : parseLocale(requestedReviewLocale, DEFAULT_REVIEW_LOCALE);
  const refreshed = await refreshLocalDshReviewWorkspace({
    store,
    reviewLocale,
    ingest: {
      maxSessions: latest,
      root,
      includeVisibleReasoning: booleanFlag(args, "reasoning"),
    },
    evaluation: {
      topMoments,
      maxPairwiseTasks: pairs,
    },
  });

  out(stdout, `P7 workspace 已更新：${refreshed.path}`);
  out(stdout, `评测协议：v${refreshed.workspace.protocolVersion} · ${refreshed.workspace.presentationLocale}`);
  out(stdout, `当前 ${refreshed.workspace.cases.length} 场；新增 ${refreshed.addedSessions} 场；保留人工评测 ${refreshed.preservedReviews} 场。`);
  out(
    stdout,
    `解析：${refreshed.ingestion.sessionsWithAssistantMessages}/${refreshed.ingestion.discoveredSessions} 场含 assistant 文本，` +
      `共 ${refreshed.ingestion.assistantMessages} 条；${refreshed.ingestion.sessionsWithMoments} 场产生 Moment 候选。`,
  );
  if (refreshed.ingestion.ingestionWarnings > 0) {
    out(stdout, `P5 产生 ${refreshed.ingestion.ingestionWarnings} 条 ingestion warning。`);
  }
  if (refreshed.ingestion.assistantMessages > 0 && refreshed.ingestion.sessionsWithMoments === 0) {
    out(stdout, "警告：已经读到 assistant 文本，但整批没有任何 Moment 候选；请先排查 P0–P3，而不是开始人工评测。");
  }
  if (refreshed.invalidatedReviews > 0) {
    out(stdout, `有 ${refreshed.invalidatedReviews} 场因候选集/评测协议/展示语言变化而撤销旧评测，避免污染新结果。`);
  }
  printProgress(stdout, computeReviewProgress(refreshed.workspace));
  out(stdout, "下一步：agent-wrapped review");
  return 0;
}

async function commandStatus(args: ParsedArgs, stdout: CliTextOutput): Promise<number> {
  const store = stringFlag(args, "store");
  const workspace = await loadReviewWorkspace(store);
  const progress = computeReviewProgress(workspace);
  if (booleanFlag(args, "json")) {
    out(stdout, JSON.stringify({
      path: resolveReviewWorkspacePath(store),
      protocolVersion: workspace.protocolVersion,
      presentationLocale: workspace.presentationLocale,
      ...progressObject(progress),
    }, null, 2));
  } else {
    out(stdout, `Workspace: ${resolveReviewWorkspacePath(store)}`);
    out(stdout, `评测协议：v${workspace.protocolVersion} · ${workspace.presentationLocale}`);
    printProgress(stdout, progress);
  }
  return 0;
}

async function commandCalibration(args: ParsedArgs, stdout: CliTextOutput): Promise<number> {
  const store = stringFlag(args, "store");
  const workspace = await loadReviewWorkspace(store);
  const { report, progress } = calibrateReviewWorkspace(workspace);

  if (booleanFlag(args, "json")) {
    out(stdout, JSON.stringify({
      protocolVersion: workspace.protocolVersion,
      presentationLocale: workspace.presentationLocale,
      progress,
      calibration: report,
    }, null, 2));
    return 0;
  }

  out(stdout, "=== Agent Wrapped Calibration ===");
  out(stdout, `评测协议：v${workspace.protocolVersion} · ${workspace.presentationLocale}`);
  printProgress(stdout, progress);
  out(stdout);
  out(stdout, `评测覆盖率：${(report.reviewCoverage * 100).toFixed(1)}%`);
  out(
    stdout,
    `Award keep rate：${(report.awardKeepRate * 100).toFixed(1)}% ` +
      `(${report.awardDecisiveVotes} 个有效判断，${report.awardSkipped} 个 skip)`,
  );
  out(stdout, `Award 平均好玩度：${report.averageAwardFun ?? "暂无评分"}`);
  out(
    stdout,
    `Pairwise accuracy：${(report.pairwise.accuracy * 100).toFixed(1)}% ` +
      `(${report.pairwise.correct}/${report.pairwise.decisive}；skip ${report.pairwise.skipped}，` +
      `其中语言覆盖 ${report.pairwise.languageCoverageSkipped})`,
  );
  out(stdout, `人工发现漏报：${report.missedMoments}`);
  if (report.byAwardKind.length > 0) {
    out(stdout, "\n按奖项：");
    for (const kind of report.byAwardKind) {
      out(
        stdout,
        `  ${kind.kind}: keep ${(kind.keepRate * 100).toFixed(1)}% ` +
          `(${kind.kept}/${kind.decisive}, skip ${kind.skipped}), fun ${kind.averageFun ?? "-"}`,
      );
    }
  }
  return 0;
}

async function commandReview(
  args: ParsedArgs,
  stdout: CliTextOutput,
  injectedIO?: ReviewIO,
): Promise<number> {
  const store = stringFlag(args, "store");
  const workspace = await loadReviewWorkspace(store);
  const requestedLocale = stringFlag(args, "locale");
  const locale = parseLocale(requestedLocale, workspace.presentationLocale);
  if (locale !== workspace.presentationLocale) {
    throw new Error(
      `This workspace is bound to ${workspace.presentationLocale}. ` +
        `Run agent-wrapped dsh --latest ${workspace.source.maxSessions} --locale ${locale} to switch; ` +
        "existing human labels will be invalidated instead of mixed across languages.",
    );
  }
  if (workspace.protocolVersion !== CURRENT_REVIEW_PROTOCOL_VERSION) {
    throw new Error(
      `Workspace review protocol v${workspace.protocolVersion} is stale; run agent-wrapped dsh again before reviewing.`,
    );
  }

  const requestedSessionId = stringFlag(args, "session") ?? args.positional[0];
  const reviewAll = booleanFlag(args, "all");
  const terminal = injectedIO ? undefined : await makeTerminalReviewIO();
  const io = injectedIO ?? terminal?.io;
  if (!io) throw new Error("Review input is unavailable.");

  try {
    let current = requestedSessionId
      ? findEvaluationCase(workspace, requestedSessionId)
      : nextIncompleteCase(workspace);
    if (requestedSessionId && !current) throw new Error(`Session ${requestedSessionId} is not present in this review workspace.`);
    if (!current) {
      out(stdout, "所有会话都已经完成评测。运行 agent-wrapped calibration 查看结果。");
      return 0;
    }

    for (;;) {
      const existing = findSessionReview(workspace, current.sessionId);
      const result = await reviewEvaluationCase(current, existing, io, {
        locale,
        onCheckpoint: async (review) => {
          await saveReviewCheckpoint(workspace, review, { store });
        },
      });
      await saveReviewCheckpoint(workspace, result.review, {
        store,
        completed: result.completed,
      });

      if (result.quitRequested) {
        out(stdout, "已保存当前进度，下次 review 会从未回答处继续。");
        return 0;
      }
      out(stdout, `已完成：${current.title ?? current.sessionId}`);
      if (!reviewAll || requestedSessionId) break;
      const next = nextIncompleteCase(workspace);
      if (!next) break;
      current = next;
    }

    printProgress(stdout, computeReviewProgress(workspace));
    return 0;
  } finally {
    terminal?.close();
  }
}

export async function runCli(argv: string[], options: RunCliOptions = {}): Promise<number> {
  const stdout = options.stdout ?? { write: (text: string) => processStdout.write(text) };
  const stderr = options.stderr ?? { write: (text: string) => processStderr.write(text) };
  const args = parseArgs(argv);

  try {
    switch (args.command) {
      case undefined:
      case "help":
      case "--help":
      case "-h":
        out(stdout, helpText().trimEnd());
        return 0;
      case "dsh":
        return await commandDsh(args, stdout);
      case "review":
        return await commandReview(args, stdout, options.reviewIO);
      case "calibration":
        return await commandCalibration(args, stdout);
      case "status":
        return await commandStatus(args, stdout);
      default:
        out(stderr, `Unknown command: ${args.command}`);
        out(stderr, "Run agent-wrapped help for usage.");
        return 2;
    }
  } catch (error) {
    out(stderr, error instanceof Error ? error.message : String(error));
    return 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) {
  process.exitCode = await runCli(process.argv.slice(2));
}
