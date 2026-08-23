import assert from "node:assert/strict";
import test from "node:test";

import { createWrappedUiPayload } from "../dist/composer/uiPayload.js";

function generatedFixture(cards) {
  return {
    session: {
      id: "durable-private-session-id",
      host: "dsh",
      title: "为什么每次都先说这句",
      model: "deepseek-v4-pro",
      messages: [],
      events: [{
        id: "raw-tool",
        host: "dsh",
        actor: "tool",
        kind: "tool_result",
        order: 1,
        metadata: { toolArguments: "SOURCE_SENTINEL", toolResult: "RESULT_SENTINEL" },
      }],
      diagnostics: [],
    },
    awardReport: { version: 1, locale: "zh-CN", title: "", awards: [], metrics: {}, diagnostics: {} },
    semanticReport: { version: 3, locale: "zh-CN", sessionId: "durable-private-session-id", stories: [], personaSignals: [], evidenceUsed: [] },
    semanticEvidence: {
      version: 2,
      sessionId: "durable-private-session-id",
      host: "dsh",
      locale: "zh-CN",
      events: [
        { id: "tool-safe", order: 1, actor: "tool", kind: "tool_result", toolName: "shell", toolCategory: "mutation", outcome: "failure", exitCode: 1 },
        { id: "user-safe", order: 2, actor: "user", kind: "user_message", text: "怎么又失败了？" },
      ],
      windows: [],
      momentHints: [],
      redactionCount: 0,
      truncated: false,
    },
    report: {
      version: 1,
      locale: "zh-CN",
      sessionId: "durable-private-session-id",
      cards,
      diagnostics: { sourceAwards: 0, sourceStories: 0, groupedStoryEpisodes: 0, sourcePersona: false, suppressed: [] },
    },
  };
}

test("UI payload exposes the strongest real card without raw tool payloads or durable ids", () => {
  const award = {
    id: "award-1",
    kind: "catchphrase",
    title: "高频口癖",
    emoji: "📢",
    momentId: "moment-1",
    sourceType: "repeated_pattern",
    messageIndexes: [0, 1, 2],
    primaryText: "这是我的坏习惯。",
    relatedTexts: [],
    count: 3,
    funScore: 88,
    confidence: 94,
    scores: {},
    evidence: [],
  };
  const payload = createWrappedUiPayload(generatedFixture([{
    id: "card:award:1",
    type: "award",
    awardKind: "catchphrase",
    score: 88,
    confidence: 94,
    title: "📢 高频口癖",
    award,
  }]), { publicSessionId: "abc123def456" });

  assert.equal(payload.sessionId, "abc123def456");
  assert.equal(payload.strongest?.title, "这是我的坏习惯。 ×3");
  assert.equal(payload.cards.length, 1);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /durable-private-session-id|SOURCE_SENTINEL|RESULT_SENTINEL/u);
});

test("UI story evidence uses only redacted semantic text and structural tool summaries", () => {
  const story = {
    id: "story-1",
    windowId: "window-1",
    arcKind: "failure_then_workaround",
    beats: [
      { kind: "failure", evidenceIds: ["tool-safe"] },
      { kind: "user_pushback", evidenceIds: ["user-safe"] },
    ],
    evidenceIds: ["tool-safe", "user-safe"],
    confidence: "high",
  };
  const payload = createWrappedUiPayload(generatedFixture([{
    id: "card:story:1",
    type: "story",
    arcKind: "failure_then_workaround",
    storyIds: ["story-1"],
    stories: [story],
    episodeCount: 1,
    score: 70,
    confidence: 95,
    title: "这条路不通，换一条",
  }]), { publicSessionId: "abc123def456" });

  assert.deepEqual(payload.cards[0].evidence, [
    { actor: "tool", text: "shell (mutation, failure, exit 1)" },
    { actor: "user", text: "怎么又失败了？" },
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /SOURCE_SENTINEL|RESULT_SENTINEL/u);
});

test("UI payload preserves honest no-story sessions", () => {
  const payload = createWrappedUiPayload(generatedFixture([]), { publicSessionId: "abc123def456" });
  assert.equal(payload.strongest, undefined);
  assert.equal(payload.cards.length, 0);
  assert.equal(payload.emptyMessage, "这场暂时没有强到值得上榜的名场面。");
});

test("UI false dawn leads with the grounded boast and immediate puncture", () => {
  const fixture = generatedFixture([{
    id: "card:story:false-dawn",
    type: "story",
    arcKind: "false_dawn",
    storyIds: ["story:false-dawn"],
    stories: [{
      id: "story:false-dawn",
      windowId: "window:false-dawn",
      arcKind: "false_dawn",
      beats: [
        { kind: "claim", evidenceIds: ["claim"] },
        { kind: "failure", evidenceIds: ["puncture"] },
      ],
      evidenceIds: ["claim", "puncture"],
      confidence: "high",
    }],
    episodeCount: 1,
    score: 88,
    confidence: 95,
    title: "香槟开早了",
  }]);
  fixture.semanticEvidence.events.push(
    { id: "claim", order: 3, actor: "assistant", kind: "assistant_text", text: "OK，完美，这次已经彻底修好了。" },
    { id: "puncture", order: 4, actor: "user", kind: "user_message", text: "等等，同一个测试还是失败。" },
  );

  const payload = createWrappedUiPayload(fixture, { publicSessionId: "abc123def456" });
  assert.equal(payload.cards[0].title, "“OK，完美，这次已经彻底修好了。”");
  assert.equal(payload.cards[0].body, "下一条：等等，同一个测试还是失败。");
});
