import test from "node:test";
import assert from "node:assert/strict";

import {
  extractEventFromText,
  extractEvents,
  getEventStrength,
} from "../dist/events/eventExtractor.js";

function dsh(text) {
  return { role: "assistant", host: "dsh", text };
}

test("extracts several event signals from one dramatic reversal", () => {
  const event = extractEventFromText("重大发现！！！我们前面的路线完全错了！");

  assert.ok(getEventStrength(event, "discovery_claim") >= 50);
  assert.ok(getEventStrength(event, "reversal") >= 70);
  assert.ok(getEventStrength(event, "confidence_claim") >= 50);
  assert.ok(event.drama >= 50);
  assert.ok(event.standaloneQuality >= 60);
});

test("extracts opposite topic claims from a not-X-but-Y statement", () => {
  const event = extractEventFromText("不是缓存，而是配置。" );

  assert.ok(event.claims.some((claim) => claim.topic === "cache" && claim.stance === "exclude"));
  assert.ok(event.claims.some((claim) => claim.topic === "config" && claim.stance === "blame"));
  assert.ok(event.topics.some((topic) => topic.topic === "cache"));
  assert.ok(event.topics.some((topic) => topic.topic === "config"));
});

test("keeps neutral assistant units so later graph stages can still see repetition", () => {
  const event = extractEventFromText("我先继续检查配置加载路径。");

  assert.equal(event.primaryType, "neutral");
  assert.equal(event.normalizedText, "我先继续检查配置加载路径");
  assert.ok(event.simplifiedText.length > 0);
});

test("verbal-family polarity is shared by the event layer", () => {
  const positive = extractEventFromText("现在问题已经很明确了。");
  const negative = extractEventFromText("现在问题还不明确。" );

  assert.equal(positive.verbalFamily, "clarity:positive");
  assert.equal(negative.verbalFamily, "clarity:negative");
});

test("transcript extraction only turns assistant-visible text into events", () => {
  const events = extractEvents([
    { role: "user", text: "重大发现！！！我们前面的路线完全错了！" },
    { role: "tool", text: "最终根因就是缓存。" },
    dsh("我先检查配置文件。"),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].text, "我先检查配置文件。" );
});
