import test from "node:test";
import assert from "node:assert/strict";

import {
  composeWrappedCards,
  generateComposedWrapped,
  renderComposedWrappedText,
} from "../dist/index.js";

function scores(funScore = 90) {
  return {
    funScore,
    confidence: 94,
    standaloneQuality: 90,
    contextPayoff: 90,
    surprise: 90,
    rarity: 80,
    readability: 90,
    structuralStrength: 94,
  };
}

function award(overrides = {}) {
  return {
    id: "award:premature",
    kind: "premature-celebration",
    title: "香槟开早了",
    emoji: "🍾",
    momentId: "false_dawn:m0->m1",
    sourceType: "false_dawn",
    messageIndexes: [0, 1],
    primaryText: "这次已经修好了。",
    relatedTexts: ["还是失败。"],
    funScore: 92,
    confidence: 94,
    scores: scores(92),
    evidence: ["celebration followed by reversal"],
    ...overrides,
  };
}

function awardReport(awards = []) {
  return {
    version: 1,
    locale: "zh-CN",
    title: "今晚的 Agent Wrapped",
    awards,
    metrics: {
      messages: 0,
      assistantMessages: 0,
      events: 0,
      relations: 0,
      momentCandidates: 0,
      rankedMoments: 0,
      awards: awards.length,
      topFunScore: awards[0]?.funScore ?? 0,
    },
    diagnostics: { rejectedAwards: [] },
  };
}

function semanticEvidence(sessionId, events, windows = []) {
  return {
    version: 2,
    sessionId,
    host: "dsh",
    locale: "zh-CN",
    events,
    windows,
    momentHints: [],
    redactionCount: 0,
    truncated: false,
  };
}

function semanticReport(sessionId, stories, extra = {}) {
  return {
    version: 3,
    locale: "zh-CN",
    sessionId,
    stories,
    personaSignals: [],
    evidenceUsed: stories.flatMap((story) => story.evidenceIds),
    ...extra,
  };
}

test("Wrapped Composer keeps one card for P4/P8 views of the same episode", () => {
  const session = {
    id: "duplicate-routes",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "assistant", host: "dsh", text: "这次已经修好了。" },
      { role: "user", host: "dsh", text: "还是失败。" },
    ],
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "这次已经修好了。" },
      { id: "failure", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "还是失败。" },
    ],
  };
  const story = {
    id: "story:0",
    windowId: "window:0",
    arcKind: "false_dawn",
    beats: [
      { kind: "claim", evidenceIds: ["event:claim"] },
      { kind: "failure", evidenceIds: ["event:failure"] },
    ],
    evidenceIds: ["event:claim", "event:failure"],
    confidence: "high",
  };
  const evidence = semanticEvidence(session.id, [
    { id: "event:claim", order: 0, actor: "assistant", kind: "assistant_text", text: "这次已经修好了。" },
    { id: "event:failure", order: 1, actor: "user", kind: "user_message", text: "还是失败。" },
  ]);
  const report = composeWrappedCards(
    session,
    awardReport([award()]),
    semanticReport(session.id, [story]),
    evidence,
  );

  assert.equal(report.cards.length, 1);
  assert.equal(report.cards[0].type, "award");
  assert.ok(report.diagnostics.suppressed.some((entry) =>
    entry.reason === "cross-route-duplicate" && entry.winnerId === report.cards[0].id
  ));
});

