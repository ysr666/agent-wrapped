import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { reviewEvaluationCase } from "../dist/review/reviewer.js";
import { calibrateReviewWorkspace, saveReviewCheckpoint } from "../dist/review/runner.js";
import {
  computeReviewProgress,
  createOrRefreshReviewWorkspace,
  loadReviewWorkspace,
  saveReviewWorkspace,
} from "../dist/review/workspace.js";

function moment(id, selected, awardKind, awardId, funScore = 80) {
  return {
    id,
    type: "one_liner",
    primaryText: `moment ${id}`,
    relatedTexts: [],
    funScore,
    confidence: 90,
    selected,
    awardKind,
    awardId,
  };
}

function evaluationCase(sessionId = "s1", suffix = "") {
  const first = moment(`m1${suffix}`, true, "quote", `award:q${suffix}`, 90);
  const second = moment(`m2${suffix}`, true, "emotional-peak", `award:e${suffix}`, 75);
  const rejected = moment(`m3${suffix}`, false, undefined, undefined, 70);
  return {
    version: 1,
    sessionId,
    host: "dsh",
    title: `Session ${sessionId}`,
    model: "deepseek-v4-flash",
    moments: [first, second, rejected],
    pairwiseTasks: [
      {
        id: `${sessionId}:pair:1${suffix}`,
        sessionId,
        left: first,
        right: rejected,
        predictedWinnerId: first.id,
      },
    ],
  };
}

function scriptedIO(answers) {
  const writes = [];
  let index = 0;
  return {
    writes,
    io: {
      write(text) {
        writes.push(text);
      },
      async ask() {
        const answer = answers[index];
        index += 1;
        if (answer === undefined) throw new Error("scripted review ran out of answers");
        return answer;
      },
    },
    get consumed() {
      return index;
    },
  };
}

test("P7 workspace refresh preserves reviews only while the evaluation case fingerprint is stable", () => {
  const first = createOrRefreshReviewWorkspace(
    [evaluationCase("s1")],
    { host: "dsh", maxSessions: 30 },
  ).workspace;
  first.reviews.push({ sessionId: "s1", awardVotes: [{ awardId: "award:q", verdict: "keep", fun: 5 }] });
  first.completedSessionIds.push("s1");

  const stable = createOrRefreshReviewWorkspace(
    [evaluationCase("s1")],
    { host: "dsh", maxSessions: 30 },
    first,
  );
  assert.equal(stable.preservedReviews, 1);
  assert.equal(stable.invalidatedReviews, 0);
  assert.equal(stable.workspace.completedSessionIds.length, 1);

  const changed = createOrRefreshReviewWorkspace(
    [evaluationCase("s1", "-changed")],
    { host: "dsh", maxSessions: 30 },
    stable.workspace,
  );
  assert.equal(changed.preservedReviews, 0);
  assert.equal(changed.invalidatedReviews, 1);
  assert.equal(changed.workspace.reviews.length, 0);
  assert.equal(changed.workspace.completedSessionIds.length, 0);
});

test("P7 interactive reviewer checkpoints answers and can resume without asking them again", async () => {
  const entry = evaluationCase("resume");
  const firstRun = scriptedIO(["k", "5", "q"]);
  const checkpoints = [];
  const partial = await reviewEvaluationCase(entry, undefined, firstRun.io, {
    onCheckpoint(review) {
      checkpoints.push(structuredClone(review));
    },
  });

  assert.equal(partial.completed, false);
  assert.equal(partial.quitRequested, true);
  assert.equal(partial.review.awardVotes.length, 1);
  assert.equal(checkpoints.length, 1);

  const secondRun = scriptedIO(["d", "2", "1", "y", "漏掉的神句", "", "", "n"]);
  const completed = await reviewEvaluationCase(entry, partial.review, secondRun.io);
  assert.equal(completed.completed, true);
  assert.equal(completed.quitRequested, false);
  assert.equal(completed.review.awardVotes.length, 2);
  assert.equal(completed.review.pairwiseVotes.length, 1);
  assert.equal(completed.review.missedMoments.length, 1);
  assert.equal(completed.review.awardVotes.find((vote) => vote.awardId === "award:q")?.fun, 5);
});

test("P7 persists local review state atomically and produces P6 calibration metrics", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-wrapped-p7-"));
  const store = join(directory, "workspace.json");
  try {
    const workspace = createOrRefreshReviewWorkspace(
      [evaluationCase("persist")],
      { host: "dsh", maxSessions: 30 },
    ).workspace;
    await saveReviewWorkspace(workspace, store);

    await saveReviewCheckpoint(
      workspace,
      {
        sessionId: "persist",
        awardVotes: [
          { awardId: "award:q", verdict: "keep", fun: 5 },
          { awardId: "award:e", verdict: "drop", fun: 2 },
        ],
        pairwiseVotes: [{ taskId: "persist:pair:1", winner: "left" }],
        missedMoments: [{ text: "人工补录" }],
      },
      { store, completed: true },
    );

    const reloaded = await loadReviewWorkspace(store);
    const progress = computeReviewProgress(reloaded);
    assert.equal(progress.sessions, 1);
    assert.equal(progress.completedSessions, 1);
    assert.equal(progress.awardVotes, 2);
    assert.equal(progress.pairwiseVotes, 1);
    assert.equal(progress.missedMoments, 1);

    const calibration = calibrateReviewWorkspace(reloaded);
    assert.equal(calibration.report.awardKeepRate, 0.5);
    assert.equal(calibration.report.averageAwardFun, 3.5);
    assert.equal(calibration.report.pairwise.accuracy, 1);
    assert.equal(calibration.report.missedMoments, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
