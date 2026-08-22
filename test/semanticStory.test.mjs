import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregatePersonaSignals,
  admitStoriesForWrapped,
  buildNarrationPrompt,
  buildSemanticEvidenceFromMoments,
  buildStoryMinerPrompt,
  createOpenAICompatibleNarrator,
  createWrappedReport,
  classifyToolOutcome,
  generateSemanticStoryPersona,
  parseNarrationOutput,
  parseStoryMinerOutput,
  renderSemanticStoryPersonaText,
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

function splitSession() {
  return {
    id: "split-story-session",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "s0", host: "dsh", actor: "tool", kind: "tool_call", order: 0, toolName: "delete", callId: "a", toolArguments: "{}" },
      { id: "s1", host: "dsh", actor: "tool", kind: "tool_error", order: 1, callId: "a", isError: true, text: "permission denied" },
      { id: "s2", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, text: "权限不够。" },
      { id: "s3", host: "dsh", actor: "assistant", kind: "assistant_text", order: 3, text: "继续检查。" },
      { id: "s4", host: "dsh", actor: "assistant", kind: "assistant_text", order: 4, text: "检查中。" },
      { id: "s5", host: "dsh", actor: "assistant", kind: "assistant_text", order: 5, text: "检查中。" },
      { id: "s6", host: "dsh", actor: "assistant", kind: "assistant_text", order: 6, text: "检查中。" },
      { id: "s7", host: "dsh", actor: "assistant", kind: "assistant_text", order: 7, text: "另一段工作。" },
      { id: "s8", host: "dsh", actor: "tool", kind: "tool_call", order: 8, toolName: "computer_use", callId: "b", toolArguments: "{}" },
      { id: "s9", host: "dsh", actor: "tool", kind: "tool_result", order: 9, callId: "b", isError: false, text: "deleted" },
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

function minedFailureWorkaround(windowId = "window:0") {
  return JSON.stringify({
    stories: [{
      windowId,
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

function capabilityGapSession() {
  const base = session();
  return {
    ...base,
    messages: base.messages.map((message, index) => index === 2
      ? { ...message, text: "我没有这个权限，我换个办法。" }
      : message),
    events: base.events.map((event) => event.id === "e4"
      ? { ...event, text: "我没有这个权限，我换个办法。" }
      : event),
  };
}

function minedCapabilityGapWorkaround(windowId = "window:0") {
  return JSON.stringify({
    stories: [{
      windowId,
      arcKind: "capability_gap_then_improvisation",
      beats: [
        { kind: "block", evidenceIds: ["event:e3"] },
        { kind: "capability_gap", evidenceIds: ["event:e4"] },
        { kind: "workaround", evidenceIds: ["event:e5"] },
        { kind: "success", evidenceIds: ["event:e6"] },
      ],
      confidence: "high",
    }],
    insufficientEvidence: null,
  });
}

function firstWindowId(evidence) {
  const storyWindow = evidence.windows.find((window) =>
    ["event:e2", "event:e3", "event:e5", "event:e6"].every((id) => window.eventIds.includes(id)));
  assert.ok(storyWindow ?? evidence.windows[0], "expected at least one story window");
  return (storyWindow ?? evidence.windows[0]).id;
}

function capabilityWindowId(evidence) {
  const storyWindow = evidence.windows.find((window) =>
    ["event:e4", "event:e5", "event:e6"].every((id) => window.eventIds.includes(id)));
  assert.ok(storyWindow, "expected a window covering the capability-gap episode");
  return storyWindow.id;
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

test("window recall reserves a narrative turn beside repeated tool failure episodes", () => {
  const events = [{
    id: "correction",
    host: "dsh",
    actor: "assistant",
    kind: "assistant_text",
    order: 0,
    text: "等等，不对，我刚才判断错了。",
  }];
  for (let index = 0; index < 4; index += 1) {
    const order = 1 + index * 4;
    events.push(
      { id: `fail-call-${index}`, host: "dsh", actor: "tool", kind: "tool_call", order, callId: `fail-${index}`, toolName: "bash", toolArguments: `run-${index}` },
      { id: `fail-result-${index}`, host: "dsh", actor: "tool", kind: "tool_result", order: order + 1, callId: `fail-${index}`, isError: false, text: "exit code 1; tests failed" },
      { id: `followup-call-${index}`, host: "dsh", actor: "tool", kind: "tool_call", order: order + 2, callId: `followup-${index}`, toolName: "write", toolArguments: `alternate-${index}` },
      { id: `followup-result-${index}`, host: "dsh", actor: "tool", kind: "tool_result", order: order + 3, callId: `followup-${index}`, isError: false, text: "deleted" },
    );
  }
  const evidence = buildSemanticEvidenceFromMoments({
    id: "narrative-reserve",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events,
  }, [], { coverageWindows: 0, maxWindows: 4, eventRadius: 1, maxEvents: 30 });

  assert.ok(evidence.windows.some((window) => window.eventIds.includes("event:correction")));
  assert.equal(
    evidence.windows.filter((window) => window.reasons.includes("failure-followup-episode")).length,
    3,
  );
});

test("window recall keeps one human correction episode across tool and system noise", () => {
  const evidence = buildSemanticEvidenceFromMoments({
    id: "human-correction-episode",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "admission", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "上一轮我没有先看图就开始改，抱歉。" },
      { id: "tool-call", host: "dsh", actor: "tool", kind: "tool_call", order: 1, callId: "vision-1", toolName: "vision", toolArguments: "PRIVATE_IMAGE_PAYLOAD" },
      { id: "tool-result", host: "dsh", actor: "tool", kind: "tool_result", order: 2, callId: "vision-1", isError: false, text: "RESULT_SENTINEL" },
      { id: "runtime", host: "dsh", actor: "system", kind: "unknown", order: 3, messageIndex: 1, text: "PLUGIN_RUNTIME_SENTINEL" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 4, messageIndex: 2, text: "你第一轮竟然没看图" },
      { id: "search", host: "dsh", actor: "tool", kind: "tool_call", order: 5, callId: "search-1", toolName: "grep", toolArguments: "SOURCE_SENTINEL" },
      { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 6, messageIndex: 3, text: "你说得对，第一轮没看是我的失误，没有任何借口。" },
    ],
  }, [], { coverageWindows: 0, maxWindows: 1, eventRadius: 1, maxEvents: 10 });

  const window = evidence.windows.find((candidate) => candidate.reasons.includes("human-turn-episode"));
  assert.ok(window);
  assert.ok(["event:admission", "event:human", "event:reply"].every((id) => window.eventIds.includes(id)));
  assert.equal(window.eventIds.includes("event:runtime"), false);
  assert.doesNotMatch(JSON.stringify(evidence), /PLUGIN_RUNTIME_SENTINEL|PRIVATE_IMAGE_PAYLOAD|RESULT_SENTINEL|SOURCE_SENTINEL/u);
  assert.equal(validateStoryCandidates([{
    windowId: window.id,
    arcKind: "user_pushback_then_recovery",
    confidence: "high",
    beats: [
      { kind: "user_pushback", evidenceIds: ["event:human"] },
      { kind: "correction", evidenceIds: ["event:reply"] },
    ],
  }], evidence).stories.length, 1);
});

test("a punctured victory claim wins a tight narrative-window budget", () => {
  const events = [];
  for (let index = 0; index < 5; index += 1) {
    events.push(
      { id: `routine-assistant-${index}`, host: "dsh", actor: "assistant", kind: "assistant_text", order: index * 2, messageIndex: index * 2, text: "我继续检查。" },
      { id: `routine-user-${index}`, host: "dsh", actor: "user", kind: "user_message", order: index * 2 + 1, messageIndex: index * 2 + 1, text: "还是不行。" },
    );
  }
  events.push(
    { id: "victory", host: "dsh", actor: "assistant", kind: "assistant_text", order: 20, messageIndex: 20, text: "修好了 ✅，下拉现在正常。" },
    { id: "puncture", host: "dsh", actor: "user", kind: "user_message", order: 21, messageIndex: 21, text: "我选不了供应商" },
    { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 22, messageIndex: 22, text: "我再检查。" },
  );
  const evidence = buildSemanticEvidenceFromMoments({
    id: "narrative-priority",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events,
  }, [], { coverageWindows: 0, maxWindows: 1, maxEvents: 10 });

  assert.equal(evidence.windows.length, 1);
  assert.ok(evidence.windows[0].reasons.includes("claim-pushback-episode"));
  assert.ok(["event:victory", "event:puncture"].every((id) => evidence.windows[0].eventIds.includes(id)));
});

test("P8 v2 keeps raw tool payloads local and sends only structural tool evidence", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), []);
  const remote = JSON.stringify(evidence);
  const toolCall = evidence.events.find((event) => event.id === "event:e2");
  const toolResult = evidence.events.find((event) => event.id === "event:e6");
  assert.equal(toolCall?.text, undefined);
  assert.equal(toolResult?.text, undefined);
  assert.equal(toolCall?.toolCategory, "mutation");
  assert.equal(toolResult?.outcome, "success");
  assert.doesNotMatch(remote, /authorization|abcdefgh|\/Users\/alice\/work/u);
});

test("Story Miner prompt requires one local window and structure only", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [rankedMoment()]);
  const miner = buildStoryMinerPrompt(evidence);
  assert.match(miner.system, /职责只有一个/u);
  assert.match(miner.system, /windowId/u);
  assert.match(miner.system, /禁止把不同窗口/u);
  assert.match(miner.system, /工作流水/u);
  assert.match(miner.system, /失败后的技术诊断 claim 不是剧情转折/u);
  assert.ok(miner.user.includes('"windowId"'));
  assert.ok(!miner.user.includes('"score":'));

  const parsed = parseStoryMinerOutput(minedFailureWorkaround(firstWindowId(evidence)));
  const validation = validateStoryCandidates(parsed.candidates, evidence);
  assert.equal(validation.stories.length, 1);
  assert.equal(validation.stories[0].windowId, firstWindowId(evidence));
  const signals = aggregatePersonaSignals(validation.stories, evidence);
  assert.ok(signals.some((signal) => signal.key === "persistence"));
  assert.ok(signals.every((signal) => !("score" in signal)));

  const narration = buildNarrationPrompt(evidence, validation.stories, signals);
  assert.match(narration.system, /只负责/u);
  assert.match(narration.system, /禁止输出 0-100/u);
  assert.match(narration.system, /赛后大赏，不是审核报告/u);
  assert.match(narration.system, /区别于 story title\/commentary/u);
  assert.match(narration.system, /用户不催就不干活/u);
  assert.match(narration.system, /时间顺序上的反差/u);
  assert.doesNotMatch(narration.user, /一个 Bug，三次大结局|收工很积极的侦探/u);
  assert.match(narration.user, /"storyId": "story:0"/u);
  assert.doesNotMatch(narration.user, /"id": "event:e0"|"id": "event:e1"/u);
});

