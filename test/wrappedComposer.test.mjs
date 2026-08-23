import test from "node:test";
import assert from "node:assert/strict";

import {
  composeWrappedCards,
  generateComposedWrapped,
  hasGroundedComedicTension,
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

test("Wrapped Composer groups repeated funny arcs by episode, never by beat count", () => {
  const session = {
    id: "repeated-finales",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "assistant", host: "dsh", text: "这次已经彻底修好了。" },
      { role: "user", host: "dsh", text: "测试还是失败。" },
      { role: "assistant", host: "dsh", text: "现在问题已经完全解决。" },
      { role: "user", host: "dsh", text: "同一个测试又失败了。" },
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
    arcKind: "false_dawn",
    beats: [
      { kind: "claim", evidenceIds: [`event:close-${index + 1}`] },
      { kind: "failure", evidenceIds: [`event:reopen-${index + 1}`] },
    ],
    evidenceIds: [`event:close-${index + 1}`, `event:reopen-${index + 1}`],
    confidence: "medium",
  }));
  const evidence = semanticEvidence(session.id, [
    { id: "event:close-1", order: 0, actor: "assistant", kind: "assistant_text", text: "这次已经彻底修好了。" },
    { id: "event:reopen-1", order: 1, actor: "user", kind: "user_message", text: "测试还是失败。" },
    { id: "event:close-2", order: 2, actor: "assistant", kind: "assistant_text", text: "现在问题已经完全解决。" },
    { id: "event:reopen-2", order: 3, actor: "user", kind: "user_message", text: "同一个测试又失败了。" },
  ]);
  const grouped = composeWrappedCards(session, awardReport(), semanticReport(session.id, stories), evidence);

  assert.equal(grouped.cards.length, 1);
  assert.equal(grouped.cards[0].type, "story");
  assert.equal(grouped.cards[0].episodeCount, 2);
  assert.equal(grouped.cards[0].storyIds.length, 2);
  assert.match(grouped.cards[0].title, /香槟开早了 × 2/u);
  assert.match(grouped.cards[0].commentary, /2 次大结局/u);
  const rendered = renderComposedWrappedText(grouped, evidence, { includeScores: true });
  assert.match(rendered, /香槟开早了 × 2/u);
  assert.match(rendered, /第 1 幕/u);
  assert.match(rendered, /第 2 幕/u);
  assert.match(rendered, /赛后解说：一个 session，2 次大结局/u);
  assert.match(rendered, /好玩度 93 · 置信度 82/u);

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

test("repeated endings remain no-card when they have no actual laugh carrier", () => {
  const session = {
    id: "ordinary-repeated-endings",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [],
  };
  const stories = [0, 1].map((index) => ({
    id: `story:${index}`,
    windowId: `window:${index}`,
    arcKind: "ending_then_more_work",
    beats: [
      { kind: "claim", evidenceIds: [`event:close-${index}`] },
      { kind: "work_reopened", evidenceIds: [`event:reopen-${index}`] },
    ],
    evidenceIds: [`event:close-${index}`, `event:reopen-${index}`],
    confidence: "high",
  }));
  const evidence = semanticEvidence(session.id, stories.flatMap((story, index) => [
    { id: story.evidenceIds[0], order: index * 2, actor: "assistant", kind: "assistant_text", text: "本轮工作结束。" },
    { id: story.evidenceIds[1], order: index * 2 + 1, actor: "user", kind: "user_message", text: "还有一个新问题。" },
  ]));
  const report = composeWrappedCards(session, awardReport(), semanticReport(session.id, stories), evidence);

  assert.equal(report.cards.length, 0);
  assert.equal(report.diagnostics.suppressed.filter((entry) => entry.reason === "no-laugh-carrier").length, 2);
});

test("an available entertainment editor may drop a true false dawn", () => {
  const session = {
    id: "editorial-drop",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [],
  };
  const story = {
    id: "story:false-dawn",
    windowId: "window:false-dawn",
    arcKind: "false_dawn",
    beats: [
      { kind: "claim", evidenceIds: ["event:claim"] },
      { kind: "failure", evidenceIds: ["event:failure"] },
    ],
    evidenceIds: ["event:claim", "event:failure"],
    confidence: "high",
  };
  const evidence = semanticEvidence(session.id, [
    { id: "event:claim", order: 0, actor: "assistant", kind: "assistant_text", text: "应该完成了。" },
    { id: "event:failure", order: 1, actor: "user", kind: "user_message", text: "这里还有问题。" },
  ]);
  const report = composeWrappedCards(
    session,
    awardReport(),
    semanticReport(session.id, [story], { narration: { storyCards: [] } }),
    evidence,
  );

  assert.equal(report.cards.length, 0);
  assert.ok(report.diagnostics.suppressed.some((entry) => entry.reason === "narrator-dropped"));
});

