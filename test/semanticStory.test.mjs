import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregatePersonaSignals,
  buildNarrationPrompt,
  buildSemanticEvidenceFromMoments,
  buildStoryMinerPrompt,
  createOpenAICompatibleNarrator,
  generateSemanticStoryPersona,
  parseNarrationOutput,
  parseStoryMinerOutput,
  validateStoryCandidates,
} from "../dist/index.js";

function session() {
  return {
    id: "story-session",
    host: "dsh",
    title: "排障名场面",
    model: "deepseek-v4-flash",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "user", text: "把这个坏文件删掉。", host: "dsh" },
      { role: "assistant", text: "我来处理。", host: "dsh" },
      { role: "assistant", text: "权限拦住了，我换个办法。", host: "dsh" },
    ],
    events: [
      { id: "e0", host: "dsh", actor: "user", kind: "user_message", order: 0, messageIndex: 0, text: "把这个坏文件删掉。" },
      { id: "e1", host: "dsh", actor: "assistant", kind: "assistant_text", order: 1, messageIndex: 1, text: "我来处理。" },
      { id: "e2", host: "dsh", actor: "tool", kind: "tool_call", order: 2, toolName: "delete", callId: "c1", toolArguments: "{\"path\":\"/Users/alice/work/a.txt\",\"authorization\":\"Bearer abcdefghijklmnop\"}" },
      { id: "e3", host: "dsh", actor: "tool", kind: "tool_error", order: 3, callId: "c1", isError: true, text: "permission denied" },
      { id: "e4", host: "dsh", actor: "assistant", kind: "assistant_text", order: 4, messageIndex: 2, text: "权限拦住了，我换个办法。" },
      { id: "e5", host: "dsh", actor: "tool", kind: "tool_call", order: 5, toolName: "computer_use", callId: "c2", toolArguments: "{\"action\":\"delete\"}" },
      { id: "e6", host: "dsh", actor: "tool", kind: "tool_result", order: 6, callId: "c2", isError: false, text: "deleted" },
    ],
  };
}

function rankedMoment() {
  return {
    id: "plot:1",
    type: "plot_twist",
    eventIds: ["old-e1"],
    relationIds: [],
    messageIndexes: [2],
    primaryText: "权限拦住了，我换个办法。",
    relatedTexts: [],
    evidence: ["direction changed"],
    scores: {
      funScore: 80,
      confidence: 90,
      standaloneQuality: 70,
      contextPayoff: 90,
      surprise: 80,
      rarity: 70,
      readability: 80,
      structuralStrength: 80,
    },
  };
}

function minedFailureWorkaround() {
  return JSON.stringify({
    stories: [{
      arcKind: "failure_then_workaround",
      beats: [
        { kind: "attempt", evidenceIds: ["event:e2"] },
        { kind: "failure", evidenceIds: ["event:e3"] },
        { kind: "workaround", evidenceIds: ["event:e5"] },
        { kind: "success", evidenceIds: ["event:e6"] },
      ],
      confidence: "high",
    }],
    insufficientEvidence: null,
  });
}

test("P8 v2 story evidence is event-first and does not require a P3 Moment", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [], {
    coverageWindows: 1,
    maxEvents: 20,
  });
  assert.equal(evidence.version, 2);
  assert.equal(evidence.momentHints.length, 0);
  assert.ok(evidence.windows.length > 0);
  assert.ok(evidence.events.some((event) => event.kind === "tool_error"));
  assert.ok(evidence.events.some((event) => event.toolName === "computer_use"));
});

test("P8 v2 redacts common secrets and home-directory identity before remote evidence", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), []);
  const joined = evidence.events.map((event) => event.text ?? "").join("\n");
  assert.ok(evidence.redactionCount >= 2);
  assert.doesNotMatch(joined, /abcdefgh/iu);
  assert.doesNotMatch(joined, /\/Users\/alice\//u);
  assert.match(joined, /\[REDACTED\]/u);
  assert.match(joined, /\/Users\/\[USER\]\//u);
});

