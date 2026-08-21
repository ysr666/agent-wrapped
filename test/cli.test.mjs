import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runCli } from "../dist/cli.js";
import { createOrRefreshReviewWorkspace, saveReviewWorkspace } from "../dist/review/workspace.js";

function evaluationCase() {
  const selected = {
    id: "m1",
    type: "one_liner",
    primaryText: "重大发现！！！我们前面的路线完全错了！",
    relatedTexts: [],
    funScore: 95,
    confidence: 90,
    selected: true,
    awardKind: "quote",
    awardId: "award:q",
  };
  const rejected = {
    id: "m2",
    type: "one_liner",
    primaryText: "这也太诡异了！！！",
    relatedTexts: [],
    funScore: 70,
    confidence: 88,
    selected: false,
  };
  return {
    version: 1,
    sessionId: "cli-session",
    host: "dsh",
    title: "CLI Session",
    moments: [selected, rejected],
    pairwiseTasks: [
      {
        id: "cli-session:pair:1",
        sessionId: "cli-session",
        left: selected,
        right: rejected,
        predictedWinnerId: selected.id,
      },
    ],
  };
}

function capture() {
  let text = "";
  return {
    output: { write(value) { text += value; } },
    value() { return text; },
  };
}

function scriptedReviewIO(answers) {
  let index = 0;
  return {
    write() {},
    async ask() {
      const answer = answers[index++];
      if (answer === undefined) throw new Error("no scripted answer left");
      return answer;
    },
  };
}

