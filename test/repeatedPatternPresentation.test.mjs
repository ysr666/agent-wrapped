import test from "node:test";
import assert from "node:assert/strict";

import { detectEventSignals, detectVerbalFamily } from "../dist/events/lexicon.js";
import { presentRepeatedPattern } from "../dist/presentation/repeatedPattern.js";
import { reviewEvaluationCase } from "../dist/review/reviewer.js";

test("imperative 'Wait for ...' is not classified as a wait-reset verbal tic", () => {
  assert.equal(detectVerbalFamily("Wait for the release workflow to complete."), undefined);
  assert.equal(detectEventSignals("Wait for the release workflow to complete.").confusion, undefined);
  assert.equal(detectVerbalFamily("Wait — critical: check main first."), "wait-reset:positive");
  assert.ok(detectEventSignals("Wait — critical: check main first.").confusion);
});

test("wait-reset repetition is presented as one tic with a count and examples", () => {
  const presentation = presentRepeatedPattern({
    primaryText: "Wait — also need to check index.",
    family: "wait-reset:positive",
    count: 8,
    variants: [
      "Wait — also need to check index.",
      "Wait, user said the tests passed.",
      "Wait — critical: confirm main first.",
      "Wait — check how NUMBER_KEYS render.",
    ],
  });

  assert.equal(presentation.label, "Wait");
  assert.equal(presentation.count, 8);
  assert.equal(presentation.examples.length, 3);
});

test("P7 reviewer does not render catchphrase variants as a fake causal timeline", async () => {
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
          "Wait — also need to check index.",
          "Wait, user said the tests passed.",
          "Wait — critical: confirm main first.",
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
  assert.match(output, /“Wait” × 8/u);
  assert.match(output, /例：/u);
  assert.ok(!output.includes("↓"));
  assert.ok(!output.includes("Wait for the release workflow"));
});
