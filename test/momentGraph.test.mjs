import test from "node:test";
import assert from "node:assert/strict";

import { buildMomentGraph, relationsOfType } from "../dist/graph/momentGraph.js";
import { clusterRepetitionEvents } from "../dist/graph/repetition.js";

function dsh(text) {
  return { role: "assistant", host: "dsh", text };
}

test("builds repetition relations and clusters DSH paraphrases", () => {
  const graph = buildMomentGraph([
    dsh("现在问题已经非常明确了。"),
    dsh("问题现在已经很清楚了。"),
    dsh("这下问题就非常明确了！"),
    dsh("我先检查配置文件。"),
  ]);

  const clusters = clusterRepetitionEvents(graph.events, graph.relations, 2);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 3);
  assert.equal(clusters[0].family, "clarity:positive");
  assert.ok(relationsOfType(graph, "similar_to").length >= 2);
});

test("keeps opposite-polarity verbal families separate", () => {
  const graph = buildMomentGraph([
    dsh("现在问题已经很明确了。"),
    dsh("现在问题还不明确。"),
  ]);

  assert.equal(clusterRepetitionEvents(graph.events, graph.relations, 2).length, 0);
});

test("connects same-topic opposite claims with a contradiction edge", () => {
  const graph = buildMomentGraph([
    dsh("我已经确认，可以完全排除缓存。"),
    dsh("继续检查provider。"),
    dsh("重大发现！！！最终根因还是缓存。"),
  ]);

  const contradictions = relationsOfType(graph, "contradicts");
  assert.ok(contradictions.length >= 1);
  assert.equal(contradictions[0].topic, "cache");
  assert.equal(contradictions[0].fromStance, "exclude");
  assert.equal(contradictions[0].toStance, "blame");
  assert.ok(contradictions[0].strength >= 70);
  assert.ok(relationsOfType(graph, "same_topic").some((edge) => edge.topic === "cache"));
});

test("adds retracts when the later same-topic contradiction explicitly self-corrects", () => {
  const graph = buildMomentGraph([
    dsh("可以完全排除缓存。"),
    dsh("继续检查。"),
    dsh("等等，不对，我刚才判断错了；最终根因还是缓存。"),
  ]);

  const retracts = relationsOfType(graph, "retracts");
  assert.ok(retracts.some((edge) => edge.topic === "cache"));
});

test("builds chronological and premature-celebration relations", () => {
  const graph = buildMomentGraph([
    dsh("这次应该真的没问题了！"),
    dsh("继续跑测试。"),
    dsh("等等，不对，我刚才判断错了；写路径还是坏的。"),
  ]);

  assert.equal(relationsOfType(graph, "followed_by").length, graph.events.length - 1);
  const falseDawns = relationsOfType(graph, "celebrates_before");
  assert.ok(falseDawns.length >= 1);
  assert.ok(falseDawns[0].distance <= 18);
});

test("user and tool content never becomes graph events", () => {
  const graph = buildMomentGraph([
    { role: "user", text: "可以完全排除缓存。" },
    { role: "tool", text: "最终根因还是缓存。" },
    dsh("我先检查配置。"),
  ]);

  assert.equal(graph.events.length, 1);
  assert.equal(relationsOfType(graph, "contradicts").length, 0);
});
