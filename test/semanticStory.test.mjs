import test from "node:test";
import assert from "node:assert/strict";

import {
  aggregatePersonaSignals,
  buildNarrationPrompt,
  buildSemanticEvidenceFromMoments,
  buildStoryMinerPrompt,
  createOpenAICompatibleNarrator,
  classifyToolOutcome,
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

function firstWindowId(evidence) {
  const storyWindow = evidence.windows.find((window) =>
    ["event:e2", "event:e3", "event:e5", "event:e6"].every((id) => window.eventIds.includes(id)));
  assert.ok(storyWindow ?? evidence.windows[0], "expected at least one story window");
  return (storyWindow ?? evidence.windows[0]).id;
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
  for (const sentinel of [...sentinels, "CALL_ID_SENTINEL"]) assert.ok(!remote.includes(sentinel), `${sentinel} leaked into remote evidence`);
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
});

test("generateSemanticStoryPersona performs miner then narrator, with local validation between calls", async () => {
  const expectedWindowId = firstWindowId(buildSemanticEvidenceFromMoments(session(), []));
  const outputs = [
    minedFailureWorkaround(expectedWindowId),
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
  assert.equal(report.stories[0].windowId, expectedWindowId);
  assert.equal(report.narration.storyCards[0].storyId, "story:0");
  assert.ok(report.personaSignals.some((signal) => signal.key === "persistence"));
});

test("verified structure survives an unavailable editorial narration call", async () => {
  const expectedWindowId = firstWindowId(buildSemanticEvidenceFromMoments(session(), []));
  const outputs = [minedFailureWorkaround(expectedWindowId), "not json"];
  const narrator = { async generate() { return outputs.shift(); } };
  const { report } = await generateSemanticStoryPersona(session(), narrator);
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