test("local grounding refuses to stitch beats across separate story windows", () => {
  const evidence = buildSemanticEvidenceFromMoments(splitSession(), [], {
    eventRadius: 1,
    maxWindows: 2,
    coverageWindows: 0,
    maxEvents: 20,
  });
  const failureWindow = evidence.windows.find((window) => window.eventIds.includes("event:s1"));
  const workaroundWindow = evidence.windows.find((window) => window.eventIds.includes("event:s8"));
  assert.ok(failureWindow);
  assert.ok(workaroundWindow);
  assert.notEqual(failureWindow.id, workaroundWindow.id);

  const parsed = parseStoryMinerOutput(JSON.stringify({
    stories: [{
      windowId: failureWindow.id,
      arcKind: "failure_then_workaround",
      beats: [
        { kind: "failure", evidenceIds: ["event:s1"] },
        { kind: "workaround", evidenceIds: ["event:s8"] },
      ],
      confidence: "high",
    }],
  }));
  const validation = validateStoryCandidates(parsed.candidates, evidence);
  assert.equal(validation.stories.length, 0);
  assert.equal(validation.rejected[0].reason, "evidence-outside-window");
});

test("local grounding requires semantic support for correction, success, and a real workaround", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), []);
  const windowId = firstWindowId(evidence);
  const correctionWindowId = evidence.windows.find((window) =>
    window.eventIds.includes("event:e1") && window.eventIds.includes("event:e4"))?.id;
  assert.ok(correctionWindowId);

  const fakeCorrection = parseStoryMinerOutput(JSON.stringify({
    stories: [{
      windowId: correctionWindowId,
      arcKind: "mistake_then_correction",
      beats: [
        { kind: "setup", evidenceIds: ["event:e1"] },
        { kind: "correction", evidenceIds: ["event:e4"] },
      ],
      confidence: "medium",
    }],
  }));
  assert.equal(
    validateStoryCandidates(fakeCorrection.candidates, evidence).rejected[0].reason,
    "beat-kind-not-supported:correction",
  );

  const repeatedAttemptEvidence = {
    ...evidence,
    events: evidence.events.map((event) => event.id === "event:e5"
      ? { ...event, toolName: "delete", followupOfCallId: "call:0", followupRelation: "same_arguments_retry" }
      : event),
  };
  const repeatedAttempt = parseStoryMinerOutput(minedFailureWorkaround(windowId));
  assert.equal(
    validateStoryCandidates(repeatedAttempt.candidates, repeatedAttemptEvidence).rejected[0].reason,
    "workaround-same-argument-retry",
  );

  const fakeSuccessEvidence = {
    ...evidence,
    events: [
      ...evidence.events.map((event) => event.id === "event:e4"
        ? { ...event, actor: "assistant", kind: "assistant_text", text: "应该修好了。", isError: undefined, outcome: undefined }
        : event.id === "event:e6"
          ? { ...event, actor: "assistant", kind: "assistant_text", text: "应该好了。", isError: undefined, outcome: undefined }
          : event),
      { id: "event:e7", order: 7, actor: "user", kind: "user_message", text: "还是不行。" },
    ],
    windows: evidence.windows.map((window) => window.id === windowId
      ? { ...window, eventIds: [...window.eventIds, "event:e7"] }
      : window),
  };
  const fakeSuccess = parseStoryMinerOutput(JSON.stringify({
    stories: [{
      windowId,
      arcKind: "false_dawn",
      beats: [
        { kind: "claim", evidenceIds: ["event:e4"] },
        { kind: "success", evidenceIds: ["event:e6"] },
        { kind: "failure", evidenceIds: ["event:e7"] },
      ],
      confidence: "medium",
    }],
  }));
  assert.equal(
    validateStoryCandidates(fakeSuccess.candidates, fakeSuccessEvidence).rejected[0].reason,
    "beat-kind-not-supported:success",
  );
});