test("Story Miner prompt asks for structure only; narration receives only verified structure plus deterministic signals", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [rankedMoment()]);
  const miner = buildStoryMinerPrompt(evidence);
  assert.match(miner.system, /职责只有一个/u);
  assert.match(miner.system, /不要写标题/u);
  assert.ok(!miner.user.includes('"score":'));

  const parsed = parseStoryMinerOutput(minedFailureWorkaround());
  const validation = validateStoryCandidates(parsed.candidates, evidence);
  assert.equal(validation.stories.length, 1);
  const signals = aggregatePersonaSignals(validation.stories, evidence);
  assert.ok(signals.some((signal) => signal.key === "persistence"));
  assert.ok(signals.every((signal) => !("score" in signal)));

  const narration = buildNarrationPrompt(evidence, validation.stories, signals);
  assert.match(narration.system, /只负责/u);
  assert.match(narration.system, /禁止输出 0-100/u);
});

test("local grounding rejects unknown ids, backward chronology and unsupported arc shapes", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), []);
  const unknown = parseStoryMinerOutput(JSON.stringify({
    stories: [{
      arcKind: "failure_then_workaround",
      beats: [
        { kind: "failure", evidenceIds: ["event:missing"] },
        { kind: "workaround", evidenceIds: ["event:e5"] },
      ],
      confidence: "high",
    }],
  }));
  assert.equal(validateStoryCandidates(unknown.candidates, evidence).stories.length, 0);
  assert.equal(validateStoryCandidates(unknown.candidates, evidence).rejected[0].reason, "unknown-evidence-id");

  const backward = parseStoryMinerOutput(JSON.stringify({
    stories: [{
      arcKind: "failure_then_workaround",
      beats: [
        { kind: "failure", evidenceIds: ["event:e3"] },
        { kind: "workaround", evidenceIds: ["event:e2"] },
      ],
      confidence: "medium",
    }],
  }));
  assert.equal(validateStoryCandidates(backward.candidates, evidence).rejected[0].reason, "non-chronological-beats");
});

test("narrator cannot invent story ids and persona labels are forced to be session-scoped", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [rankedMoment()]);
  const parsed = parseStoryMinerOutput(minedFailureWorkaround());
  const stories = validateStoryCandidates(parsed.candidates, evidence).stories;
  const signals = aggregatePersonaSignals(stories, evidence);

  assert.throws(
    () => parseNarrationOutput(JSON.stringify({ storyCards: [{ storyId: "story:999", title: "假的" }] }), stories, signals, "zh-CN"),
    /unknown story id/u,
  );

  const narration = parseNarrationOutput(JSON.stringify({
    storyCards: [{ storyId: "story:0", title: "沙箱拦住了它，但没拦住它的决心", commentary: "规则说不能用这个办法，它理解成了换个办法。" }],
    persona: { label: "执着型实习生", tagline: "工具失败以后会继续换路。" },
  }), stories, signals, "zh-CN");
  assert.match(narration.persona.label, /^本场表现像/u);
});

test("generateSemanticStoryPersona performs miner then narrator, with local validation between calls", async () => {
  const outputs = [
    minedFailureWorkaround(),
    JSON.stringify({
      storyCards: [{ storyId: "story:0", title: "删不掉？那就换个办法", commentary: "权限只挡住了第一条路。" }],
      persona: { label: "本场表现像执着型实习生", tagline: "被拦住后继续换路。" },
    }),
  ];
  const requests = [];
  const narrator = {
    async generate(request) {
      requests.push(request);
      return outputs.shift();
    },
  };
  const { report } = await generateSemanticStoryPersona(session(), narrator);
  assert.equal(requests.length, 2);
  assert.equal(report.version, 2);
  assert.equal(report.stories.length, 1);
  assert.equal(report.narration.storyCards[0].storyId, "story:0");
  assert.ok(report.personaSignals.some((signal) => signal.key === "persistence"));
});

test("OpenAI-compatible narrator is opt-in and sends only the supplied prompt", async () => {
  let captured;
  const narrator = createOpenAICompatibleNarrator({
    baseUrl: "http://localhost:9999/v1",
    model: "local-test-model",
    apiKey: "secret",
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        choices: [{ message: { content: "{\"stories\":[],\"insufficientEvidence\":\"not enough\"}" } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const output = await narrator.generate({ system: "sys", user: "evidence-only" });
  assert.match(output, /not enough/u);
  assert.equal(captured.url, "http://localhost:9999/v1/chat/completions");
  const body = JSON.parse(captured.init.body);
  assert.equal(body.model, "local-test-model");
  assert.deepEqual(body.messages.map((message) => message.content), ["sys", "evidence-only"]);
});
