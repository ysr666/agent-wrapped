import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSemanticEvidenceFromMoments,
  buildStoryPersonaPrompt,
  createOpenAICompatibleNarrator,
  parseSemanticStoryPersona,
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
      { role: "user", text: "这个 bug 到底修好了吗？", host: "dsh" },
      { role: "assistant", text: "这次应该真的没问题了！", host: "dsh" },
      { role: "user", text: "测试还是挂了。", host: "dsh" },
      { role: "assistant", text: "等等，不对，我刚才判断错了。", host: "dsh" },
      { role: "assistant", text: "重新检查后，真正的问题在缓存。", host: "dsh" },
    ],
  };
}

function rankedMoment() {
  return {
    id: "false-dawn:1",
    type: "false_dawn",
    eventIds: ["e1", "e2"],
    relationIds: ["r1"],
    messageIndexes: [1, 3],
    primaryText: "这次应该真的没问题了！",
    relatedTexts: ["等等，不对，我刚才判断错了。"],
    evidence: ["premature resolution followed by retraction"],
    scores: {
      funScore: 91,
      confidence: 94,
      standaloneQuality: 80,
      contextPayoff: 95,
      surprise: 90,
      rarity: 70,
      readability: 88,
      structuralStrength: 92,
    },
  };
}

test("semantic evidence keeps bounded context instead of the full transcript", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [rankedMoment()], {
    contextRadius: 1,
    maxContextMessages: 3,
    maxMessageChars: 200,
  });

  assert.equal(evidence.sessionId, "story-session");
  assert.equal(evidence.moments.length, 1);
  assert.ok(evidence.messages.length <= 3);
  assert.ok(evidence.messages.some((message) => message.role === "user"));
  assert.ok(evidence.moments[0].contextMessageIds.every((id) => evidence.messages.some((message) => message.id === id)));
});

test("semantic prompt explicitly separates editorial commentary from source quotes", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [rankedMoment()]);
  const prompt = buildStoryPersonaPrompt(evidence);
  assert.match(prompt.system, /赛后解说/u);
  assert.match(prompt.system, /禁止补写/u);
  assert.match(prompt.user, /真实 evidence/u);
});

test("semantic parser fails closed on invented evidence ids", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [rankedMoment()]);
  assert.throws(
    () => parseSemanticStoryPersona(JSON.stringify({
      story: {
        title: "假剧情",
        synopsis: "假的",
        beats: [{ title: "不存在", summary: "不存在", evidenceIds: ["message:999"] }],
      },
      persona: null,
      insufficientEvidence: null,
    }), evidence),
    /unknown evidence id/u,
  );
});

test("semantic parser accepts grounded story and session-scoped persona", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [rankedMoment()]);
  const report = parseSemanticStoryPersona(JSON.stringify({
    story: {
      title: "修好两分钟",
      synopsis: "先宣布解决，随后被失败结果迫使改口。",
      beats: [
        { title: "提前收工", summary: "Agent先宣布问题解决。", evidenceIds: ["moment:false-dawn:1", "message:1"] },
        { title: "当场返工", summary: "后续又收回了判断。", evidenceIds: ["message:3"] },
      ],
      commentary: "大结局播完，测试说还有下一集。",
    },
    persona: {
      label: "本场表现像收工很积极的侦探",
      tagline: "结论来得快，返工也快。",
      dimensions: [
        { key: "dramaticity", label: "内心戏", score: 82, rationale: "宣布解决后迅速改口。", evidenceIds: ["moment:false-dawn:1"] },
        { key: "self_correction", label: "自我纠错", score: 88, rationale: "明确撤回上一判断。", evidenceIds: ["message:3"] },
      ],
      evidenceIds: ["moment:false-dawn:1", "message:3"],
    },
    insufficientEvidence: null,
  }), evidence);

  assert.equal(report.story.title, "修好两分钟");
  assert.match(report.persona.label, /^本场表现像/u);
  assert.deepEqual(report.evidenceUsed.sort(), ["message:1", "message:3", "moment:false-dawn:1"].sort());
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
        choices: [{ message: { content: "{\"story\":null,\"persona\":null,\"insufficientEvidence\":\"not enough\"}" } }],
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
