import test from "node:test";
import assert from "node:assert/strict";

import { composeAwards } from "../dist/awards/awardComposer.js";

function ranked({
  id,
  type,
  text,
  related = [],
  events,
  score,
  confidence = 90,
  evidence = [],
  family,
  count,
  messageIndexes,
}) {
  return {
    id,
    type,
    eventIds: events,
    relationIds: [],
    messageIndexes: messageIndexes ?? events.map((event) => {
      let hash = 0;
      for (const character of event) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
      return hash;
    }),
    primaryText: text,
    relatedTexts: related,
    family,
    count,
    variants: count ? [text] : undefined,
    evidence,
    scores: {
      funScore: score,
      confidence,
      standaloneQuality: 75,
      contextPayoff: type === "one_liner" ? 10 : 80,
      surprise: type === "one_liner" ? 60 : 85,
      rarity: 70,
      readability: 100,
      structuralStrength: 85,
    },
  };
}

test("P3.5 maps ranked moments into a diverse seven-card award set", () => {
  const moments = [
    ranked({
      id: "quote",
      type: "one_liner",
      text: "重大发现！！！我们前面的路线完全错了！",
      events: ["q"],
      score: 96,
      evidence: ["reversal:88", "discovery_claim:70"],
    }),
    ranked({
      id: "boomerang",
      type: "boomerang",
      text: "可以完全排除缓存。",
      related: ["最终根因还是缓存。"],
      events: ["b1", "b2"],
      score: 92,
    }),
    ranked({
      id: "wolf",
      type: "repeated_pattern",
      text: "这次真的找到根因了！！！",
      events: ["w1", "w2", "w3"],
      score: 89,
      family: "root-cause-found:positive",
      count: 3,
    }),
    ranked({
      id: "false-dawn",
      type: "false_dawn",
      text: "这次应该真的没问题了！",
      related: ["等等，不对，写路径还是坏的。"],
      events: ["f1", "f2"],
      score: 86,
    }),
    ranked({
      id: "catchphrase",
      type: "repeated_pattern",
      text: "现在问题已经非常明确了。",
      events: ["c1", "c2", "c3"],
      score: 82,
      family: "clarity:positive",
      count: 3,
    }),
    ranked({
      id: "arc",
      type: "correction_arc",
      text: "等等，不对，我刚才判断错了。",
      related: ["可以排除缓存。", "真正根因是缓存。"],
      events: ["a1", "a2", "a3"],
      score: 79,
    }),
    ranked({
      id: "emotion",
      type: "one_liner",
      text: "这也太诡异了！！！",
      events: ["e1"],
      score: 76,
      evidence: ["confusion:66"],
    }),
  ];

  const result = composeAwards(moments, { maxAwards: 7 });
  assert.equal(result.awards.length, 7);
  assert.deepEqual(
    new Set(result.awards.map((award) => award.kind)),
    new Set([
      "quote",
      "boomerang",
      "wolf-cry",
      "premature-celebration",
      "catchphrase",
      "plot-twist",
      "emotional-peak",
    ]),
  );
  assert.equal(result.awards.find((award) => award.kind === "wolf-cry")?.count, 3);
  assert.equal(result.awards.find((award) => award.kind === "quote")?.primaryText, "重大发现！！！我们前面的路线完全错了！");
});

test("P3.5 collapses identical underlying stories emitted as different moment types", () => {
  const result = composeAwards([
    ranked({
      id: "one-liner",
      type: "one_liner",
      text: "等等，不对，我们前面的路线完全错了。",
      events: ["same-event"],
      score: 90,
      evidence: ["reversal:88"],
    }),
    ranked({
      id: "plot-twist",
      type: "plot_twist",
      text: "等等，不对，我们前面的路线完全错了。",
      events: ["same-event"],
      score: 84,
      evidence: ["explicit correction/reversal strength: 88"],
    }),
  ]);

  assert.equal(result.awards.length, 1);
  assert.equal(result.awards[0].momentId, "one-liner");
  assert.ok(result.rejected.some((candidate) => candidate.momentId === "plot-twist" && candidate.reason === "overlaps-selected-moment"));
});

test("P3.5 keeps the strongest visible story instead of repeating its constituent lines", () => {
  const result = composeAwards([
    ranked({
      id: "false-dawn",
      type: "false_dawn",
      text: "已经修好了。",
      related: ["等等，不对。"],
      events: ["structural-view-a", "structural-view-b"],
      messageIndexes: [41, 42],
      score: 92,
    }),
    ranked({
      id: "plot-view",
      type: "plot_twist",
      text: "等等，不对。",
      related: ["已经修好了。"],
      events: ["separate-graph-view"],
      messageIndexes: [41, 42],
      score: 87,
    }),
    ranked({
      id: "quote-view",
      type: "one_liner",
      text: "等等，不对。",
      events: ["line-view"],
      messageIndexes: [42],
      score: 68,
      evidence: ["correction:84"],
    }),
    ranked({
      id: "emotion-view",
      type: "one_liner",
      text: "已经修好了。",
      events: ["emotion-view"],
      messageIndexes: [41],
      score: 54,
      evidence: ["celebration:64"],
    }),
    ranked({
      id: "independent-catchphrase",
      type: "repeated_pattern",
      text: "先跑一下 test。",
      events: ["repeat-a", "repeat-b"],
      messageIndexes: [41, 77],
      score: 69,
      family: "test:neutral",
      count: 6,
    }),
  ]);

  assert.deepEqual(result.awards.map((award) => award.kind), ["premature-celebration", "catchphrase"]);
  assert.ok(result.rejected.some((candidate) => candidate.momentId === "plot-view" && candidate.reason === "overlaps-selected-visible-evidence"));
  assert.ok(result.rejected.some((candidate) => candidate.momentId === "quote-view" && candidate.reason === "overlaps-selected-visible-evidence"));
  assert.ok(result.rejected.some((candidate) => candidate.momentId === "emotion-view" && candidate.reason === "overlaps-selected-visible-evidence"));
});

test("P3.5 does not force weak moments into the final Wrapped", () => {
  const result = composeAwards([
    ranked({
      id: "weak",
      type: "one_liner",
      text: "我先检查一下配置。",
      events: ["weak"],
      score: 31,
    }),
  ]);

  assert.equal(result.awards.length, 0);
  assert.equal(result.rejected[0]?.reason, "below-fun-threshold");
});

test("P3.5 caps output at seven cards even when configured higher", () => {
  const moments = Array.from({ length: 12 }, (_, index) =>
    ranked({
      id: `quote-${index}`,
      type: "one_liner",
      text: `重大进展 ${index}`,
      events: [`event-${index}`],
      score: 90 - index,
      evidence: ["discovery_claim:70"],
    }),
  );

  const result = composeAwards(moments, { maxAwards: 99, maxPerKind: 99 });
  assert.equal(result.awards.length, 7);
  assert.ok(result.rejected.some((candidate) => candidate.reason === "award-limit"));
});
