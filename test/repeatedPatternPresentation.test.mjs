import test from "node:test";
import assert from "node:assert/strict";

import { detectEventSignals, detectVerbalFamily } from "../dist/events/lexicon.js";
import { localizeAgentPhrase } from "../dist/presentation/localization.js";
import { presentRepeatedPattern } from "../dist/presentation/repeatedPattern.js";
import { reviewEvaluationCase } from "../dist/review/reviewer.js";
import { renderWrappedText } from "../dist/wrapped/renderer.js";

test("imperative 'Wait for ...' is not classified as a wait-reset verbal tic", () => {
  assert.equal(detectVerbalFamily("Wait for the release workflow to complete."), undefined);
  assert.equal(detectEventSignals("Wait for the release workflow to complete.").confusion, undefined);
  assert.equal(detectVerbalFamily("Wait — critical: check main first."), "wait-reset:positive");
  assert.equal(detectEventSignals("Wait — critical: check main first.").confusion, undefined);
  assert.ok(detectEventSignals("Wait — no, that diagnosis is wrong.").confusion);
});

test("wait-reset repetition is presented as one tic with a count and examples", () => {
  const input = {
    primaryText: "Wait — also need to check index.",
    family: "wait-reset:positive",
    count: 8,
    variants: [
      "Wait — also need to check index.",
      "Wait, user said the tests passed.",
      "Wait — critical: confirm main first.",
      "Wait — check how NUMBER_KEYS render.",
    ],
  };
  const presentation = presentRepeatedPattern(input);
  const localized = presentRepeatedPattern(input, 3, "zh-CN");

  assert.equal(presentation.label, "Wait");
  assert.equal(presentation.localizedLabel, undefined);
  assert.equal(presentation.count, 8);
  assert.equal(presentation.examples.length, 3);
  assert.equal(localized.localizedLabel, "等等 / Wait");
  assert.match(localized.localizedSummary, /等等，我再确认一下/u);
});

test("Chinese localization treats mixed Wait + Chinese quoted text as English agent-speak", () => {
  assert.equal(
    localizeAgentPhrase('Wait, user said "整套测试429项，424 passed / 0 failed / 5 skipped".', "zh-CN"),
    "等等，我再确认一下。",
  );
  assert.equal(localizeAgentPhrase("Wait for the release workflow to complete.", "zh-CN"), undefined);
});

test("P7 reviewer shows a Chinese catchphrase explanation while preserving English evidence", async () => {
  const writes = [];
  const evaluationCase = {
    version: 1,
    sessionId: "wait-session",
    host: "dsh",
    title: "Wait regression",
    model: "deepseek-v4-flash",
    moments: [
      {
        id: "repeat:wait",
        type: "repeated_pattern",
        primaryText: "Wait — also need to check index.",
        relatedTexts: [
          "Wait, user said the tests passed.",
          "Wait — critical: confirm main first.",
        ],
        family: "wait-reset:positive",
        count: 8,
        variants: [
          'Wait, user said "整套测试429项，424 passed / 0 failed / 5 skipped".',
          "Wait — critical: confirm main first.",
          "Wait — interesting: check the provider again.",
        ],
        funScore: 80,
        confidence: 96,
        selected: true,
        awardKind: "catchphrase",
        awardId: "award:wait",
      },
    ],
    pairwiseTasks: [],
  };
  const answers = ["q"];
  let answerIndex = 0;
  const result = await reviewEvaluationCase(evaluationCase, undefined, {
    write(text) { writes.push(text); },
    async ask() { return answers[answerIndex++]; },
  });

  assert.equal(result.quitRequested, true);
  const output = writes.join("\n");
  assert.match(output, /中文口癖：等等 \/ Wait × 8/u);
  assert.match(output, /大概就是反复在说：“等等，我再确认一下。”/u);
  assert.match(output, /原文关键词：“Wait”/u);
  assert.match(output, /原文例：/u);
  assert.ok(output.includes('Wait, user said "整套测试429项'));
  assert.ok(!output.includes("↓"));
  assert.ok(!output.includes("Wait for the release workflow"));
});

test("P7 reviewer adds compact Chinese hints to common English one-liners", async () => {
  const writes = [];
  const evaluationCase = {
    version: 1,
    sessionId: "english-one-liner",
    host: "dsh",
    title: "English moment",
    moments: [
      {
        id: "m1",
        type: "one_liner",
        primaryText: "I was wrong — the root cause is caching.",
        relatedTexts: [],
        funScore: 90,
        confidence: 95,
        selected: true,
        awardKind: "quote",
        awardId: "award:m1",
      },
    ],
    pairwiseTasks: [],
  };
  const result = await reviewEvaluationCase(evaluationCase, undefined, {
    write(text) { writes.push(text); },
    async ask() { return "q"; },
  });

  assert.equal(result.quitRequested, true);
  const output = writes.join("\n");
  assert.match(output, /I was wrong — the root cause is caching/u);
  assert.match(output, /中文提示：我刚才的判断错了 \/ 要收回前面的说法/u);
});

test("review locale=en keeps the original English-only presentation", async () => {
  const writes = [];
  const evaluationCase = {
    version: 1,
    sessionId: "wait-en",
    host: "dsh",
    title: "Wait English",
    moments: [
      {
        id: "repeat:wait",
        type: "repeated_pattern",
        primaryText: "Wait — check again.",
        relatedTexts: [],
        family: "wait-reset:positive",
        count: 4,
        variants: ["Wait — check again.", "Wait, one more thing."],
        funScore: 80,
        confidence: 96,
        selected: true,
        awardKind: "catchphrase",
        awardId: "award:wait-en",
      },
    ],
    pairwiseTasks: [],
  };
  await reviewEvaluationCase(
    evaluationCase,
    undefined,
    {
      write(text) { writes.push(text); },
      async ask() { return "q"; },
    },
    { locale: "en" },
  );

  const output = writes.join("\n");
  assert.match(output, /“Wait” × 4/u);
  assert.ok(!output.includes("中文口癖"));
  assert.ok(!output.includes("中文提示"));
});

test("P4 Chinese Wrapped output uses the same localized catchphrase presentation", () => {
  const report = {
    version: 1,
    locale: "zh-CN",
    title: "测试 Wrapped",
    awards: [
      {
        id: "award:wait",
        kind: "catchphrase",
        title: "高频口癖",
        emoji: "📢",
        momentId: "repeat:wait",
        sourceType: "repeated_pattern",
        messageIndexes: [1, 2, 3],
        primaryText: "Wait — check again.",
        relatedTexts: [],
        family: "wait-reset:positive",
        count: 8,
        variants: ["Wait — check again.", "Wait, user said tests passed.", "Wait — critical: confirm main."],
        funScore: 80,
        confidence: 96,
        scores: {
          funScore: 80,
          confidence: 96,
          standaloneQuality: 40,
          contextPayoff: 80,
          surprise: 50,
          rarity: 60,
          readability: 90,
          structuralStrength: 90,
        },
        evidence: [],
      },
    ],
    metrics: {
      messages: 20,
      assistantMessages: 10,
      events: 10,
      relations: 8,
      momentCandidates: 4,
      rankedMoments: 4,
      awards: 1,
      topFunScore: 80,
    },
    diagnostics: { rejectedAwards: [] },
  };

  const output = renderWrappedText(report);
  assert.match(output, /中文口癖：等等 \/ Wait × 8/u);
  assert.match(output, /原文关键词：“Wait”/u);
  assert.match(output, /原文例：/u);
});
