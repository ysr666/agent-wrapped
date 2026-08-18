import test from "node:test";
import assert from "node:assert/strict";

import { detectBoomerangs, extractBoomerangClaims } from "../dist/core/boomerangDetector.js";
import { analyzeSession } from "../dist/core/sessionAnalyzer.js";

function dsh(text) {
  return { role: "assistant", host: "dsh", text };
}

function assistant(text, host = "unknown") {
  return { role: "assistant", host, text };
}

test("detects the classic Chinese rule-out to root-cause boomerang", () => {
  const matches = detectBoomerangs([
    dsh("我已经确认，可以完全排除缓存。"),
    dsh("我继续检查provider注册。"),
    dsh("重大发现！！！最终根因还是缓存。"),
  ]);

  assert.ok(matches.length >= 1);
  assert.equal(matches[0].topic, "cache");
  assert.equal(matches[0].beforeText, "我已经确认，可以完全排除缓存。");
  assert.equal(matches[0].afterText, "重大发现！！！最终根因还是缓存。");
  assert.equal(matches[0].beforeClaim.stance, "exclude");
  assert.equal(matches[0].afterClaim.stance, "blame");
  assert.ok(matches[0].score >= 70);
});

test("normalizes English cache aliases across different wording", () => {
  const matches = detectBoomerangs([
    assistant("We can definitely rule out caching.", "codex"),
    assistant("I will inspect the request path next.", "codex"),
    assistant("The root cause is the cache layer.", "codex"),
  ]);

  assert.ok(matches.length >= 1);
  assert.equal(matches[0].topic, "cache");
  assert.equal(matches[0].beforeMessageIndex, 0);
  assert.equal(matches[0].afterMessageIndex, 2);
});

test("supports conservative generic topics outside the built-in alias list", () => {
  const matches = detectBoomerangs([
    assistant("We can rule out middleware.", "claude-code"),
    assistant("The root cause is middleware behavior.", "claude-code"),
  ]);

  assert.ok(matches.length >= 1);
  assert.equal(matches[0].topic, "generic:middleware");
  assert.equal(matches[0].topicLabel, "middleware");
});

test("extracts both sides of a not-X-but-Y contrast without inventing a same-message boomerang", () => {
  const messages = [
    dsh("不是缓存，而是配置。"),
    dsh("继续验证。"),
    dsh("结果根因还是缓存。"),
  ];
  const claims = extractBoomerangClaims(messages);

  assert.ok(claims.some((claim) => claim.topic === "cache" && claim.stance === "exclude"));
  assert.ok(claims.some((claim) => claim.topic === "config" && claim.stance === "blame"));

  const matches = detectBoomerangs(messages);
  assert.ok(matches.some((match) => match.topic === "cache"));
  assert.ok(matches.every((match) => match.beforeMessageIndex !== match.afterMessageIndex));
});

test("does not pair confident claims about different topics", () => {
  const matches = detectBoomerangs([
    dsh("现在可以完全排除缓存。"),
    dsh("最终根因就是provider。"),
  ]);

  assert.equal(matches.length, 0);
});

test("does not treat repeated same-direction claims as a contradiction", () => {
  const matches = detectBoomerangs([
    dsh("根因就是缓存。"),
    dsh("最终根因还是缓存。"),
  ]);

  assert.equal(matches.length, 0);
});

test("respects the boomerang message-distance window", () => {
  const messages = [
    dsh("可以完全排除缓存。"),
    dsh("继续检查。"),
    dsh("继续检查。"),
    dsh("继续检查。"),
    dsh("最终根因还是缓存。"),
  ];

  assert.equal(detectBoomerangs(messages, { maxMessageDistance: 2 }).length, 0);
  assert.ok(detectBoomerangs(messages, { maxMessageDistance: 8 }).length >= 1);
});

test("user and tool statements cannot create an assistant boomerang", () => {
  const matches = detectBoomerangs([
    { role: "user", text: "可以完全排除缓存。" },
    { role: "tool", text: "根因就是缓存。" },
    dsh("我先检查配置文件。"),
  ]);

  assert.equal(matches.length, 0);
});

test("SessionAnalyzer exposes the biggest boomerang as a paired award", () => {
  const result = analyzeSession([
    dsh("现在问题已经非常明确了。"),
    dsh("我已经确认，可以完全排除缓存。"),
    dsh("这次真的找到根因了！！！"),
    dsh("等等，不对。"),
    dsh("最终根因还是缓存。"),
  ]);

  const award = result.byKind.boomerang;
  assert.ok(award);
  assert.equal(award.emoji, "🤡");
  assert.equal(award.topic, "cache");
  assert.equal(award.text, "我已经确认，可以完全排除缓存。");
  assert.equal(award.relatedText, "最终根因还是缓存。");
  assert.deepEqual(award.messageIndexes, [1, 4]);
  assert.ok(result.metrics.boomerangMoments >= 1);
});