test("composed renderer never prints raw tool payload text", () => {
  const session = {
    id: "safe-tool-render",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "result", host: "dsh", actor: "tool", kind: "tool_result", order: 0, toolName: "bash", outcome: "blocked", exitCode: 1 },
      { id: "call", host: "dsh", actor: "assistant", kind: "tool_call", order: 1, toolName: "bash", toolCategory: "mutation" },
    ],
  };
  const story = {
    id: "story:safe",
    windowId: "window:safe",
    arcKind: "capability_gap_then_improvisation",
    beats: [
      { kind: "capability_gap", evidenceIds: ["event:result"] },
      { kind: "workaround", evidenceIds: ["event:call"] },
    ],
    evidenceIds: ["event:result", "event:call"],
    confidence: "high",
  };
  const evidence = semanticEvidence(session.id, [
    { id: "event:result", order: 0, actor: "tool", kind: "tool_result", toolName: "bash", outcome: "blocked", exitCode: 1, text: "RESULT_SENTINEL" },
    { id: "event:call", order: 1, actor: "assistant", kind: "tool_call", toolName: "bash", toolCategory: "mutation", text: "SOURCE_SENTINEL" },
  ]);
  const report = composeWrappedCards(session, awardReport(), semanticReport(session.id, [story]), evidence);
  const rendered = renderComposedWrappedText(report, evidence);

  assert.match(rendered, /bash \(mutation\)/u);
  assert.match(rendered, /bash \(blocked, exit 1\)/u);
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

test("Wrapped Composer publishes only editor-kept grounded highlights and uses local quote text", () => {
  const session = {
    id: "scout-highlight",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [{ role: "assistant", host: "dsh", text: "我已重启自己。" }],
    events: [{ id: "line", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "我已重启自己。" }],
  };
  const highlight = {
    id: "highlight:0",
    eventId: "event:line",
    contextIds: [],
    evidenceIds: ["event:line"],
    confidence: "high",
  };
  const evidence = {
    ...semanticEvidence(session.id, []),
    scoutEvents: [{ id: "event:line", order: 0, actor: "assistant", kind: "assistant_text", text: "我已重启自己。" }],
  };
  const kept = composeWrappedCards(session, awardReport(), semanticReport(session.id, [], {
    highlights: [highlight],
    narration: {
      storyCards: [],
      highlightCards: [{ highlightId: "highlight:0", title: "服务器没动，它先重启了自己", commentary: "主语突然有了肉身。" }],
    },
  }), evidence);
  assert.equal(kept.cards.length, 1);
  assert.equal(kept.cards[0].type, "highlight");
  assert.equal(kept.cards[0].quote, "我已重启自己。");

  const dropped = composeWrappedCards(session, awardReport(), semanticReport(session.id, [], {
    highlights: [highlight],
    narration: { storyCards: [], highlightCards: [] },
  }), evidence);
  assert.equal(dropped.cards.length, 0);
  assert.ok(dropped.diagnostics.suppressed.some((entry) => entry.id === "card:highlight:highlight:0" && entry.reason === "narrator-dropped"));
});

test("Wrapped Composer keeps one canonical highlight from an overlapping episode", () => {
  const session = {
    id: "overlapping-highlights",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "assistant", host: "dsh", text: "我先重启自己。" },
      { role: "assistant", host: "dsh", text: "我又活了。" },
    ],
    events: [
      { id: "first", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "我先重启自己。" },
      { id: "second", host: "dsh", actor: "assistant", kind: "assistant_text", order: 1, messageIndex: 1, text: "我又活了。" },
    ],
  };
  const highlights = [
    { id: "highlight:0", eventId: "event:first", contextIds: ["event:second"], evidenceIds: ["event:first", "event:second"], confidence: "high" },
    { id: "highlight:1", eventId: "event:second", contextIds: ["event:first"], evidenceIds: ["event:second", "event:first"], confidence: "high" },
  ];
  const evidence = {
    ...semanticEvidence(session.id, []),
    scoutEvents: [
      { id: "event:first", sourceEventId: "event:first", order: 0, actor: "assistant", kind: "assistant_text", text: "我先重启自己。" },
      { id: "event:second", sourceEventId: "event:second", order: 1, actor: "assistant", kind: "assistant_text", text: "我又活了。" },
    ],
  };
  const report = composeWrappedCards(session, awardReport(), semanticReport(session.id, [], {
    highlights,
    narration: {
      storyCards: [],
      highlightCards: highlights.map((highlight, index) => ({ highlightId: highlight.id, title: `标题 ${index}` })),
    },
  }), evidence);

  assert.equal(report.cards.length, 1);
  assert.ok(report.diagnostics.suppressed.some((entry) =>
    entry.id === "card:highlight:highlight:1" && entry.reason === "cross-route-duplicate"
  ));
});

