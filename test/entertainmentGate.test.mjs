import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAwardEntertainment,
  evaluateStoryEntertainment,
  hasGroundedComedicTension,
} from "../dist/index.js";

function evidence(events, momentHints = []) {
  return {
    version: 2,
    sessionId: "entertainment-gate",
    host: "dsh",
    locale: "zh-CN",
    events,
    windows: [],
    momentHints,
    redactionCount: 0,
    truncated: false,
  };
}

function story(arcKind, beats) {
  return {
    id: `story:${arcKind}`,
    windowId: `window:${arcKind}`,
    arcKind,
    beats,
    evidenceIds: beats.flatMap((beat) => beat.evidenceIds),
    confidence: "high",
  };
}

test("human-like but ordinary admission is not entertainment", () => {
  const candidate = story("user_pushback_then_recovery", [
    { kind: "user_pushback", evidenceIds: ["user"] },
    { kind: "correction", evidenceIds: ["agent"] },
  ]);
  const bundle = evidence([
    { id: "user", order: 0, actor: "user", kind: "user_message", text: "你第一轮没有看图。" },
    { id: "agent", order: 1, actor: "assistant", kind: "assistant_text", text: "第一轮没看是我的失误，没有任何借口。" },
  ]);

  assert.equal(hasGroundedComedicTension(candidate, bundle), false);
  assert.deepEqual(
    evaluateStoryEntertainment(candidate, { narration: { storyCards: [{ storyId: candidate.id, title: "被抓包后认错" }] } }, bundle),
    { show: false, reason: "no-laugh-carrier" },
  );
});

test("confidence collapse, bizarre workaround, and emotional whiplash carry comedy", () => {
  const falseDawn = story("false_dawn", [
    { kind: "claim", evidenceIds: ["claim"] },
    { kind: "failure", evidenceIds: ["failure"] },
  ]);
  const improvisation = story("capability_gap_then_improvisation", [
    { kind: "capability_gap", evidenceIds: ["gap"] },
    { kind: "workaround", evidenceIds: ["workaround"] },
  ]);
  const breakdown = story("breakdown_then_resume", [
    { kind: "breakdown", evidenceIds: ["breakdown"] },
    { kind: "recovery", evidenceIds: ["resume"] },
  ]);
  const bundle = evidence([
    { id: "claim", order: 0, actor: "assistant", kind: "assistant_text", text: "OK，完美，这次已经修好了。" },
    { id: "failure", order: 1, actor: "user", kind: "user_message", text: "等等，还是失败。" },
    { id: "gap", order: 2, actor: "assistant", kind: "assistant_text", text: "没有生图工具。" },
    { id: "workaround", order: 3, actor: "assistant", kind: "tool_call", toolName: "write", toolCategory: "mutation" },
    { id: "breakdown", order: 4, actor: "assistant", kind: "assistant_text", text: "老子不玩了。" },
    { id: "resume", order: 5, actor: "assistant", kind: "assistant_text", text: "Alright, back to business." },
  ]);

  assert.equal(hasGroundedComedicTension(falseDawn, bundle), true);
  assert.equal(hasGroundedComedicTension(improvisation, bundle), true);
  assert.equal(hasGroundedComedicTension(breakdown, bundle), true);
});

test("final award gate keeps a real reversal and rejects a merely sincere quote", () => {
  const scoreBase = {
    confidence: 90,
    contextPayoff: 56,
    rarity: 86,
    readability: 100,
  };
  const reversal = {
    id: "award:reversal",
    kind: "plot-twist",
    title: "剧情急转弯",
    emoji: "🧠",
    momentId: "moment:reversal",
    sourceType: "plot_twist",
    messageIndexes: [0],
    primaryText: "这条主线从来没有被单独修过——之前每次修的都是别的卡顿。",
    relatedTexts: [],
    funScore: 74,
    confidence: 90,
    scores: { ...scoreBase, funScore: 74, standaloneQuality: 59, surprise: 76, structuralStrength: 76 },
    evidence: [],
  };
  const sincereAdmission = {
    ...reversal,
    id: "award:admission",
    kind: "quote",
    primaryText: "第一轮没看是我的失误，没有任何借口。",
    funScore: 50,
    scores: { ...scoreBase, funScore: 50, standaloneQuality: 10, surprise: 0, structuralStrength: 20 },
  };

  assert.equal(evaluateAwardEntertainment(reversal).show, true);
  assert.deepEqual(evaluateAwardEntertainment(sincereAdmission), { show: false, reason: "no-laugh-carrier" });
});

test("an available entertainment editor can veto a true but weak false dawn", () => {
  const candidate = story("false_dawn", [
    { kind: "claim", evidenceIds: ["claim"] },
    { kind: "failure", evidenceIds: ["failure"] },
  ]);
  const bundle = evidence([
    { id: "claim", order: 0, actor: "assistant", kind: "assistant_text", text: "应该完成了。" },
    { id: "failure", order: 1, actor: "user", kind: "user_message", text: "这里还有一个问题。" },
  ]);

  assert.deepEqual(
    evaluateStoryEntertainment(candidate, { narration: { storyCards: [] } }, bundle),
    { show: false, reason: "narrator-dropped" },
  );
});
