import test from "node:test";
import assert from "node:assert/strict";

import { createWrappedReport } from "../dist/wrapped/wrappedReport.js";
import { renderWrappedMarkdown, renderWrappedText } from "../dist/wrapped/renderer.js";
import { summarizeWrappedPreferences } from "../dist/wrapped/preference.js";

function dsh(text) {
  return { role: "assistant", host: "dsh", text };
}

function dramaticSession() {
  return [
    dsh("现在问题已经非常明确了。"),
    dsh("现在问题已经非常明确了。"),
    dsh("现在问题已经非常明确了。"),
    dsh("我已经确认，可以完全排除缓存。"),
    dsh("这次真的找到根因了！！！"),
    dsh("这次真的找到根因了！！！"),
    dsh("这次真的找到根因了！！！"),
    dsh("这次应该真的没问题了！"),
    { role: "user", text: "你再确认一下。" },
    dsh("等等，不对，我刚才判断错了；最终根因还是缓存。"),
    { role: "tool", text: "tool output should never become an award" },
    dsh("重大发现！！！我们前面的路线完全错了！"),
  ];
}

test("P4 creates a compact end-to-end Wrapped report from transcript messages", () => {
  const report = createWrappedReport(dramaticSession(), {
    includeRankedMoments: true,
    awards: { maxAwards: 7 },
  });

  assert.equal(report.version, 1);
  assert.equal(report.title, "今晚的 Agent Wrapped");
  assert.equal(report.metrics.messages, 12);
  assert.equal(report.metrics.assistantMessages, 10);
  assert.ok(report.metrics.events > 0);
  assert.ok(report.metrics.momentCandidates > 0);
  assert.ok(report.metrics.rankedMoments > 0);
  assert.equal(report.metrics.awards, report.awards.length);
  assert.ok(report.awards.length >= 3);
  assert.ok(report.awards.length <= 7);
  assert.ok(report.rankedMoments?.length);
  assert.ok(report.awards.some((award) => award.kind === "quote"));
  assert.ok(
    report.awards.some((award) =>
      [award.primaryText, ...award.relatedTexts].some((text) => text.includes("路线完全错了")),
    ),
  );
  assert.ok(report.awards.some((award) => award.kind === "catchphrase" || award.kind === "wolf-cry"));
});

test("P4 renderers preserve source wording and hide internal scores by default", () => {
  const report = createWrappedReport(dramaticSession(), { awards: { maxAwards: 7 } });
  const markdown = renderWrappedMarkdown(report);
  const text = renderWrappedText(report);

  assert.match(markdown, /^# 🎬 今晚的 Agent Wrapped/mu);
  assert.ok(markdown.includes("重大发现！！！我们前面的路线完全错了！"));
  assert.ok(text.includes("重大发现！！！我们前面的路线完全错了！"));
  assert.ok(!markdown.includes("好玩度"));
  assert.ok(renderWrappedMarkdown(report, { includeScores: true }).includes("好玩度"));
  assert.ok(markdown.includes("assistant 消息"));
});

test("P4 does not invent awards when the session has no strong moment", () => {
  const report = createWrappedReport([dsh("我先检查一下配置文件。")]);
  assert.equal(report.awards.length, 0);
  assert.match(renderWrappedText(report), /没有强到值得上榜/u);
});

test("P4 supports English presentation without changing original transcript text", () => {
  const report = createWrappedReport(
    [
      { role: "assistant", host: "claude-code", text: "Wait — I was wrong; our whole approach was wrong." },
      { role: "assistant", host: "claude-code", text: "I found the real issue." },
    ],
    { locale: "en", awards: { minFunScore: 0 } },
  );

  assert.equal(report.title, "Tonight's Agent Wrapped");
  const markdown = renderWrappedMarkdown(report);
  assert.ok(markdown.includes("Wait — I was wrong; our whole approach was wrong."));
  assert.ok(markdown.includes("assistant messages"));
});

test("P4 preference hook summarizes deduplicated human votes", () => {
  const report = createWrappedReport(dramaticSession(), { awards: { maxAwards: 3 } });
  assert.ok(report.awards.length >= 2);
  const first = report.awards[0];
  const second = report.awards[1];

  const summary = summarizeWrappedPreferences(report, [
    { awardId: first.id, verdict: "drop", fun: 2 },
    { awardId: first.id, verdict: "keep", fun: 5 },
    { awardId: second.id, verdict: "keep", fun: 4 },
    { awardId: "unknown", verdict: "keep", fun: 5 },
  ]);

  assert.equal(summary.voted, 2);
  assert.equal(summary.kept, 2);
  assert.equal(summary.dropped, 0);
  assert.equal(summary.keepRate, 1);
  assert.equal(summary.averageFun, 4.5);
  assert.equal(summary.missingAwardIds.length, report.awards.length - 2);
});