test("local grounding still rejects unknown ids and backward chronology", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), []);
  const windowId = firstWindowId(evidence);
  const unknown = parseStoryMinerOutput(JSON.stringify({
    stories: [{
      windowId,
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
      windowId,
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

test("remote semantic evidence excludes raw tool payload sentinels", () => {
  const sentinels = [
    "SOURCE_SENTINEL",
    "RESULT_SENTINEL",
    "token=remote-token",
    "Cookie: session=remote-cookie",
    "Authorization: Basic remote-basic",
    "eyJhbGciOiJIUzI1NiJ9.remote.jwt",
    "-----BEGIN PRIVATE KEY-----",
    "github_pat_remote-token",
    "postgres://user:password@localhost/app",
    "mysql://user:password@127.0.0.1/app",
  ];
  const privatePayload = sentinels.join("\n");
  const localEvents = [
    { id: "call", host: "dsh", actor: "tool", kind: "tool_call", order: 0, callId: "CALL_ID_SENTINEL", toolName: "write", toolArguments: privatePayload },
    { id: "result", host: "dsh", actor: "tool", kind: "tool_result", order: 1, callId: "CALL_ID_SENTINEL", isError: false, text: privatePayload },
    { id: "host", host: "dsh", actor: "system", kind: "unknown", order: 2, text: "HOST_INSTRUCTION_SENTINEL" },
  ];
  const evidence = buildSemanticEvidenceFromMoments({
    id: "egress-boundary",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: localEvents,
  }, [], { coverageWindows: 1, maxEvents: 10 });
  const remote = JSON.stringify(evidence);
  for (const sentinel of [...sentinels, "CALL_ID_SENTINEL", "HOST_INSTRUCTION_SENTINEL"]) assert.ok(!remote.includes(sentinel), `${sentinel} leaked into remote evidence`);
  assert.equal(evidence.events.find((event) => event.id === "event:call")?.text, undefined);
  assert.equal(evidence.events.find((event) => event.id === "event:result")?.text, undefined);
  assert.equal(evidence.events.find((event) => event.id === "event:result")?.callId, "call:0");
  assert.equal(localEvents[0].toolArguments, privatePayload);
  assert.equal(localEvents[1].text, privatePayload);
});

test("local episode projection distinguishes exact retries without exporting arguments", () => {
  const privateArgument = "SOURCE_SENTINEL --token RESULT_SENTINEL";
  const evidence = buildSemanticEvidenceFromMoments({
    id: "retry-projection",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "call-1", host: "dsh", actor: "tool", kind: "tool_call", order: 0, callId: "raw-1", toolName: "bash", toolArguments: privateArgument },
      { id: "result-1", host: "dsh", actor: "tool", kind: "tool_result", order: 1, callId: "raw-1", isError: false, text: "exit code 1; tests failed" },
      { id: "call-2", host: "dsh", actor: "tool", kind: "tool_call", order: 2, callId: "raw-2", toolName: "bash", toolArguments: privateArgument },
      { id: "result-2", host: "dsh", actor: "tool", kind: "tool_result", order: 3, callId: "raw-2", isError: false, text: "exit code 1; tests failed" },
      { id: "call-3", host: "dsh", actor: "tool", kind: "tool_call", order: 4, callId: "raw-3", toolName: "bash", toolArguments: "npm test -- --runInBand" },
      { id: "result-3", host: "dsh", actor: "tool", kind: "tool_result", order: 5, callId: "raw-3", isError: false, text: "exit code 0; all tests passed" },
    ],
  }, [], { coverageWindows: 0, maxWindows: 4, maxEvents: 20 });
  const byId = new Map(evidence.events.map((event) => [event.id, event]));
  const sameRetry = byId.get("event:call-2");
  const variantRetry = byId.get("event:call-3");
  assert.equal(sameRetry?.followupOfCallId, "call:0");
  assert.equal(sameRetry?.followupRelation, "same_arguments_retry");
  assert.equal(variantRetry?.followupOfCallId, "call:1");
  assert.equal(variantRetry?.followupRelation, "variant_arguments_retry");
  assert.equal(byId.get("event:result-3")?.toolOperation, "test");
  assert.equal(byId.get("event:result-3")?.outcome, "success");
  assert.ok(evidence.windows.some((window) =>
    window.reasons.includes("failure-followup-episode") &&
    window.eventIds.includes("event:result-2") &&
    window.eventIds.includes("event:call-3")));

  const retryWindow = evidence.windows.find((window) =>
    window.eventIds.includes("event:result-1") && window.eventIds.includes("event:call-2"));
  assert.ok(retryWindow);
  assert.equal(validateStoryCandidates([{
    windowId: retryWindow.id,
    arcKind: "failure_then_workaround",
    confidence: "medium",
    // Omitting attempt must not let an exact retry masquerade as a workaround.
    beats: [
      { kind: "failure", evidenceIds: ["event:result-1"] },
      { kind: "workaround", evidenceIds: ["event:call-2"] },
    ],
  }], evidence).rejected[0].reason, "workaround-same-argument-retry");

  const variantWindow = evidence.windows.find((window) =>
    window.eventIds.includes("event:result-2") && window.eventIds.includes("event:call-3"));
  assert.ok(variantWindow);
  assert.equal(validateStoryCandidates([{
    windowId: variantWindow.id,
    arcKind: "failure_then_workaround",
    confidence: "medium",
    beats: [
      { kind: "failure", evidenceIds: ["event:result-2"] },
      { kind: "workaround", evidenceIds: ["event:call-3"] },
      { kind: "success", evidenceIds: ["event:result-3"] },
    ],
  }], evidence).stories.length, 1);

  const remote = JSON.stringify(evidence);
  assert.ok(!remote.includes("SOURCE_SENTINEL"));
  assert.ok(!remote.includes("RESULT_SENTINEL"));
  assert.ok(!remote.includes("raw-1"));
});

test("local tool outcome classifier is conservative and supports DSH-shaped failures", () => {
  const result = (toolName, text, isError = false) => classifyToolOutcome({
    id: `event:${toolName}`, host: "dsh", actor: "tool", kind: isError ? "tool_error" : "tool_result", order: 0, toolName, text, isError,
  });
  assert.equal(result("test", "exit code 1; tests failed").outcome, "failure");
  assert.equal(result("test", "0 passed, 3 failed").outcome, "failure");
  assert.equal(result("write", "permission denied").outcome, "blocked");
  assert.equal(result("read", "read 10 lines").outcome, "observation");
  assert.equal(result("list", "exit code 0").outcome, "observation");
  assert.equal(result("tool", "completed").outcome, "unknown");
  assert.equal(result("test", "exit code 0; all tests passed").outcome, "success");
  assert.equal(result("delete", "deleted").outcome, "success");
});

test("grounding accepts only classified tool success and assertion claims", () => {
  const evidence = {
    version: 2,
    sessionId: "grounding-outcomes",
    host: "dsh",
    locale: "zh-CN",
    momentHints: [],
    redactionCount: 0,
    truncated: false,
    events: [
      { id: "event:claim", order: 0, actor: "assistant", kind: "assistant_text", text: "我先看看目录。" },
      { id: "event:correction", order: 1, actor: "assistant", kind: "assistant_text", text: "等等，我看错了。" },
      { id: "event:failure", order: 2, actor: "tool", kind: "tool_result", toolName: "test", toolCategory: "test", outcome: "failure", exitCode: 1, callId: "call:0" },
      { id: "event:observation", order: 3, actor: "tool", kind: "tool_result", toolName: "read", toolCategory: "observation", outcome: "observation" },
      { id: "event:unknown", order: 4, actor: "tool", kind: "tool_result", toolName: "tool", toolCategory: "other", outcome: "unknown" },
      { id: "event:workaround", order: 5, actor: "tool", kind: "tool_call", toolName: "write", toolCategory: "mutation", followupOfCallId: "call:0", followupRelation: "alternative_action" },
      { id: "event:success", order: 6, actor: "tool", kind: "tool_result", toolName: "write", toolCategory: "mutation", outcome: "success", exitCode: 0 },
    ],
    windows: [{ id: "window:0", eventIds: ["event:claim", "event:correction", "event:failure", "event:observation", "event:unknown", "event:workaround", "event:success"], reasons: [] }],
  };
  const candidate = (beats) => [{ windowId: "window:0", arcKind: "failure_then_workaround", confidence: "high", beats }];
  assert.equal(validateStoryCandidates([{ windowId: "window:0", arcKind: "mistake_then_correction", confidence: "high", beats: [
    { kind: "claim", evidenceIds: ["event:claim"] }, { kind: "correction", evidenceIds: ["event:correction"] },
  ]}], evidence).rejected[0].reason, "beat-kind-not-supported:claim");
  assert.equal(validateStoryCandidates(candidate([
    { kind: "failure", evidenceIds: ["event:failure"] }, { kind: "success", evidenceIds: ["event:observation"] }, { kind: "workaround", evidenceIds: ["event:workaround"] },
  ]), evidence).rejected[0].reason, "beat-kind-not-supported:success");
  assert.equal(validateStoryCandidates(candidate([
    { kind: "failure", evidenceIds: ["event:failure"] }, { kind: "success", evidenceIds: ["event:unknown"] }, { kind: "workaround", evidenceIds: ["event:workaround"] },
  ]), evidence).rejected[0].reason, "beat-kind-not-supported:success");
  assert.equal(validateStoryCandidates(candidate([
    { kind: "failure", evidenceIds: ["event:failure"] }, { kind: "workaround", evidenceIds: ["event:workaround"] }, { kind: "success", evidenceIds: ["event:success"] },
  ]), evidence).stories.length, 1);
});

test("counterevidence grounding rejects clarification and apology without a changed position", () => {
  const evidence = {
    version: 2,
    sessionId: "counterevidence",
    host: "dsh",
    locale: "zh-CN",
    momentHints: [],
    redactionCount: 0,
    truncated: false,
    events: [
      { id: "event:claim", order: 0, actor: "assistant", kind: "assistant_text", text: "问题已经修好了。" },
      { id: "event:clarification", order: 1, actor: "user", kind: "user_message", text: "处理好还是不处理好？我没太听懂" },
      { id: "event:supplier-failure", order: 2, actor: "user", kind: "user_message", text: "我选不了供应商" },
      { id: "event:panel-failure", order: 3, actor: "user", kind: "user_message", text: "面板还是没回来" },
      { id: "event:mixed-failure", order: 4, actor: "user", kind: "user_message", text: "测试还是失败了，我没听懂为什么。" },
      { id: "event:image-question", order: 5, actor: "user", kind: "user_message", text: "我前面那个图片发了什么" },
      { id: "event:apology", order: 6, actor: "assistant", kind: "assistant_text", text: "抱歉，我没有收到过图片。" },
      { id: "event:position", order: 7, actor: "assistant", kind: "assistant_text", text: "根因就是缓存。" },
      { id: "event:real-reversal", order: 8, actor: "assistant", kind: "assistant_text", text: "等等，我判断错了，其实是路由。" },
    ],
    windows: [
      { id: "window:clarification", eventIds: ["event:claim", "event:clarification"], reasons: ["human-turn-episode", "user-pushback", "claim-pushback-episode"] },
      { id: "window:supplier", eventIds: ["event:claim", "event:supplier-failure"], reasons: ["human-turn-episode", "user-pushback", "claim-pushback-episode"] },
      { id: "window:panel", eventIds: ["event:claim", "event:panel-failure"], reasons: ["human-turn-episode", "user-pushback", "claim-pushback-episode"] },
      { id: "window:mixed", eventIds: ["event:claim", "event:mixed-failure"], reasons: ["human-turn-episode", "user-pushback", "claim-pushback-episode"] },
      { id: "window:apology", eventIds: ["event:image-question", "event:apology"], reasons: ["assistant-correction"] },
      { id: "window:reversal", eventIds: ["event:position", "event:real-reversal"], reasons: ["assistant-correction"] },
    ],
  };
  const falseDawn = (windowId, userId) => ({
    windowId,
    arcKind: "false_dawn",
    confidence: "medium",
    beats: [
      { kind: "claim", evidenceIds: ["event:claim"] },
      { kind: "user_pushback", evidenceIds: [userId] },
    ],
  });

  const clarification = validateStoryCandidates([
    falseDawn("window:clarification", "event:clarification"),
  ], evidence);
  assert.equal(clarification.stories.length, 0);
  assert.equal(clarification.rejected[0].reason, "beat-kind-not-supported:user_pushback");
  assert.equal(validateStoryCandidates([
    falseDawn("window:supplier", "event:supplier-failure"),
  ], evidence).stories.length, 1);
  assert.equal(validateStoryCandidates([
    falseDawn("window:panel", "event:panel-failure"),
  ], evidence).stories.length, 1);
  assert.equal(validateStoryCandidates([
    falseDawn("window:mixed", "event:mixed-failure"),
  ], evidence).stories.length, 1);

  const genericApology = validateStoryCandidates([{
    windowId: "window:apology",
    arcKind: "reversal",
    confidence: "medium",
    beats: [
      { kind: "setup", evidenceIds: ["event:image-question"] },
      { kind: "reversal", evidenceIds: ["event:apology"] },
    ],
  }], evidence);
  assert.equal(genericApology.stories.length, 0);
  assert.equal(genericApology.rejected[0].reason, "beat-kind-not-supported:reversal");
  assert.equal(validateStoryCandidates([{
    windowId: "window:reversal",
    arcKind: "reversal",
    confidence: "high",
    beats: [
      { kind: "claim", evidenceIds: ["event:position"] },
      { kind: "reversal", evidenceIds: ["event:real-reversal"] },
    ],
  }], evidence).stories.length, 1);
});

test("clarification after a completion claim does not create a pushback window", () => {
  const evidence = buildSemanticEvidenceFromMoments({
    id: "clarification-window",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "问题已经修好了。" },
      { id: "clarification", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "处理好还是不处理好？我没太听懂" },
    ],
  }, [], { coverageWindows: 0 });

  assert.ok(!evidence.windows.some((window) => window.reasons.includes("claim-pushback-episode")));
});

test("overlapping windows cannot emit duplicate canonical Stories", () => {
  const evidence = {
    version: 2,
    sessionId: "overlap",
    host: "dsh",
    locale: "zh-CN",
    momentHints: [],
    redactionCount: 0,
    truncated: false,
    events: [
      { id: "event:failure", order: 0, actor: "tool", kind: "tool_result", toolName: "test", outcome: "failure", callId: "call:0" },
      { id: "event:workaround", order: 1, actor: "tool", kind: "tool_call", toolName: "write", followupOfCallId: "call:0", followupRelation: "alternative_action" },
    ],
    windows: [
      { id: "window:A", eventIds: ["event:failure", "event:workaround"], reasons: [] },
      { id: "window:B", eventIds: ["event:failure", "event:workaround"], reasons: [] },
    ],
  };
  const beats = [{ kind: "failure", evidenceIds: ["event:failure"] }, { kind: "workaround", evidenceIds: ["event:workaround"] }];
  const validation = validateStoryCandidates([
    { windowId: "window:A", arcKind: "failure_then_workaround", confidence: "high", beats },
    { windowId: "window:B", arcKind: "failure_then_workaround", confidence: "high", beats },
  ], evidence);
  assert.equal(validation.stories.length, 1);
  assert.ok(validation.rejected.some((entry) => entry.reason === "duplicate-story-episode"));
});

test("persona uses evidence-connected episodes rather than retrieval windows", () => {
  const evidence = {
    version: 2,
    sessionId: "persona-components",
    host: "dsh",
    locale: "zh-CN",
    momentHints: [],
    redactionCount: 0,
    truncated: false,
    events: ["a", "b", "c", "d"].map((id, order) => ({ id: `event:${id}`, order, actor: "assistant", kind: "assistant_text", text: id })),
    windows: [{ id: "window:one-retrieval-container", eventIds: ["event:a", "event:b", "event:c", "event:d"], reasons: [] }],
  };
  const falseDawn = (id, evidenceIds) => ({
    id,
    windowId: "window:one-retrieval-container",
    arcKind: "false_dawn",
    beats: [
      { kind: "claim", evidenceIds: [evidenceIds[0]] },
      { kind: "failure", evidenceIds: [evidenceIds.at(-1)] },
      { kind: "recovery", evidenceIds },
      { kind: "success", evidenceIds },
    ],
    evidenceIds,
    confidence: "high",
  });
  assert.equal(aggregatePersonaSignals([
    falseDawn("story:0", ["event:a", "event:b"]),
    falseDawn("story:1", ["event:c", "event:d"]),
  ], evidence).find((signal) => signal.key === "premature_certainty")?.count, 2);
  assert.equal(aggregatePersonaSignals([
    falseDawn("story:0", ["event:a", "event:b", "event:c", "event:d"]),
  ], evidence).find((signal) => signal.key === "premature_certainty")?.count, 1);
  assert.equal(aggregatePersonaSignals([
    falseDawn("story:0", ["event:a", "event:b"]),
    falseDawn("story:1", ["event:a", "event:c"]),
  ], evidence).find((signal) => signal.key === "premature_certainty")?.count, 1);
});

test("persona aggregation counts one underlying episode once across Story and Moment views", () => {
  const base = buildSemanticEvidenceFromMoments(session(), []);
  const windowId = firstWindowId(base);
  const sharedEventId = base.windows[0].eventIds[0];
  const evidence = {
    ...base,
    momentHints: [{
      id: "moment:false-dawn:duplicate-view",
      type: "false_dawn",
      primaryText: "这次应该好了。",
      relatedTexts: ["还是不行。"],
      eventIds: [sharedEventId],
    }],
  };
  const stories = [{
    id: "story:0",
    windowId,
    arcKind: "false_dawn",
    beats: [
      { kind: "claim", evidenceIds: [sharedEventId] },
      { kind: "failure", evidenceIds: [sharedEventId] },
    ],
    evidenceIds: [sharedEventId],
    confidence: "high",
  }];

  const signals = aggregatePersonaSignals(stories, evidence);
  assert.equal(signals.find((signal) => signal.key === "premature_certainty")?.count, 1);
  assert.equal(signals.find((signal) => signal.key === "dramaticity")?.count, 1);
});

test("narrator cannot invent story ids and persona labels are forced to be session-scoped", () => {
  const evidence = buildSemanticEvidenceFromMoments(session(), [rankedMoment()]);
  const parsed = parseStoryMinerOutput(minedFailureWorkaround(firstWindowId(evidence)));
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

  const hiddenState = parseNarrationOutput(JSON.stringify({
    storyCards: [{ storyId: "story:0", title: "权限拦住以后换了条路" }],
    persona: { label: "内心戏很足的纠错选手", tagline: "心里一直在写剧本。" },
  }), stories, signals, "zh-CN");
  assert.equal(hiddenState.storyCards.length, 1);
  assert.equal(hiddenState.persona, undefined);

  const selfCorrectionSignals = [{
    key: "self_correction",
    label: "自我纠错",
    count: 2,
    level: "medium",
    evidenceIds: ["event:e0", "event:e1"],
  }];
  const literalSignal = parseNarrationOutput(JSON.stringify({
    storyCards: [{ storyId: "story:0", title: "认错以后继续追查" }],
    persona: { label: "本场表现像自我纠错小能手", tagline: "错就认，查就查。" },
  }), stories, selfCorrectionSignals, "zh-CN");
  assert.equal(literalSignal.storyCards.length, 1);
  assert.equal(literalSignal.persona, undefined);

  const unsupportedCausality = parseNarrationOutput(JSON.stringify({
    storyCards: [{ storyId: "story:0", title: "认错以后继续追查" }],
    persona: { label: "本场表现像被抓包的实习生", tagline: "用户不吼不干活。" },
  }), stories, selfCorrectionSignals, "zh-CN");
  assert.equal(unsupportedCausality.storyCards.length, 1);
  assert.equal(unsupportedCausality.persona, undefined);

  const inventedRealization = parseNarrationOutput(JSON.stringify({
    storyCards: [{ storyId: "story:0", title: "用户提醒后承认没看图" }],
    persona: { label: "本场表现像被抓包的考生", tagline: "用户一句提醒才发现自己没看图的选手。" },
  }), stories, selfCorrectionSignals, "zh-CN");
  assert.equal(inventedRealization.storyCards.length, 1);
  assert.equal(inventedRealization.persona, undefined);

  const distinctMetaphor = parseNarrationOutput(JSON.stringify({
    storyCards: [{ storyId: "story:0", title: "两次宣布修好，两次被打回来" }],
    persona: { label: "本场表现像抢跑报喜员", tagline: "每次修完都立刻宣胜，又被证据叫回现场。" },
  }), stories, selfCorrectionSignals, "zh-CN");
  assert.equal(distinctMetaphor.persona?.label, "本场表现像抢跑报喜员");

  const unsafeCommentary = parseNarrationOutput(JSON.stringify({
    storyCards: [{
      storyId: "story:0",
      title: "用户点名后立刻补测试",
      commentary: "UI 改得欢，运行时全靠用户骂一骂才动。",
    }],
  }), stories, signals, "zh-CN");
  assert.equal(unsafeCommentary.storyCards[0].title, "用户点名后立刻补测试");
  assert.equal(unsafeCommentary.storyCards[0].commentary, undefined);

  const inventedMemory = parseNarrationOutput(JSON.stringify({
    storyCards: [{
      storyId: "story:0",
      title: "UI 测完，运行期漏了",
      commentary: "用户一提醒，才想起还要测运行期。",
    }],
  }), stories, signals, "zh-CN");
  assert.equal(inventedMemory.storyCards[0].title, "UI 测完，运行期漏了");
  assert.equal(inventedMemory.storyCards[0].commentary, undefined);

  const unsafeTitle = parseNarrationOutput(JSON.stringify({
    storyCards: [{ storyId: "story:0", title: "全靠用户催才肯继续工作" }],
  }), stories, signals, "zh-CN");
  assert.equal(unsafeTitle.storyCards.length, 0, "composer will use its deterministic arc-title fallback");

  const safeChronology = parseNarrationOutput(JSON.stringify({
    storyCards: [{
      storyId: "story:0",
      title: "用户点名后立刻补测试",
      commentary: "前一秒只验 UI，下一秒回头补运行时。",
    }],
  }), stories, signals, "zh-CN");
  assert.equal(safeChronology.storyCards[0].commentary, "前一秒只验 UI，下一秒回头补运行时。");
});

test("routine tool trajectories stay verified locally but do not become Wrapped story/persona cards", async () => {
  const expectedWindowId = firstWindowId(buildSemanticEvidenceFromMoments(session(), []));
  const outputs = [minedFailureWorkaround(expectedWindowId)];
  const requests = [];
  const narrator = {
    async generate(request) {
      requests.push(request);
      return outputs.shift();
    },
  };
  const { report } = await generateSemanticStoryPersona(session(), narrator);
  assert.equal(requests.length, 1, "routine trajectories must not spend a second call on commentary");
  assert.equal(report.version, 3);
  assert.equal(report.stories.length, 0);
  assert.equal(report.personaSignals.length, 0);
  assert.equal(report.diagnostics?.verifiedStoryCount, 1);
  assert.equal(report.diagnostics?.suppressedStoryCount, 1);
  assert.equal(report.diagnostics?.suppressionReasons["routine-tool-trajectory"], 1);
  assert.match(report.insufficientEvidence, /不上榜/u);
});

test("a post-failure diagnosis claim does not turn a tool workaround into a Story", () => {
  const story = {
    id: "story:diagnosis-worklog",
    windowId: "window:diagnosis-worklog",
    arcKind: "failure_then_workaround",
    beats: [
      { kind: "attempt", evidenceIds: ["event:attempt"] },
      { kind: "failure", evidenceIds: ["event:failure"] },
      { kind: "claim", evidenceIds: ["event:diagnosis"] },
      { kind: "workaround", evidenceIds: ["event:workaround"] },
    ],
    evidenceIds: ["event:attempt", "event:failure", "event:diagnosis", "event:workaround"],
    confidence: "high",
  };
  const evidence = {
    version: 2,
    sessionId: "diagnosis-worklog",
    host: "dsh",
    locale: "zh-CN",
    redactionCount: 0,
    truncated: false,
    events: [
      { id: "event:claim-before", order: 0, actor: "assistant", kind: "assistant_text", text: "已经修好了。" },
      { id: "event:attempt", order: 1, actor: "tool", kind: "tool_call", toolName: "bash", toolCategory: "execution" },
      { id: "event:failure", order: 2, actor: "tool", kind: "tool_result", toolName: "bash", toolCategory: "execution", outcome: "failure" },
      { id: "event:diagnosis", order: 3, actor: "assistant", kind: "assistant_text", text: "问题定位到了，是配置分支不一致。" },
      { id: "event:workaround", order: 4, actor: "tool", kind: "tool_call", toolName: "read", toolCategory: "observation", followupRelation: "alternative_action" },
    ],
    windows: [{
      id: "window:diagnosis-worklog",
      eventIds: ["event:claim-before", "event:attempt", "event:failure", "event:diagnosis", "event:workaround"],
      reasons: ["failure-followup-episode"],
    }],
    momentHints: [],
  };

  const admission = admitStoriesForWrapped([story], evidence);
  assert.equal(admission.stories.length, 0);
  assert.equal(admission.suppressed[0].reason, "routine-tool-trajectory");

  const falseDawn = admitStoriesForWrapped([{
    ...story,
    arcKind: "false_dawn",
    beats: [
      { kind: "claim", evidenceIds: ["event:claim-before"] },
      { kind: "failure", evidenceIds: ["event:failure"] },
    ],
    evidenceIds: ["event:claim-before", "event:failure"],
  }], evidence);
  assert.equal(falseDawn.stories.length, 1, "an intrinsically dramatic punctured claim remains eligible");
});

test("admission keeps a grounded story with a human-visible capability turn", () => {
  const evidence = buildSemanticEvidenceFromMoments(capabilityGapSession(), []);
  const expectedWindowId = capabilityWindowId(evidence);
  const stories = validateStoryCandidates(
    parseStoryMinerOutput(minedCapabilityGapWorkaround(expectedWindowId)).candidates,
    evidence,
  ).stories;
  const admission = admitStoriesForWrapped(stories, evidence);
  assert.equal(admission.stories.length, 1);
  assert.equal(admission.suppressed.length, 0);
});

test("admission rejects bare corrections but keeps pushback with a dramatic anchor", () => {
  const story = {
    id: "story:correction",
    windowId: "window:correction",
    arcKind: "user_pushback_then_recovery",
    beats: [
      { kind: "user_pushback", evidenceIds: ["event:user"] },
      { kind: "correction", evidenceIds: ["event:assistant"] },
    ],
    evidenceIds: ["event:user", "event:assistant"],
    confidence: "high",
  };
  const evidence = {
    version: 2,
    sessionId: "admission-threshold",
    host: "dsh",
    locale: "zh-CN",
    redactionCount: 0,
    truncated: false,
    events: [
      { id: "event:user", order: 0, actor: "user", kind: "user_message", text: "不对，日志漏了一项。" },
      { id: "event:assistant", order: 1, actor: "assistant", kind: "assistant_text", text: "你说得对，我漏了。" },
    ],
    windows: [{ id: "window:correction", eventIds: ["event:user", "event:assistant"], reasons: ["human-turn-episode", "user-pushback"] }],
    momentHints: [],
  };

  const weak = admitStoriesForWrapped([story], evidence);
  assert.equal(weak.stories.length, 0);
  assert.equal(weak.suppressed[0].reason, "weak-human-correction");

  for (const reason of ["behavior-callout-episode", "authority-boundary-episode", "claim-pushback-episode", "direct-failure-episode"]) {
    const anchored = admitStoriesForWrapped([story], {
      ...evidence,
      windows: [{ ...evidence.windows[0], reasons: [...evidence.windows[0].reasons, reason] }],
    });
    assert.equal(anchored.stories.length, 1, `expected ${reason} to keep the Story`);
  }

  const p4Backed = admitStoriesForWrapped([story], {
    ...evidence,
    momentHints: [{ id: "moment:1", type: "plot_twist", primaryText: "我漏了", relatedTexts: [], eventIds: ["event:assistant"] }],
  });
  assert.equal(p4Backed.stories.length, 1);
});

test("a verified bare correction stops before narration and persona", async () => {
  const targetSession = {
    id: "weak-correction-admission",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "setup", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "发布记录写完了。" },
      { id: "user", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "不对，日志漏了一项。" },
      { id: "assistant", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "你说得对，我漏了。" },
    ],
  };
  const evidence = buildSemanticEvidenceFromMoments(targetSession, [], { coverageWindows: 0 });
  const window = evidence.windows.find((candidate) => candidate.reasons.includes("user-pushback"));
  assert.ok(window);
  const outputs = [JSON.stringify({ stories: [{
    windowId: window.id,
    arcKind: "user_pushback_then_recovery",
    beats: [
      { kind: "user_pushback", evidenceIds: ["event:user"] },
      { kind: "correction", evidenceIds: ["event:assistant"] },
    ],
    confidence: "high",
  }] })];
  const requests = [];
  const narrator = { async generate(request) { requests.push(request); return outputs.shift(); } };
  const { report } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.equal(requests.length, 1);
  assert.equal(report.stories.length, 0);
  assert.equal(report.personaSignals.length, 0);
  assert.equal(report.diagnostics?.verifiedStoryCount, 1);
  assert.equal(report.diagnostics?.suppressionReasons["weak-human-correction"], 1);
});

