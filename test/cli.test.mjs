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
