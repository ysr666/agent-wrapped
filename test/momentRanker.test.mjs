import test from "node:test";
import assert from "node:assert/strict";

import { buildMomentGraph } from "../dist/graph/momentGraph.js";
import { buildMoments } from "../dist/moments/momentBuilder.js";
import { analyzeMoments, rankMoments, scoreMoment } from "../dist/moments/momentRanker.js";

function dsh(text) {
  return { role: "assistant", host: "dsh", text };
}

test("P3 ranks a real before-after boomerang above generic status one-liners", () => {
  const graph = buildMomentGraph([
    dsh("现在问题已经非常明确了。"),
    dsh("我已经确认，可以完全排除缓存。"),
    dsh("继续检查provider。"),
    dsh("最终根因还是缓存。"),
  ]);
  const moments = buildMoments(graph);
  const ranked = rankMoments(graph, moments);
  const boomerang = ranked.find((moment) => moment.type === "boomerang");
  const clarity = ranked.find(
    (moment) => moment.type === "one_liner" && moment.primaryText === "现在问题已经非常明确了。",
  );

  assert.ok(boomerang);
  assert.ok(clarity);
  assert.ok(boomerang.scores.funScore > clarity.scores.funScore);
  assert.ok(boomerang.scores.contextPayoff > clarity.scores.contextPayoff);
  assert.ok(boomerang.scores.surprise > clarity.scores.surprise);
});

test("funScore stays separate from confidence for uncertain but entertaining candidates", () => {
  const graph = buildMomentGraph([
    dsh("我已经确认，可以完全排除缓存。"),
    dsh("最终根因还是缓存。"),
  ]);
  const moments = buildMoments(graph);
  const boomerang = moments.find((moment) => moment.type === "boomerang");
  assert.ok(boomerang);

  const relationIds = new Set(boomerang.relationIds);
  const uncertainGraph = {
    ...graph,
    relations: graph.relations.map((relation) =>
      relationIds.has(relation.id) ? { ...relation, confidence: 20 } : relation,
    ),
  };
  const scores = scoreMoment(uncertainGraph, boomerang, moments);

  assert.ok(scores.funScore >= 70);
  assert.ok(scores.confidence < 55);
  assert.ok(scores.funScore > scores.confidence);
});

test("more repetition increases repeated-pattern entertainment value", () => {
  const shortMessages = [
    dsh("现在问题已经非常明确了。"),
    dsh("问题现在已经很清楚了。"),
  ];
  const longMessages = [
    ...shortMessages,
    dsh("这下问题就非常明确了！"),
    dsh("现在这个问题已经很清楚了。"),
    dsh("问题现在非常明确。"),
  ];

  const shortGraph = buildMomentGraph(shortMessages);
  const longGraph = buildMomentGraph(longMessages);
  const shortMoments = buildMoments(shortGraph);
  const longMoments = buildMoments(longGraph);
  const shortRepeated = rankMoments(shortGraph, shortMoments).find((moment) => moment.type === "repeated_pattern");
  const longRepeated = rankMoments(longGraph, longMoments).find((moment) => moment.type === "repeated_pattern");

  assert.ok(shortRepeated);
  assert.ok(longRepeated);
  assert.equal(shortRepeated.count, 2);
  assert.ok(longRepeated.count >= 4);
  assert.ok(longRepeated.scores.funScore > shortRepeated.scores.funScore);
  assert.ok(longRepeated.scores.contextPayoff > shortRepeated.scores.contextPayoff);
});

test("correction arcs receive strong context payoff rather than relying on one sentence", () => {
  const graph = buildMomentGraph([
    dsh("这次真的找到根因了！！！"),
    dsh("等等，不对，我刚才判断错了。"),
    dsh("真正的根因是缓存。"),
  ]);
  const moments = buildMoments(graph);
  const arc = rankMoments(graph, moments).find((moment) => moment.type === "correction_arc");

  assert.ok(arc);
  assert.equal(arc.eventIds.length, 3);
  assert.ok(arc.scores.contextPayoff >= 70);
  assert.ok(arc.scores.surprise >= 70);
});

test("analyzeMoments runs P0 through P3 and returns descending fun scores", () => {
  const ranked = analyzeMoments([
    dsh("现在问题已经非常明确了。"),
    dsh("这次应该真的没问题了！"),
    dsh("等等，不对，我刚才判断错了。"),
    dsh("重大发现！！！我们前面的路线完全错了！"),
  ]);

  assert.ok(ranked.length > 0);
  for (let index = 1; index < ranked.length; index += 1) {
    assert.ok(ranked[index - 1].scores.funScore >= ranked[index].scores.funScore);
  }
  assert.ok(ranked.some((moment) => moment.type === "false_dawn"));
  assert.ok(ranked.some((moment) => moment.type === "plot_twist"));
});