test("Wrapped Composer groups repeated arcs by episode, never by beat count", () => {
  const session = {
    id: "repeated-finales",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "assistant", host: "dsh", text: "本轮闭环完成。" },
      { role: "user", host: "dsh", text: "等下，又有一个 bug。" },
      { role: "assistant", host: "dsh", text: "发布闭环完成。" },
      { role: "user", host: "dsh", text: "再排查一个问题。" },
    ],
    events: [
      { id: "close-1", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0 },
      { id: "reopen-1", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1 },
      { id: "close-2", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2 },
      { id: "reopen-2", host: "dsh", actor: "user", kind: "user_message", order: 3, messageIndex: 3 },
    ],
  };
  const stories = [0, 1].map((index) => ({
    id: `story:${index}`,
    windowId: `window:${index}`,
    arcKind: "ending_then_more_work",
    beats: [
      { kind: "claim", evidenceIds: [`event:close-${index + 1}`] },
      { kind: "work_reopened", evidenceIds: [`event:reopen-${index + 1}`] },
    ],
    evidenceIds: [`event:close-${index + 1}`, `event:reopen-${index + 1}`],
    confidence: "medium",
  }));
  const evidence = semanticEvidence(session.id, [
    { id: "event:close-1", order: 0, actor: "assistant", kind: "assistant_text", text: "本轮闭环完成。" },
    { id: "event:reopen-1", order: 1, actor: "user", kind: "user_message", text: "等下，又有一个 bug。" },
    { id: "event:close-2", order: 2, actor: "assistant", kind: "assistant_text", text: "发布闭环完成。" },
    { id: "event:reopen-2", order: 3, actor: "user", kind: "user_message", text: "再排查一个问题。" },
  ]);
  const grouped = composeWrappedCards(session, awardReport(), semanticReport(session.id, stories), evidence);

  assert.equal(grouped.cards.length, 1);
  assert.equal(grouped.cards[0].type, "story");
  assert.equal(grouped.cards[0].episodeCount, 2);
  assert.equal(grouped.cards[0].storyIds.length, 2);
  assert.match(grouped.cards[0].title, /× 2/u);
  assert.match(grouped.cards[0].commentary, /2 次大结局/u);
  const rendered = renderComposedWrappedText(grouped, evidence, { includeScores: true });
  assert.match(rendered, /宣布收尾以后，工作又来了 × 2/u);
  assert.match(rendered, /第 1 幕/u);
  assert.match(rendered, /第 2 幕/u);
  assert.match(rendered, /赛后解说：一个 session，2 次大结局/u);
  assert.match(rendered, /好玩度 89 · 置信度 82/u);

  const fourBeatStory = {
    ...stories[0],
    id: "story:four-beats",
    beats: [
      { kind: "claim", evidenceIds: ["event:close-1"] },
      { kind: "attempt", evidenceIds: ["event:close-1"] },
      { kind: "failure", evidenceIds: ["event:reopen-1"] },
      { kind: "work_reopened", evidenceIds: ["event:reopen-1"] },
    ],
  };
  const single = composeWrappedCards(
    session,
    awardReport(),
    semanticReport(session.id, [fourBeatStory]),
    evidence,
  );
  assert.equal(single.cards[0].type, "story");
  assert.equal(single.cards[0].episodeCount, 1);
});

test("composed renderer never prints raw tool payload text", () => {
  const session = {
    id: "safe-tool-render",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "call", host: "dsh", actor: "assistant", kind: "tool_call", order: 0, toolName: "bash", toolCategory: "mutation" },
      { id: "result", host: "dsh", actor: "tool", kind: "tool_result", order: 1, toolName: "bash", outcome: "failure", exitCode: 1 },
    ],
  };
  const story = {
    id: "story:safe",
    windowId: "window:safe",
    arcKind: "reversal",
    beats: [
      { kind: "attempt", evidenceIds: ["event:call"] },
      { kind: "failure", evidenceIds: ["event:result"] },
    ],
    evidenceIds: ["event:call", "event:result"],
    confidence: "high",
  };
  const evidence = semanticEvidence(session.id, [
    { id: "event:call", order: 0, actor: "assistant", kind: "tool_call", toolName: "bash", toolCategory: "mutation", text: "SOURCE_SENTINEL" },
    { id: "event:result", order: 1, actor: "tool", kind: "tool_result", toolName: "bash", outcome: "failure", exitCode: 1, text: "RESULT_SENTINEL" },
  ]);
  const report = composeWrappedCards(session, awardReport(), semanticReport(session.id, [story]), evidence);
  const rendered = renderComposedWrappedText(report, evidence);

  assert.match(rendered, /bash \(mutation\)/u);
  assert.match(rendered, /bash \(failure, exit 1\)/u);
  assert.doesNotMatch(rendered, /SOURCE_SENTINEL|RESULT_SENTINEL/u);
});

