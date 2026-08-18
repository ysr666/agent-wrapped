import test from "node:test";
import assert from "node:assert/strict";

import { rankQuoteCandidates, scoreQuote } from "../dist/core/quoteScorer.js";
import { publicQuoteBenchmarks } from "./fixtures/publicQuoteBenchmarks.mjs";

for (const benchmark of publicQuoteBenchmarks) {
  test(`public quote benchmark: ${benchmark.id}`, () => {
    const ranked = rankQuoteCandidates(benchmark.messages, {
      limit: 50,
      minScore: 0,
      penalizeRepetition: true,
    });

    assert.ok(ranked.length > 0, "benchmark should yield at least one quote candidate");

    const winner = ranked.find((candidate) => candidate.text === benchmark.expectedTopText);
    assert.ok(
      winner,
      `expected winner was not extracted: ${benchmark.expectedTopText}\nActual: ${ranked.map((candidate) => candidate.text).join(" | ")}`,
    );

    assert.equal(
      ranked[0].text,
      benchmark.expectedTopText,
      `unexpected top quote for ${benchmark.id}: ${ranked[0].text}`,
    );

    for (const lowerText of benchmark.mustOutrank) {
      const lower = ranked.find((candidate) => candidate.text === lowerText);
      assert.ok(lower, `comparison candidate was not extracted: ${lowerText}`);
      assert.ok(
        winner.score > lower.score,
        `expected ${JSON.stringify(winner.text)} (${winner.score}) to outrank ${JSON.stringify(lower.text)} (${lower.score})`,
      );
    }
  });
}

test("dramatic reversal combines discovery, reversal and confidence signals", () => {
  const result = scoreQuote("重大发现！！！我们前面的路线完全错了！");

  assert.ok((result.signals.discovery ?? 0) > 0);
  assert.ok((result.signals.reversal ?? 0) > 0);
  assert.ok((result.signals.confidence ?? 0) > 0);
  assert.ok((result.signals.punctuation ?? 0) > 0);
  assert.ok((result.signals["signal-synergy"] ?? 0) > 0);
});

test("generic confidence is weaker than a dramatic reversal", () => {
  const dramatic = scoreQuote("重大发现！！！我们前面的路线完全错了！");
  const generic = scoreQuote("现在问题已经非常明确了。");

  assert.ok(dramatic.score > generic.score);
  assert.ok((generic.signals["generic-template"] ?? 0) < 0);
});

test("repetition penalty pushes repeated discoveries toward catchphrase territory", () => {
  const once = scoreQuote("I'm on the exact defect now.", 1, true);
  const repeated = scoreQuote("I'm on the exact defect now.", 8, true);

  assert.ok(once.score > repeated.score);
  assert.ok((repeated.signals.repetition ?? 0) < 0);
});

test("code and command noise is penalized", () => {
  const result = scoreQuote("npm test && git status --short");
  assert.ok((result.signals["code-noise"] ?? 0) < 0);
});

test("assistant-only extraction ignores user and tool text", () => {
  const ranked = rankQuoteCandidates(
    [
      { role: "user", text: "重大发现！！！我们前面的路线完全错了！" },
      { role: "tool", text: "I was wrong; the whole approach was wrong." },
      { role: "assistant", text: "我先检查一下配置文件。" },
    ],
    { minScore: 0 },
  );

  assert.ok(ranked.every((candidate) => candidate.text !== "重大发现！！！我们前面的路线完全错了！"));
  assert.ok(ranked.every((candidate) => candidate.text !== "I was wrong; the whole approach was wrong."));
});
