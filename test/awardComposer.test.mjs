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
  variants,
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
    variants: variants ?? (count ? [text] : undefined),
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
      text: "我真是服了。",
      events: ["c1", "c2", "c3"],
      score: 82,
      family: "frustration:positive",
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

test("P3.5 keeps one card for structural views sharing the same episode pivot", () => {
  const result = composeAwards([
    ranked({
      id: "false-dawn",
      type: "false_dawn",
      text: "已经定位并修好了。",
      related: ["你说得对，我刚才诊断错了。"],
      events: ["before", "pivot"],
      score: 95,
    }),
    ranked({
      id: "correction-arc",
      type: "correction_arc",
      text: "你说得对，我刚才诊断错了。",
      related: ["已经定位并修好了。", "现在重新确认。"],
      events: ["before", "pivot", "after"],
      score: 84,
    }),
  ]);

  assert.deepEqual(result.awards.map((award) => award.momentId), ["false-dawn"]);
  assert.ok(result.rejected.some((candidate) =>
    candidate.momentId === "correction-arc" && candidate.reason === "overlaps-selected-episode",
  ));
});

test("P3.5 collapses nearby structural cards with a shared visible anchor", () => {
  const result = composeAwards([
    ranked({
      id: "first-sharp-arc",
      type: "false_dawn",
      text: "已经修好了 sharp 冲突。",
      related: ["你说得对，我诊断错了。"],
      events: ["first-before", "first-pivot"],
      messageIndexes: [101, 103],
      score: 95,
    }),
    ranked({
      id: "second-sharp-arc",
      type: "correction_arc",
      text: "我之前的依赖判断错了，已经撤销。",
      related: ["sharp 的旧判断已经失效。", "重新验证 sharp 加载。"],
      events: ["second-before", "second-pivot", "second-after"],
      messageIndexes: [112],
      score: 84,
    }),
  ]);

  assert.deepEqual(result.awards.map((award) => award.momentId), ["first-sharp-arc"]);
  assert.ok(result.rejected.some((candidate) =>
    candidate.momentId === "second-sharp-arc" && candidate.reason === "overlaps-selected-episode",
  ));
});

test("P3.5 rejects a worklog wait and generic analytical repetition", () => {
  const result = composeAwards([
    ranked({
      id: "worklog-wait",
      type: "repeated_pattern",
      text: "Wait — check the configuration again.",
      events: ["wait-1", "wait-2", "wait-3"],
      score: 90,
      family: "wait-reset:positive",
      count: 8,
      variants: [
        "Wait — check the configuration again.",
        "Wait — verify the test output.",
        "Wait — inspect the renderer.",
      ],
    }),
    ranked({
      id: "generic-clarity",
      type: "repeated_pattern",
      text: "现在问题已经很明确了。",
      events: ["clear-1", "clear-2", "clear-3"],
      score: 88,
      family: "clarity:positive",
      count: 3,
    }),
    ranked({
      id: "dramatic-wait",
      type: "repeated_pattern",
      text: "等等，不对，我刚才判断错了。",
      events: ["turn-1", "turn-2", "turn-3"],
      score: 86,
      family: "wait-reset:positive",
      count: 3,
      variants: [
        "等等，不对，我刚才判断错了。",
        "等等，怎么又冒出一个更严重的问题。",
        "等等，反了，得从头查。",
      ],
    }),
  ]);

  assert.deepEqual(result.awards.map((award) => award.momentId), ["dramatic-wait"]);
  assert.ok(result.rejected.some((candidate) => candidate.momentId === "worklog-wait" && candidate.reason === "not-shareable-repetition"));
  assert.ok(result.rejected.some((candidate) => candidate.momentId === "generic-clarity" && candidate.reason === "not-shareable-repetition"));
});

test("P3.5 rejects an unclassified code-shaped repetition", () => {
  const result = composeAwards([
    ranked({
      id: "camel-case-path",
      type: "repeated_pattern",
      text: "/maxImagePixels?",
      events: ["path-1", "path-2", "path-3"],
      score: 90,
      count: 3,
    }),
  ]);

  assert.equal(result.awards.length, 0);
  assert.ok(result.rejected.some((candidate) =>
    candidate.momentId === "camel-case-path" && candidate.reason === "not-shareable-repetition",
  ));
});

test("P3.5 rejects a repeated routine completion notice", () => {
  const result = composeAwards([
    ranked({
      id: "all-done",
      type: "repeated_pattern",
      text: "全部完成。",
      events: ["done-1", "done-2", "done-3"],
      score: 80,
      count: 3,
    }),
  ]);

  assert.equal(result.awards.length, 0);
  assert.ok(result.rejected.some((candidate) =>
    candidate.momentId === "all-done" && candidate.reason === "not-shareable-repetition",
  ));
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

test("P3.5 never turns formatting or repeated worklog prose into a catchphrase", () => {
  const result = composeAwards([
    ranked({
      id: "table-separator",
      type: "repeated_pattern",
      text: "|---|---|",
      events: ["table-1", "table-2", "table-3"],
      score: 90,
      count: 3,
    }),
    ranked({
      id: "repeated-instructions",
      type: "repeated_pattern",
      text: "打开 package.json，删掉旧依赖，保存重启，再执行上面的安装命令。",
      events: ["instruction-1", "instruction-2", "instruction-3", "instruction-4"],
      score: 88,
      count: 4,
    }),
    ranked({
      id: "natural-tic",
      type: "repeated_pattern",
      text: "先确认一下。",
      events: ["tic-1", "tic-2", "tic-3"],
      score: 70,
      count: 3,
    }),
  ]);

  assert.deepEqual(result.awards.map((award) => award.momentId), ["natural-tic"]);
  assert.ok(result.rejected.some((candidate) => candidate.momentId === "table-separator" && candidate.reason === "not-shareable-repetition"));
  assert.ok(result.rejected.some((candidate) => candidate.momentId === "repeated-instructions" && candidate.reason === "not-shareable-repetition"));
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