test("composed renderer keeps the punchline ahead of long technical evidence", () => {
  const session = {
    id: "shareable-story",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [],
  };
  const story = {
    id: "story:shareable",
    windowId: "window:shareable",
    arcKind: "false_dawn",
    beats: [
      { kind: "claim", evidenceIds: ["event:claim"] },
      { kind: "user_pushback", evidenceIds: ["event:pushback"] },
    ],
    evidenceIds: ["event:claim", "event:pushback"],
    confidence: "high",
  };
  const evidence = semanticEvidence(session.id, [
    {
      id: "event:claim",
      order: 0,
      actor: "assistant",
      kind: "assistant_text",
      text: "修好了 ✅ **根因已经彻底确认**：`conditionalHook()` 的调用顺序在复杂配置下发生变化，并且逐项核对了所有配置分支与运行状态。后面还有一整段不适合占满分享卡片的技术分析。",
    },
    {
      id: "event:pushback",
      order: 1,
      actor: "user",
      kind: "user_message",
      text: "我选不了供应商",
    },
  ]);
  const report = composeWrappedCards(session, awardReport(), semanticReport(session.id, [story]), evidence);
  const rendered = renderComposedWrappedText(report, evidence);
  const claimLine = rendered.split("\n").find((line) => line.includes("下结论"));

  assert.ok(claimLine);
  assert.ok(claimLine.length <= 85, `claim line should stay compact: ${claimLine}`);
  assert.match(rendered, /修好了 ✅ 根因已经彻底确认：conditionalHook\(\)/u);
  assert.match(rendered, /用户打脸 — 我选不了供应商/u);
  assert.doesNotMatch(rendered, /\*\*|`|一整段不适合/u);
});

test("Wrapped Composer does not force filler cards or an unsupported persona", () => {
  const session = {
    id: "ordinary-session",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [{ role: "assistant", host: "dsh", text: "我先检查配置。" }],
  };
  const evidence = semanticEvidence(session.id, []);
  const empty = composeWrappedCards(session, awardReport(), semanticReport(session.id, []), evidence);
  assert.equal(empty.cards.length, 0);

  const weakPersona = semanticReport(session.id, [], {
    personaSignals: [{ key: "dramaticity", label: "内心戏", count: 1, level: "low", evidenceIds: [] }],
    narration: {
      storyCards: [],
      persona: { label: "本场表现像侦探", tagline: "检查了一次配置。" },
    },
  });
  const composed = composeWrappedCards(session, awardReport(), weakPersona, evidence);
  assert.equal(composed.cards.length, 0);
  assert.ok(composed.diagnostics.suppressed.some((entry) => entry.reason === "weak-persona"));
});

test("Wrapped Composer removes unreadable correction prose and a Persona that repeats the Story joke", () => {
  const session = {
    id: "clean-final-show",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "user", host: "dsh", text: "你第一轮竟然没看图。" },
      { role: "assistant", host: "dsh", text: "第一轮没看是我的失误。" },
    ],
    events: [
      { id: "pushback", host: "dsh", actor: "user", kind: "user_message", order: 0, messageIndex: 0, text: "你第一轮竟然没看图。" },
      { id: "admission", host: "dsh", actor: "assistant", kind: "assistant_text", order: 1, messageIndex: 1, text: "第一轮没看是我的失误。" },
    ],
  };
  const story = {
    id: "story:callout",
    windowId: "window:callout",
    arcKind: "user_pushback_then_recovery",
    beats: [
      { kind: "user_pushback", evidenceIds: ["event:pushback"] },
      { kind: "correction", evidenceIds: ["event:admission"] },
    ],
    evidenceIds: ["event:pushback", "event:admission"],
    confidence: "high",
  };
  const evidence = semanticEvidence(session.id, [
    { id: "event:pushback", order: 0, actor: "user", kind: "user_message", text: "你第一轮竟然没看图。" },
    { id: "event:admission", order: 1, actor: "assistant", kind: "assistant_text", text: "第一轮没看是我的失误。" },
  ]);
  const technicalCorrection = award({
    id: "award:broken-correction",
    kind: "plot-twist",
    sourceType: "correction_arc",
    primaryText: "我之前改错了对象。",
    relatedTexts: ["找到了——设置页里这条**「无法读取图片能力声明。", "现在把**真正目标**修好了。"],
    messageIndexes: [],
    funScore: 85,
  });
  const report = composeWrappedCards(
    session,
    awardReport([technicalCorrection]),
    semanticReport(session.id, [story], {
      personaSignals: [{ key: "self_correction", label: "自我纠错", count: 2, level: "medium", evidenceIds: story.evidenceIds }],
      narration: {
        storyCards: [{
          storyId: story.id,
          title: "用户指路才看路，认错倒是快",
          commentary: "被指出第一轮没看图后立刻认错，反应速度堪比职业运动员",
        }],
        persona: {
          label: "本场表现像被裁判吹哨才回头的足球后卫",
          tagline: "被指出失误后立即认错，没有第二次辩解",
        },
      },
    }),
    evidence,
  );

  assert.deepEqual(report.cards.map((card) => card.type), ["story"]);
  assert.ok(report.diagnostics.suppressed.some((entry) =>
    entry.id.includes("broken-correction") && entry.reason === "unreadable-card"
  ));
  assert.ok(report.diagnostics.suppressed.some((entry) =>
    entry.id === "card:persona" && entry.reason === "editorial-duplicate" && entry.winnerId === report.cards[0].id
  ));
});

test("Wrapped Composer keeps a Persona whose character metaphor adds a different joke", () => {
  const session = {
    id: "distinct-persona",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [],
  };
  const story = {
    id: "story:finale",
    windowId: "window:finale",
    arcKind: "false_dawn",
    beats: [],
    evidenceIds: [],
    confidence: "high",
  };
  const evidence = semanticEvidence(session.id, []);
  const report = composeWrappedCards(
    session,
    awardReport(),
    semanticReport(session.id, [story], {
      personaSignals: [{ key: "premature_certainty", label: "过早确定", count: 2, level: "high", evidenceIds: [] }],
      narration: {
        storyCards: [{ storyId: story.id, title: "香槟开早了 × 2", commentary: "一个 session，2 次大结局。" }],
        persona: { label: "本场表现像提前庆祝的足球运动员", tagline: "两次宣告修好，两次被用户指出问题仍在。" },
      },
    }),
    evidence,
  );

  assert.deepEqual(report.cards.map((card) => card.type), ["story", "persona"]);
});

test("Wrapped Composer caps the final highlight reel at five cards", () => {
  const session = {
    id: "many-candidates",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: Array.from({ length: 6 }, (_, index) => ({
      role: "assistant",
      host: "dsh",
      text: `独立金句 ${index}：这是一段足够长而且互不重复的候选台词。`,
    })),
  };
  const awards = Array.from({ length: 6 }, (_, index) => award({
    id: `award:${index}`,
    kind: "quote",
    messageIndexes: [index],
    primaryText: session.messages[index].text,
    relatedTexts: [],
    funScore: 90 - index,
  }));
  const composed = composeWrappedCards(
    session,
    awardReport(awards),
    semanticReport(session.id, []),
    semanticEvidence(session.id, []),
  );

  assert.equal(composed.cards.length, 5);
  assert.equal(composed.diagnostics.suppressed.filter((entry) => entry.reason === "card-limit").length, 1);
});

test("generateComposedWrapped runs both candidate routes and returns the final card set", async () => {
  const session = {
    id: "composed-end-to-end",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "assistant", host: "dsh", text: "本轮排查闭环完成。" },
      { role: "user", host: "dsh", text: "等下，又有一个 bug 要看。" },
    ],
    events: [
      { id: "close", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "本轮排查闭环完成。" },
      { id: "reopen", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "等下，又有一个 bug 要看。" },
    ],
  };
  const generated = await generateComposedWrapped(session, { async generate() { return "{}"; } }, {
    semantic: { coverageWindows: 0 },
  });

  assert.equal(generated.awardReport.awards.length, 0);
  assert.equal(generated.semanticReport.stories.length, 1);
  assert.equal(generated.report.cards.length, 1);
  assert.equal(generated.report.cards[0].type, "story");
});
