import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCalibrationReport,
  buildEvaluationDataset,
  buildSessionEvaluationCase,
  summarizePairwisePreferences,
} from "../dist/evaluation/benchmark.js";

function session(id = "eval-session") {
  const assistant = (text) => ({ role: "assistant", host: "dsh", text });
  return {
    id,
    host: "dsh",
    title: "真实排障会话",
    createdAt: "2026-08-19T00:00:00.000Z",
    model: "deepseek-v4-flash",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      assistant("现在问题已经非常明确了。"),
      assistant("现在问题已经非常明确了。"),
      assistant("现在问题已经非常明确了。"),
      assistant("我已经确认，可以完全排除缓存。"),
      assistant("这次真的找到根因了！！！"),
      assistant("这次真的找到根因了！！！"),
      assistant("这次真的找到根因了！！！"),
      assistant("这次应该真的没问题了！"),
      { role: "user", text: "你再确认一下。" },
      assistant("等等，不对，我刚才判断错了；最终根因还是缓存。"),
      assistant("这也太诡异了！！！"),
      assistant("重大发现！！！我们前面的路线完全错了！"),
    ],
  };
}

test("P6 builds a bounded preference case from a real-session-shaped transcript", () => {
  const result = buildSessionEvaluationCase(session(), {
    topMoments: 6,
    maxPairwiseTasks: 7,
    wrapped: { awards: { maxAwards: 5 } },
  });

  assert.equal(result.version, 1);
  assert.equal(result.sessionId, "eval-session");
  assert.equal(result.host, "dsh");
  assert.equal(result.model, "deepseek-v4-flash");
  assert.ok(result.moments.length > 0);
  assert.ok(result.moments.length <= 6);
  assert.ok(result.pairwiseTasks.length > 0);
  assert.ok(result.pairwiseTasks.length <= 7);
  assert.ok(result.moments.some((moment) => moment.selected));
  assert.ok(result.moments.some((moment) => moment.primaryText.includes("路线完全错了") || moment.relatedTexts.some((text) => text.includes("路线完全错了"))));
  for (const task of result.pairwiseTasks) {
    assert.ok(task.predictedWinnerId === task.left.id || task.predictedWinnerId === task.right.id);
  }
});

test("P6 pairwise scoring uses the latest vote and reports unknown task ids", () => {
  const evaluationCase = buildSessionEvaluationCase(session(), { topMoments: 5, maxPairwiseTasks: 4 });
  const first = evaluationCase.pairwiseTasks[0];
  assert.ok(first);
  const predictedSide = first.predictedWinnerId === first.left.id ? "left" : "right";

  const summary = summarizePairwisePreferences(evaluationCase.pairwiseTasks, [
    { taskId: first.id, winner: predictedSide === "left" ? "right" : "left" },
    { taskId: first.id, winner: predictedSide },
    { taskId: "unknown-task", winner: "left" },
  ]);

  assert.equal(summary.answered, 1);
  assert.equal(summary.decisive, 1);
  assert.equal(summary.correct, 1);
  assert.equal(summary.accuracy, 1);
  assert.deepEqual(summary.unknownTaskIds, ["unknown-task"]);
});

test("P6 aggregates award keep-rate, pairwise accuracy and human-found misses", () => {
  const dataset = buildEvaluationDataset([session("s1"), session("s2")], {
    topMoments: 8,
    maxPairwiseTasks: 5,
  });
  const firstCase = dataset[0];
  const selected = firstCase.moments.filter((moment) => moment.selected && moment.awardId);
  assert.ok(selected.length >= 2);
  const task = firstCase.pairwiseTasks[0];
  assert.ok(task);
  const predictedSide = task.predictedWinnerId === task.left.id ? "left" : "right";

  const report = buildCalibrationReport(dataset, [
    {
      sessionId: "s1",
      awardVotes: [
        { awardId: selected[0].awardId, verdict: "keep", fun: 5 },
        { awardId: selected[1].awardId, verdict: "drop", fun: 2 },
      ],
      pairwiseVotes: [{ taskId: task.id, winner: predictedSide }],
      missedMoments: [{ text: "还有一个模型完全漏掉的名场面" }],
    },
  ]);

  assert.equal(report.sessionsInDataset, 2);
  assert.equal(report.sessionsReviewed, 1);
  assert.equal(report.reviewCoverage, 0.5);
  assert.equal(report.awardVotes, 2);
  assert.equal(report.awardKeepRate, 0.5);
  assert.equal(report.averageAwardFun, 3.5);
  assert.equal(report.pairwise.decisive, 1);
  assert.equal(report.pairwise.accuracy, 1);
  assert.equal(report.missedMoments, 1);
  assert.ok(report.byAwardKind.length >= 1);
});
