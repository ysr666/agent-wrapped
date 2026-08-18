import test from "node:test";
import assert from "node:assert/strict";

import { buildMomentGraph } from "../dist/graph/momentGraph.js";
import { buildMoments } from "../dist/moments/momentBuilder.js";

function dsh(text) {
  return { role: "assistant", host: "dsh", text };
}

function ofType(moments, type) {
  return moments.filter((moment) => moment.type === type);
}

test("P2 builds standalone one-liners without turning them into awards", () => {
  const graph = buildMomentGraph([
    dsh("我先检查配置文件。"),
    dsh("重大发现！！！我们前面的路线完全错了！"),
  ]);
  const moments = buildMoments(graph);
  const oneLiners = ofType(moments, "one_liner");

  assert.ok(oneLiners.some((moment) => moment.primaryText === "重大发现！！！我们前面的路线完全错了！"));
  assert.ok(oneLiners.every((moment) => !Object.hasOwn(moment, "emoji")));
});

test("P2 composes repeated paraphrases into a repeated-pattern moment", () => {
  const graph = buildMomentGraph([
    dsh("现在问题已经非常明确了。"),
    dsh("问题现在已经很清楚了。"),
    dsh("这下问题就非常明确了！"),
  ]);
  const moments = buildMoments(graph);
  const repeated = ofType(moments, "repeated_pattern");

  assert.equal(repeated.length, 1);
  assert.equal(repeated[0].count, 3);
  assert.equal(repeated[0].variants.length, 3);
  assert.deepEqual(repeated[0].messageIndexes, [0, 1, 2]);
});

test("P2 composes contradiction edges into boomerang moments", () => {
  const graph = buildMomentGraph([
    dsh("我已经确认，可以完全排除缓存。"),
    dsh("继续检查provider。"),
    dsh("最终根因还是缓存。"),
  ]);
  const moments = buildMoments(graph);
  const boomerangs = ofType(moments, "boomerang");

  assert.ok(boomerangs.length >= 1);
  assert.equal(boomerangs[0].topic, "cache");
  assert.equal(boomerangs[0].primaryText, "我已经确认，可以完全排除缓存。");
  assert.equal(boomerangs[0].relatedTexts[0], "最终根因还是缓存。");
});

test("P2 composes celebration then reversal into a false-dawn moment", () => {
  const graph = buildMomentGraph([
    dsh("这次应该真的没问题了！"),
    dsh("继续跑测试。"),
    dsh("等等，不对，我刚才判断错了。"),
  ]);
  const moments = buildMoments(graph);
  const falseDawns = ofType(moments, "false_dawn");

  assert.ok(falseDawns.length >= 1);
  assert.equal(falseDawns[0].primaryText, "这次应该真的没问题了！");
  assert.match(falseDawns[0].relatedTexts[0], /不对|判断错/u);
});

test("P2 builds plot twists and three-step correction arcs", () => {
  const graph = buildMomentGraph([
    dsh("我已经确认，根因就是配置。"),
    dsh("等等，不对，我刚才判断错了。"),
    dsh("真正的根因是缓存。"),
  ]);
  const moments = buildMoments(graph);
  const plotTwists = ofType(moments, "plot_twist");
  const arcs = ofType(moments, "correction_arc");

  assert.ok(plotTwists.some((moment) => /不对|判断错/u.test(moment.primaryText)));
  assert.ok(arcs.length >= 1);
  assert.equal(arcs[0].eventIds.length, 3);
  assert.match(arcs[0].primaryText, /不对|判断错/u);
  assert.equal(arcs[0].relatedTexts.length, 2);
});

test("P2 ignores user/tool text because it consumes the P0/P1 graph", () => {
  const graph = buildMomentGraph([
    { role: "user", text: "重大发现！！！我们前面的路线完全错了！" },
    { role: "tool", text: "最终根因还是缓存。" },
    dsh("我先检查配置。"),
  ]);
  const moments = buildMoments(graph);

  assert.ok(moments.every((moment) => !moment.primaryText.includes("重大发现")));
  assert.equal(ofType(moments, "boomerang").length, 0);
});
