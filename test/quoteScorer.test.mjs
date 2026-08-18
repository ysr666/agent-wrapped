import test from "node:test";
import assert from "node:assert/strict";

import { scoreQuoteFacets } from "../dist/core/facetScorer.js";
import { rankQuoteCandidates, scoreQuote } from "../dist/core/quoteScorer.js";
import { funCandidateBenchmarks } from "./fixtures/funCandidateBenchmarks.mjs";
import { hardNegativeBenchmarks } from "./fixtures/hardNegativeBenchmarks.mjs";
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

for (const benchmark of hardNegativeBenchmarks) {
  test(`quote-ranking hard negative: ${benchmark.id}`, () => {
    const gold = scoreQuote(benchmark.gold);

    for (const negativeText of benchmark.negatives) {
      const negative = scoreQuote(negativeText);
      assert.ok(
        gold.score > negative.score,
        [
          `quote-ranking decoy beat or tied the intended quote in ${benchmark.id}`,
          `gold: ${JSON.stringify(gold.text)} (${gold.score})`,
          `decoy: ${JSON.stringify(negative.text)} (${negative.score})`,
          `gold signals: ${JSON.stringify(gold.signals)}`,
          `decoy signals: ${JSON.stringify(negative.signals)}`,
          "Note: a decoy may still be fun in another award category.",
        ].join("\n"),
      );
    }
  });
}

for (const benchmark of funCandidateBenchmarks) {
  test(`fun candidate facets: ${benchmark.id}`, () => {
    const facets = scoreQuoteFacets(benchmark.text, benchmark.repetitionCount);

    for (const [facet, minimum] of Object.entries(benchmark.expect)) {
      assert.ok(
        facets[facet] >= minimum,
        [
          `fun candidate lost its expected ${facet} signal in ${benchmark.id}`,
          `text: ${JSON.stringify(benchmark.text)}`,
          `expected ${facet} >= ${minimum}, got ${facets[facet]}`,
          `all facets: ${JSON.stringify(facets)}`,
        ].join("\n"),
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

test("generic confidence is weaker than a dramatic reversal as the single gold quote", () => {
  const dramatic = scoreQuote("重大发现！！！我们前面的路线完全错了！");
  const generic = scoreQuote("现在问题已经非常明确了。");

  assert.ok(dramatic.score > generic.score);
  assert.ok((generic.signals["generic-template"] ?? 0) < 0);
});

test("repetition lowers one-off quote score but raises catchphrase and wolf-cry facets", () => {
  const once = scoreQuote("I'm on the exact defect now.", 1, true);
  const repeated = scoreQuote("I'm on the exact defect now.", 8, true);
  const facets = scoreQuoteFacets("I found the root cause!", 8);

  assert.ok(once.score > repeated.score);
  assert.ok((repeated.signals.repetition ?? 0) < 0);
  assert.ok(facets.catchphrase >= 70);
  assert.ok(facets.wolfCry >= 70);
});

test("DSH-style repeated clarity line loses the gold-quote slot but survives as a catchphrase", () => {
  const messages = [
    ...Array.from({ length: 6 }, () => ({
      role: "assistant",
      host: "dsh",
      text: "现在问题已经非常明确了。",
    })),
    {
      role: "assistant",
      host: "dsh",
      text: "等等，不对，我们前面一直把现象当成根因了。",
    },
  ];

  const ranked = rankQuoteCandidates(messages, {
    minScore: 0,
    limit: 20,
    penalizeRepetition: true,
  });

  assert.equal(ranked[0].text, "等等，不对，我们前面一直把现象当成根因了。");

  const repeated = ranked.find((candidate) => candidate.text === "现在问题已经非常明确了。");
  assert.ok(repeated, "repeated DSH-style clarity line should still be extracted for comparison");
  assert.ok(ranked[0].score > repeated.score);

  const facets = scoreQuoteFacets("现在问题已经非常明确了。", 6);
  assert.ok(facets.catchphrase >= 70, `expected catchphrase value, got ${JSON.stringify(facets)}`);
});

test("code and command noise is penalized for quote ranking", () => {
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