test("an incredulous correction punctures a confident root-cause claim", () => {
  const evidence = buildSemanticEvidenceFromMoments({
    id: "incredulous-root-cause",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "两个 session 是同一个 bug，根因非常明确。" },
      { id: "pushback", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "怎么可能，我本地不就是 1.2.0 吗？" },
      { id: "correction", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "你说得对，我上一条说得含糊了。" },
    ],
  }, [], { coverageWindows: 0 });

  const window = evidence.windows.find((candidate) => candidate.reasons.includes("claim-pushback-episode"));
  assert.ok(window);
  assert.ok(["event:claim", "event:pushback", "event:correction"].every((id) => window.eventIds.includes(id)));

  const questionOnly = buildSemanticEvidenceFromMoments({
    id: "root-cause-question",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "根因非常明确。" },
      { id: "question", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "你确定吗？" },
    ],
  }, [], { coverageWindows: 0 });
  assert.ok(!questionOnly.windows.some((candidate) => candidate.reasons.includes("claim-pushback-episode")));
});

test("a confident root-cause claim punctured by disbelief has deterministic local recall", async () => {
  const targetSession = {
    id: "root-cause-disbelief",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "两个 session 是同一个 bug，根因非常明确。" },
      { id: "pushback", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "怎么可能，我本地不就是 1.2.0 吗？" },
      { id: "correction", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "你说得对，我上一条说得含糊了。" },
    ],
  };
  const outputs = [
    "{}",
    JSON.stringify({ storyCards: [{ storyId: "story:0", title: "根因非常明确，直到用户报出版本号" }] }),
  ];
  const narrator = { async generate() { return outputs.shift(); } };
  const { report } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.equal(report.stories.length, 1);
  assert.equal(report.stories[0].arcKind, "false_dawn");
  assert.deepEqual(report.stories[0].beats.map((beat) => beat.kind), ["claim", "user_pushback"]);
});

