import test from "node:test";
import assert from "node:assert/strict";

import { clusterCatchphraseCandidates } from "../dist/core/catchphraseClusterer.js";
import { analyzeSession } from "../dist/core/sessionAnalyzer.js";
import { detectVerbalFamily } from "../dist/events/lexicon.js";
import { createWrappedReport } from "../dist/wrapped/wrappedReport.js";

function item(text, messageIndex) {
  return { text, messageIndex };
}

function dsh(text) {
  return { role: "assistant", host: "dsh", text };
}

test("clusters DSH clarity paraphrases into one catchphrase family", () => {
  const clusters = clusterCatchphraseCandidates([
    item("现在问题已经非常明确了。", 0),
    item("问题现在已经很清楚了。", 2),
    item("这下问题就非常明确了！", 5),
    item("我先检查一下配置文件。", 7),
  ], { minCount: 2 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 3);
  assert.equal(clusters[0].family, "clarity:positive");
  assert.deepEqual(clusters[0].messageIndexes, [0, 2, 5]);
  assert.equal(clusters[0].variants.length, 3);
  assert.ok(clusters[0].confidence >= 90);
});

test("clusters root-cause declarations even when wording changes", () => {
  const clusters = clusterCatchphraseCandidates([
    item("这次真的找到根因了！！！", 0),
    item("真正的根因已经确认了！", 4),
    item("终于定位到根因了！！！", 8),
  ], { minCount: 2 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 3);
  assert.equal(clusters[0].family, "root-cause-found:positive");
});

test("root-cause repetition excludes generic problem confirmation from its count and examples", () => {
  for (const text of ["两个问题确认下：", "确认这个分支名没问题。", "Found a real plugin bug."]) {
    assert.notEqual(detectVerbalFamily(text), "root-cause-found:positive");
  }

  const report = createWrappedReport([
    dsh("两个问题确认下："),
    dsh("这次真的找到根因了。"),
    dsh("确认这个分支名没问题。"),
    dsh("真正的原因已经定位到了。"),
    dsh("再对照测一下版本差异。"),
    dsh("根因锁定：是配置覆盖。"),
  ]);
  const wolf = report.awards.find((award) => award.kind === "wolf-cry");

  assert.ok(wolf);
  assert.equal(wolf.count, 3);
  assert.equal(wolf.variants?.length, 3);
  assert.ok(wolf.variants?.every((text) => /根因|原因/u.test(text)));
});

test("clusters common Claude/Codex-style English verbal tics", () => {
  const waitClusters = clusterCatchphraseCandidates([
    item("Wait, I see the problem now.", 0),
    item("Hold on — the issue is different than I thought.", 4),
  ], { minCount: 2 });

  assert.equal(waitClusters.length, 1);
  assert.equal(waitClusters[0].family, "wait-reset:positive");

  const rootCauseClusters = clusterCatchphraseCandidates([
    item("I found the root cause!", 0),
    item("Root cause confirmed: state reset.", 3),
  ], { minCount: 2 });

  assert.equal(rootCauseClusters.length, 1);
  assert.equal(rootCauseClusters[0].family, "root-cause-found:positive");
});

test("keeps opposite clarity polarity out of the same family", () => {
  const clusters = clusterCatchphraseCandidates([
    item("现在问题已经很明确了。", 0),
    item("现在问题还不明确。", 1),
    item("The problem is clear now.", 2),
    item("The problem is not clear yet.", 3),
  ], { minCount: 1 });

  const positive = clusters.find((cluster) => cluster.family === "clarity:positive");
  const negative = clusters.find((cluster) => cluster.family === "clarity:negative");
  assert.ok(positive);
  assert.ok(negative);
  assert.equal(positive.count, 2);
  assert.equal(negative.count, 2);
});

test("conservative fuzzy matching merges near duplicates outside known families", () => {
  const clusters = clusterCatchphraseCandidates([
    item("我先继续检查配置加载路径", 0),
    item("我继续检查配置加载路径", 3),
    item("接下来分析数据库事务", 5),
  ], { minCount: 2 });

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].count, 2);
  assert.ok(clusters[0].key.startsWith("fuzzy:"));
});

test("SessionAnalyzer uses clustered paraphrases for the catchphrase award", () => {
  const result = analyzeSession([
    dsh("现在问题已经非常明确了。"),
    dsh("问题现在已经很清楚了。"),
    dsh("这下问题就非常明确了！"),
    dsh("等等，不对，我们前面一直把现象当成根因了。"),
  ]);

  assert.equal(result.byKind.catchphrase?.count, 3);
  assert.equal(result.byKind.catchphrase?.clusterFamily, "clarity:positive");
  assert.equal(result.byKind.catchphrase?.variants?.length, 3);
  assert.notEqual(result.byKind.quote?.text, result.byKind.catchphrase?.text);
  assert.equal(result.metrics.repeatedPhraseGroups, 1);
});

test("SessionAnalyzer treats varied root-cause announcements as repeated wolf-cry material", () => {
  const result = analyzeSession([
    dsh("这次真的找到根因了！！！"),
    dsh("真正的根因已经确认了！"),
    dsh("终于定位到根因了！！！"),
    dsh("等等，不对，我们刚才判断错了。"),
  ]);

  assert.ok(result.byKind["wolf-cry"]);
  assert.ok((result.byKind["wolf-cry"]?.count ?? 0) >= 3);
  assert.ok((result.byKind["wolf-cry"]?.variants?.length ?? 0) >= 3);
});