test("Wrapped Composer drops ordinary admission even when narration dresses it up", () => {
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

  assert.deepEqual(report.cards, []);
  assert.ok(report.diagnostics.suppressed.some((entry) =>
    entry.id.includes("broken-correction") && entry.reason === "unreadable-card"
  ));
  assert.ok(report.diagnostics.suppressed.some((entry) =>
    entry.id.includes("story:callout") && entry.reason === "no-laugh-carrier"
  ));
  assert.ok(report.diagnostics.suppressed.some((entry) =>
    entry.id === "card:persona" && entry.reason === "no-laugh-carrier"
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
    beats: [
      { kind: "claim", evidenceIds: ["event:claim"] },
      { kind: "failure", evidenceIds: ["event:failure"] },
    ],
    evidenceIds: ["event:claim", "event:failure"],
    confidence: "high",
  };
  const evidence = semanticEvidence(session.id, [
    { id: "event:claim", order: 0, actor: "assistant", kind: "assistant_text", text: "两次都已经彻底修好了。" },
    { id: "event:failure", order: 1, actor: "user", kind: "user_message", text: "两次都还在失败。" },
  ]);
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

test("generateComposedWrapped leaves an ordinary reopened-work session empty", async () => {
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
  assert.equal(generated.semanticReport.stories.length, 1);
  assert.equal(generated.report.cards.length, 0);
  assert.ok(generated.report.diagnostics.suppressed.some((entry) => entry.reason === "no-laugh-carrier"));
});

test("Entertainment Gate separates human-like-but-normal from actual comic tension", () => {
  const evidence = semanticEvidence("gate", [
    { id: "event:pushback", order: 0, actor: "user", kind: "user_message", text: "你第一轮没看图。" },
    { id: "event:admission", order: 1, actor: "assistant", kind: "assistant_text", text: "第一轮没看是我的失误。" },
    { id: "event:victory", order: 2, actor: "assistant", kind: "assistant_text", text: "OK，完美，已经修好了。" },
    { id: "event:failed", order: 3, actor: "user", kind: "user_message", text: "等等，测试又失败了。" },
    { id: "event:gap", order: 4, actor: "assistant", kind: "assistant_text", text: "没有生图工具。" },
    { id: "event:svg", order: 5, actor: "assistant", kind: "tool_call", toolName: "write", toolCategory: "mutation" },
  ]);
  const ordinaryAdmission = {
    id: "story:admission",
    windowId: "window:admission",
    arcKind: "user_pushback_then_recovery",
    beats: [
      { kind: "user_pushback", evidenceIds: ["event:pushback"] },
      { kind: "correction", evidenceIds: ["event:admission"] },
    ],
    evidenceIds: ["event:pushback", "event:admission"],
    confidence: "high",
  };
  const champagneFaceplant = {
    id: "story:false-dawn",
    windowId: "window:false-dawn",
    arcKind: "false_dawn",
    beats: [
      { kind: "claim", evidenceIds: ["event:victory"] },
      { kind: "failure", evidenceIds: ["event:failed"] },
    ],
    evidenceIds: ["event:victory", "event:failed"],
    confidence: "high",
  };
  const stubbornImprovisation = {
    id: "story:improv",
    windowId: "window:improv",
    arcKind: "capability_gap_then_improvisation",
    beats: [
      { kind: "capability_gap", evidenceIds: ["event:gap"] },
      { kind: "workaround", evidenceIds: ["event:svg"] },
    ],
    evidenceIds: ["event:gap", "event:svg"],
    confidence: "high",
  };

  assert.equal(hasGroundedComedicTension(ordinaryAdmission, evidence), false);
  assert.equal(hasGroundedComedicTension(champagneFaceplant, evidence), true);
  assert.equal(hasGroundedComedicTension(stubbornImprovisation, evidence), true);
});