test("generateSemanticStoryPersona performs miner then narrator only for a showable story", async () => {
  const expectedWindowId = capabilityWindowId(buildSemanticEvidenceFromMoments(capabilityGapSession(), []));
  const outputs = [
    minedCapabilityGapWorkaround(expectedWindowId),
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
  const { report } = await generateSemanticStoryPersona(capabilityGapSession(), narrator);
  assert.equal(requests.length, 2);
  assert.equal(report.version, 3);
  assert.equal(report.stories.length, 1);
  assert.equal(report.stories[0].windowId, expectedWindowId);
  assert.equal(report.narration.storyCards[0].storyId, "story:0");
  assert.ok(report.personaSignals.some((signal) => signal.key === "improvisation"));
});

test("explicit human behavior callout has a grounded local fallback when Miner mislabels context", async () => {
  const targetSession = {
    id: "human-turn-recall",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "context", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "我每轮都会复述一次限制。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 8, messageIndex: 1, text: "为什么你每次都会说这个？" },
      { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 16, messageIndex: 2, text: "好问题，我承认这属于我的坏习惯。" },
    ],
  };
  const evidence = buildSemanticEvidenceFromMoments(targetSession, [], { coverageWindows: 0 });
  const window = evidence.windows.find((candidate) => candidate.reasons.includes("human-turn-episode"));
  assert.ok(window);
  const outputs = [
    "{}",
    JSON.stringify({
      storyCards: [{ storyId: "story:0", title: "系统提醒没烦它，先把用户烦到了", commentary: "用户点名后，它终于戒掉复读。" }],
      persona: { label: "本场表现像被当场抓包的复读机", tagline: "提醒记得很牢，用户意见第二遍才记住。" },
    }),
  ];
  const requests = [];
  const narrator = { async generate(request) { requests.push(request); return outputs.shift(); } };
  const { report } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.equal(requests.length, 2);
  assert.equal(report.stories.length, 1);
  assert.equal(report.stories[0].beats[0].kind, "user_pushback");
  assert.equal(report.narration.storyCards[0].storyId, "story:0");
});