test("P7 CLI can review a stored case, report protocol status, and print calibration JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-wrapped-cli-"));
  const store = join(directory, "review.json");
  try {
    const workspace = createOrRefreshReviewWorkspace(
      [evaluationCase()],
      { host: "dsh", maxSessions: 1 },
      undefined,
      { presentationLocale: "zh-CN" },
    ).workspace;
    await saveReviewWorkspace(workspace, store);

    const stdout = capture();
    const stderr = capture();
    const reviewCode = await runCli(
      ["review", "--store", store, "--session", "cli-session"],
      {
        stdout: stdout.output,
        stderr: stderr.output,
        reviewIO: scriptedReviewIO(["k", "5", "1", "n"]),
      },
    );
    assert.equal(reviewCode, 0);
    assert.equal(stderr.value(), "");
    assert.match(stdout.value(), /已完成：CLI Session/u);

    const status = capture();
    assert.equal(await runCli(["status", "--store", store], { stdout: status.output, stderr: stderr.output }), 0);
    assert.match(status.value(), /评测协议：v2 · zh-CN/u);
    assert.match(status.value(), /1\/1 已完成/u);

    const calibration = capture();
    assert.equal(
      await runCli(["calibration", "--store", store, "--json"], { stdout: calibration.output, stderr: stderr.output }),
      0,
    );
    const parsed = JSON.parse(calibration.value());
    assert.equal(parsed.protocolVersion, 2);
    assert.equal(parsed.presentationLocale, "zh-CN");
    assert.equal(parsed.progress.completedSessions, 1);
    assert.equal(parsed.calibration.awardKeepRate, 1);
    assert.equal(parsed.calibration.awardSkipped, 0);
    assert.equal(parsed.calibration.pairwise.accuracy, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("P7 CLI refuses to mix review locales inside one workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-wrapped-cli-locale-"));
  const store = join(directory, "review.json");
  try {
    const workspace = createOrRefreshReviewWorkspace(
      [evaluationCase()],
      { host: "dsh", maxSessions: 1 },
      undefined,
      { presentationLocale: "zh-CN" },
    ).workspace;
    await saveReviewWorkspace(workspace, store);

    const stdout = capture();
    const stderr = capture();
    const code = await runCli(["review", "--store", store, "--locale", "en"], {
      stdout: stdout.output,
      stderr: stderr.output,
      reviewIO: scriptedReviewIO([]),
    });
    assert.equal(code, 1);
    assert.match(stderr.value(), /workspace is bound to zh-CN/iu);
    assert.match(stderr.value(), /dsh --latest 1 --locale en/iu);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("P7 CLI rejects invalid numeric flags clearly", async () => {
  const stdout = capture();
  const stderr = capture();
  const code = await runCli(["dsh", "--latest", "banana"], {
    stdout: stdout.output,
    stderr: stderr.output,
  });
  assert.equal(code, 1);
  assert.match(stderr.value(), /--latest must be a non-negative integer/u);
});

test("P7 CLI rejects malformed fixed-session hash selectors before ingestion", async () => {
  const stdout = capture();
  const stderr = capture();
  const code = await runCli(["dsh", "--session-hashes", "not-a-hash"], {
    stdout: stdout.output,
    stderr: stderr.output,
  });
  assert.equal(code, 1);
  assert.match(stderr.value(), /12-character lowercase SHA-256 prefixes/u);
});

test("CLI renders the final composed Wrapped and supports privacy-safe JSON inspection", async () => {
  const session = {
    id: "cli-composed-session",
    title: "CLI Composed Session",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "assistant", host: "dsh", text: "本轮排查闭环完成。" },
      { role: "user", host: "dsh", text: "等下，又有一个 bug 要看。" },
    ],
    events: [
      { id: "close", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "本轮排查闭环完成。" },
      { id: "reopen", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "等下，又有一个 bug 要看。" },
    ],
  };
  const dshSessionLoader = async (options) => {
    assert.equal(options.maxSessions, 1);
    return [session];
  };
  const semanticNarrator = { async generate() { return "{}"; } };
  const stdout = capture();
  const stderr = capture();
  const code = await runCli(["wrapped", "--latest", "1", "--scores", "--diagnostics"], {
    stdout: stdout.output,
    stderr: stderr.output,
    dshSessionLoader,
    semanticNarrator,
  });
  assert.equal(code, 0);
  assert.equal(stderr.value(), "");
  assert.match(stdout.value(), /本场 Agent Wrapped/u);
  assert.match(stdout.value(), /宣布收尾以后，工作又来了/u);
  assert.match(stdout.value(), /好玩度/u);
  assert.match(stdout.value(), /候选：P4 0 · P8 1/u);

  const json = capture();
  assert.equal(await runCli(["wrapped", "--latest", "1", "--json"], {
    stdout: json.output,
    stderr: stderr.output,
    dshSessionLoader,
    semanticNarrator,
  }), 0);
  const parsed = JSON.parse(json.value());
  assert.match(parsed.sessions[0].sessionHash, /^[a-f0-9]{12}$/u);
  assert.equal(parsed.sessions[0].report.sessionId, parsed.sessions[0].sessionHash);
  assert.equal(parsed.sessions[0].report.cards.length, 1);
  assert.match(parsed.sessions[0].rendered, /本场剧情/u);
});

test("CLI keeps inspecting later sessions when one semantic call fails", async () => {
  const failing = {
    id: "cli-failing-session",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "assistant", host: "dsh", text: "本轮排查闭环完成。" },
      { role: "user", host: "dsh", text: "等下，又有一个 bug 要看。" },
    ],
    events: [
      { id: "close", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "本轮排查闭环完成。" },
      { id: "reopen", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "等下，又有一个 bug 要看。" },
    ],
  };
  const empty = {
    id: "cli-empty-session",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [{ role: "user", host: "dsh", text: "hello" }],
    events: [{ id: "user", host: "dsh", actor: "user", kind: "user_message", order: 0, messageIndex: 0, text: "hello" }],
  };
  const stdout = capture();
  const stderr = capture();
  const code = await runCli(["wrapped", "--latest", "2"], {
    stdout: stdout.output,
    stderr: stderr.output,
    dshSessionLoader: async () => [failing, empty],
    semanticNarrator: { async generate() { throw new Error("endpoint timeout"); } },
  });

  assert.equal(code, 1);
  assert.match(stderr.value(), /Wrapped 1\/2/u);
  assert.match(stderr.value(), /Wrapped 2\/2/u);
  assert.match(stdout.value(), /生成失败：Error: endpoint timeout/u);
  assert.match(stdout.value(), /这场暂时没有强到值得上榜的名场面/u);
});