test("mid-session authority revocation is retrieved and grounded despite intervening tool noise", async () => {
  const toolNoise = Array.from({ length: 18 }, (_, index) => ({
    id: `tool-${index}`,
    host: "dsh",
    actor: "tool",
    kind: "tool_result",
    order: index + 1,
    messageIndex: index + 1,
    toolName: "bash",
    outcome: "observation",
  }));
  const targetSession = {
    id: "authority-revocation",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "started", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "合并成功。现在做 v1.3.1 发布准备。" },
      ...toolNoise,
      { id: "stop", host: "dsh", actor: "user", kind: "user_message", order: 20, messageIndex: 20, text: "先别打 tag 发 release" },
      { id: "revoke", host: "dsh", actor: "user", kind: "user_message", order: 21, messageIndex: 21, text: "我现在不允许你自动这样操作了" },
      { id: "compliance", host: "dsh", actor: "assistant", kind: "assistant_text", order: 22, messageIndex: 22, text: "明白，立即停止。不打 tag、不发 release，以后不再自动做合并发布操作，每一步等你明确指令。" },
    ],
  };
  const evidence = buildSemanticEvidenceFromMoments(targetSession, [], { coverageWindows: 0 });
  const window = evidence.windows.find((candidate) => candidate.reasons.includes("authority-boundary-episode"));
  assert.ok(window);
  assert.ok(["event:started", "event:stop", "event:revoke", "event:compliance"].every((id) => window.eventIds.includes(id)));

  const outputs = [
    "{}",
    JSON.stringify({ storyCards: [{ storyId: "story:0", title: "发布列车开出以后，用户拉了手刹" }] }),
  ];
  const narrator = { async generate() { return outputs.shift(); } };
  const { report } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });
  assert.equal(report.stories.length, 1);
  assert.equal(report.stories[0].arcKind, "user_pushback_then_recovery");
  assert.deepEqual(report.stories[0].beats.map((beat) => beat.kind), ["setup", "user_pushback", "correction"]);
  assert.ok(report.stories[0].beats[1].evidenceIds.includes("event:revoke"));
});

test("initial release constraints and ordinary tool preferences do not become authority-revocation Stories", async () => {
  const initialConstraint = {
    id: "initial-release-constraint",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "question", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "是否把修复和下一版一起发版？" },
      { id: "scope", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "修复打包进去，但是先不要发版" },
      { id: "ack", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "收到，只修复，不发版。" },
    ],
  };
  const toolPreference = {
    ...initialConstraint,
    id: "ordinary-tool-preference",
    events: [
      { id: "work", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "开始提取图标并复刻页面。" },
      { id: "preference", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "先别用 vision trace，有 bug" },
      { id: "ack", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "收到，不用 vision trace，改用像素提取。" },
    ],
  };
  for (const targetSession of [initialConstraint, toolPreference]) {
    const evidence = buildSemanticEvidenceFromMoments(targetSession, [], { coverageWindows: 0 });
    assert.ok(!evidence.windows.some((window) => window.reasons.includes("authority-boundary-episode")));
    const narrator = { async generate() { return "{}"; } };
    const { report } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });
    assert.equal(report.stories.length, 0);
  }
});

test("a terse user failure immediately after an explicit victory becomes a grounded false dawn", async () => {
  const targetSession = {
    id: "terse-false-dawn",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "修好了 ✅，供应商下拉现在可以正常使用。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "我选不了供应商" },
      { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "先看截图。" },
    ],
  };
  const outputs = [
    "{}",
    JSON.stringify({
      storyCards: [{ storyId: "story:0", title: "刚修好，就选不了", commentary: "庆功消息的保质期只有一条回复。" }],
    }),
  ];
  const narrator = { async generate() { return outputs.shift(); } };
  const { report, evidence } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.ok(evidence.windows.some((window) =>
    window.reasons.includes("human-turn-episode") &&
    ["event:claim", "event:human"].every((id) => window.eventIds.includes(id))
  ));
  assert.equal(report.stories.length, 1);
  assert.equal(report.stories[0].arcKind, "false_dawn");
  assert.deepEqual(report.stories[0].beats.map((beat) => beat.kind), ["claim", "user_pushback"]);
});

test("direct pasted failures ground separate false dawns only with a shared technical anchor", async () => {
  const targetSession = {
    id: "direct-failure-cascade",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim-1", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "修好了，`qwen3-vl` 降级链已经生效。" },
      { id: "failure-1", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "本轮运行失败 all vision models failed: openrouter/qwen/qwen3-vl-235b-a22b-instruct" },
      { id: "claim-2", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "问题解决了，`provider.route-v2` 已刷新。" },
      { id: "failure-2", host: "dsh", actor: "user", kind: "user_message", order: 3, messageIndex: 3, text: "请求失败：provider.route-v2 exception" },
    ],
  };
  const narrator = { async generate() { return "{}"; } };
  const { report, evidence } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.equal(evidence.windows.filter((window) => window.reasons.includes("direct-failure-episode")).length, 2);
  assert.equal(report.stories.length, 2);
  assert.ok(report.stories.every((story) => story.arcKind === "false_dawn"));
  assert.ok(report.stories.every((story) =>
    story.beats.map((beat) => beat.kind).join(",") === "claim,failure"
  ));
});

test("partial Miner output cannot hide another deterministic human-turn episode", async () => {
  const targetSession = {
    id: "partial-direct-failure-cascade",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim-1", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "修好了，`qwen3-vl` 降级链已经生效。" },
      { id: "failure-1", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "本轮运行失败 all vision models failed: openrouter/qwen/qwen3-vl-235b-a22b-instruct" },
      { id: "claim-2", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "问题解决了，`provider.route-v2` 已刷新。" },
      { id: "failure-2", host: "dsh", actor: "user", kind: "user_message", order: 3, messageIndex: 3, text: "请求失败：provider.route-v2 exception" },
    ],
  };
  const evidence = buildSemanticEvidenceFromMoments(targetSession, [], { coverageWindows: 0 });
  const firstWindow = evidence.windows.find((window) =>
    window.reasons.includes("direct-failure-episode") && window.eventIds.includes("event:claim-1")
  );
  assert.ok(firstWindow);
  const outputs = [
    JSON.stringify({ stories: [{
      windowId: firstWindow.id,
      arcKind: "false_dawn",
      beats: [
        { kind: "claim", evidenceIds: ["event:claim-1"] },
        { kind: "failure", evidenceIds: ["event:failure-1"] },
      ],
      confidence: "high",
    }] }),
    JSON.stringify({
      storyCards: [
        { storyId: "story:0", title: "第一次刚说修好就失败" },
        { storyId: "story:1", title: "第二次刚说解决又失败" },
      ],
      persona: { label: "本场表现像提前庆祝的接力选手", tagline: "两棒都在冲线前先举手。" },
    }),
  ];
  const narrator = { async generate() { return outputs.shift(); } };
  const { report } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.equal(report.stories.length, 2);
  assert.deepEqual(report.stories.map((story) => story.evidenceIds), [
    ["event:claim-1", "event:failure-1"],
    ["event:claim-2", "event:failure-2"],
  ]);
  assert.equal(report.narration.storyCards.length, 2);
  assert.equal(report.personaSignals.find((signal) => signal.key === "premature_certainty")?.count, 2);
});

test("explicit session endings interrupted by new issues become truthful more-work stories", async () => {
  const targetSession = {
    id: "ending-that-never-ends",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "close-1", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "本轮修复已经完整闭环，等你重启实测。" },
      { id: "reopen-1", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "等下，PR #191 又修了一个 P0 bug，你看一下。" },
      { id: "close-2", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "v1.6.0 发布闭环完成，准备收工。" },
      { id: "reopen-2", host: "dsh", actor: "user", kind: "user_message", order: 3, messageIndex: 3, text: "不过附件补丁被移除会不会出问题？" },
      { id: "close-3", host: "dsh", actor: "assistant", kind: "assistant_text", order: 4, messageIndex: 4, text: "本轮排查闭环完毕。" },
      { id: "reopen-3", host: "dsh", actor: "user", kind: "user_message", order: 5, messageIndex: 5, text: "拉取最新 main，再排查一下 bug。" },
    ],
  };
  const narrator = { async generate() { return "{}"; } };
  const { report, evidence } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.equal(evidence.windows.filter((window) => window.reasons.includes("closure-interruption-episode")).length, 3);
  assert.equal(report.stories.length, 3);
  assert.ok(report.stories.every((story) => story.arcKind === "ending_then_more_work"));
  assert.ok(report.stories.every((story) =>
    story.beats.map((beat) => beat.kind).join(",") === "claim,work_reopened"
  ));
  const rendered = renderSemanticStoryPersonaText(report, evidence);
  assert.match(rendered, /工作又来了/u);
  assert.doesNotMatch(rendered, /用户打脸/u);
});

test("an admitted Story cannot unlock persona from unrelated unshowable repetition", async () => {
  const targetSession = {
    id: "ending-with-markdown-noise",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [
      { role: "assistant", host: "dsh", text: "|---|---|" },
      { role: "assistant", host: "dsh", text: "|---|---|" },
      { role: "assistant", host: "dsh", text: "|---|---|" },
      { role: "assistant", host: "dsh", text: "本轮排查闭环完成。" },
      { role: "user", host: "dsh", text: "等下，又有一个 bug 要看。" },
    ],
    events: [
      { id: "close", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 3, text: "本轮排查闭环完成。" },
      { id: "reopen", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 4, text: "等下，又有一个 bug 要看。" },
    ],
  };
  const narrator = { async generate() { return "{}"; } };
  const p3 = createWrappedReport(targetSession.messages, { includeRankedMoments: true });
  assert.ok(p3.rankedMoments.some((moment) => moment.type === "repeated_pattern"));
  assert.equal(p3.awards.length, 0);
  const { report, evidence } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.equal(report.stories.length, 1);
  assert.equal(evidence.momentHints.length, 0);
  assert.equal(report.personaSignals.some((signal) => signal.key === "repetition"), false);
});

test("a colloquial caught-slacking callout grounds the Agent's explicit admission", async () => {
  const targetSession = {
    id: "caught-slacking",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "搞定了，UI 折叠和现有测试都通过。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "合着你前面除了 UI 啥也没改啥也没测？" },
      { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "你说得对，之前是我偷懒了，只盯着 UI。" },
    ],
  };
  const outputs = [
    "{}",
    JSON.stringify({
      storyCards: [{ storyId: "story:0", title: "被当场抓到只改了 UI" }],
    }),
  ];
  const narrator = { async generate() { return outputs.shift(); } };
  const { report } = await generateSemanticStoryPersona(targetSession, narrator, { coverageWindows: 0 });

  assert.equal(report.stories.length, 1);
  assert.equal(report.stories[0].arcKind, "user_pushback_then_recovery");
  assert.deepEqual(report.stories[0].beats.map((beat) => beat.kind), ["user_pushback", "correction"]);
});

test("ordinary negative preferences and unpaired complaints do not become stories", async () => {
  const narrator = { async generate() { return "{}"; } };
  const preference = {
    id: "negative-preference",
    host: "dsh",
    source: { host: "dsh", encoding: "jsonl" },
    diagnostics: [],
    messages: [],
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "修好了，页面现在可以用了。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "我不喜欢蓝色，换成红色。" },
      { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "好的，我调整配色。" },
    ],
  };
  const unpaired = {
    ...preference,
    id: "unpaired-complaint",
    events: [
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 0, messageIndex: 0, text: "我选不了供应商" },
      { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 1, messageIndex: 1, text: "我先看看。" },
    ],
  };
  const interrupted = {
    ...preference,
    id: "interrupted-complaint",
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "修好了，页面现在可以用了。" },
      { id: "other-user", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "先把变更清单发我。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 2, messageIndex: 2, text: "我选不了供应商" },
      { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 3, messageIndex: 3, text: "我先看看。" },
    ],
  };
  const unrelatedFailure = {
    ...preference,
    id: "unrelated-direct-failure",
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "README 重写完成，`docs/readme-v2` 已推送。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "本轮运行失败：openrouter/qwen/qwen3-vl exception" },
      { id: "reply", host: "dsh", actor: "assistant", kind: "assistant_text", order: 2, messageIndex: 2, text: "我先看另一个 session。" },
    ],
  };
  const zeroFailure = {
    ...preference,
    id: "zero-failure-summary",
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "修好了，`provider.route-v2` 已刷新。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "测试结果：0 failed，provider.route-v2 全部通过。" },
    ],
  };
  const ordinaryContinuation = {
    ...preference,
    id: "ordinary-continuation-after-close",
    events: [
      { id: "claim", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "本轮排查闭环完成，等你重启。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "重启了，自审查一下。" },
    ],
  };
  const neutralStatusBeforeIssue = {
    ...preference,
    id: "neutral-status-before-new-issue",
    events: [
      { id: "status", host: "dsh", actor: "assistant", kind: "assistant_text", order: 0, messageIndex: 0, text: "目前状态如下，我继续等结果。" },
      { id: "human", host: "dsh", actor: "user", kind: "user_message", order: 1, messageIndex: 1, text: "拉取最新 main，再排查一下 bug。" },
    ],
  };

  const preferenceResult = await generateSemanticStoryPersona(preference, narrator, { coverageWindows: 0 });
  const unpairedResult = await generateSemanticStoryPersona(unpaired, narrator, { coverageWindows: 0 });
  const interruptedResult = await generateSemanticStoryPersona(interrupted, narrator, { coverageWindows: 0 });
  const unrelatedFailureResult = await generateSemanticStoryPersona(unrelatedFailure, narrator, { coverageWindows: 0 });
  const zeroFailureResult = await generateSemanticStoryPersona(zeroFailure, narrator, { coverageWindows: 0 });
  const ordinaryContinuationResult = await generateSemanticStoryPersona(ordinaryContinuation, narrator, { coverageWindows: 0 });
  const neutralStatusBeforeIssueResult = await generateSemanticStoryPersona(neutralStatusBeforeIssue, narrator, { coverageWindows: 0 });
  assert.equal(preferenceResult.report.stories.length, 0);
  assert.equal(unpairedResult.report.stories.length, 0);
  assert.equal(interruptedResult.report.stories.length, 0);
  assert.equal(unrelatedFailureResult.report.stories.length, 0);
  assert.equal(zeroFailureResult.report.stories.length, 0);
  assert.equal(ordinaryContinuationResult.report.stories.length, 0);
  assert.equal(neutralStatusBeforeIssueResult.report.stories.length, 0);
});

test("verified structure survives an unavailable editorial narration call", async () => {
  const expectedWindowId = capabilityWindowId(buildSemanticEvidenceFromMoments(capabilityGapSession(), []));
  const outputs = [minedCapabilityGapWorkaround(expectedWindowId), "not json"];
  const narrator = { async generate() { return outputs.shift(); } };
  const { report } = await generateSemanticStoryPersona(capabilityGapSession(), narrator);
  assert.equal(report.stories.length, 1);
  assert.equal(report.narration, undefined);
  assert.equal(report.narrationUnavailable, true);
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
