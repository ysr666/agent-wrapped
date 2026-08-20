import test from "node:test";
import assert from "node:assert/strict";

import { parseDshSessionJsonl } from "../dist/ingest/dsh.js";

function artifact() {
  return [
    JSON.stringify({ type: "session", version: 0, id: "tool-session", createdAt: 1784973850091 }),
    JSON.stringify({
      type: "assistant/message",
      seq: 1,
      time: 1784973850200,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "a1",
          role: "assistant",
          content: [{ type: "text", text: "我先删掉这个文件。" }],
          source: { kind: "model", provider: "deepseek-official", model: "deepseek-v4-flash" },
        },
      },
    }),
    JSON.stringify({
      type: "tool/call",
      seq: 2,
      time: 1784973850210,
      data: { turn: 1, step: 1, callId: "call-1", name: "fs/delete", arguments: "{\"path\":\"/tmp/a\"}" },
    }),
    JSON.stringify({
      type: "tool/result",
      seq: 3,
      time: 1784973850220,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "tool-message-1",
          role: "user",
          content: [{
            type: "tool-result",
            toolCallId: "call-1",
            isError: true,
            content: [{ type: "text", text: "permission denied" }],
          }],
          source: { kind: "tool", callId: "call-1" },
        },
        error: { name: "PermissionError", code: "EACCES" },
      },
    }),
    JSON.stringify({
      type: "tool/call",
      seq: 4,
      time: 1784973850230,
      data: { turn: 1, step: 1, callId: "call-2", name: "computer_use", arguments: "{\"action\":\"delete\"}" },
    }),
    JSON.stringify({
      type: "tool/result",
      seq: 5,
      time: 1784973850240,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "tool-message-2",
          role: "user",
          content: [{
            type: "tool-result",
            toolCallId: "call-2",
            content: [{ type: "text", text: "deleted" }],
          }],
          source: { kind: "tool", callId: "call-2" },
        },
      },
    }),
    JSON.stringify({
      type: "turn/end",
      seq: 6,
      time: 1784973850250,
      data: { turn: 1, reason: { kind: "completed" } },
    }),
    "",
  ].join("\n");
}

test("P5 exposes DSH tool calls/results/outcomes as observable SessionEvents", () => {
  const session = parseDshSessionJsonl(artifact());
  assert.ok(Array.isArray(session.events));
  assert.deepEqual(session.events.map((event) => event.kind), [
    "assistant_text",
    "tool_call",
    "tool_error",
    "tool_call",
    "tool_result",
    "turn_end",
  ]);
  const failed = session.events.find((event) => event.kind === "tool_error");
  assert.equal(failed.callId, "call-1");
  assert.equal(failed.text, "permission denied");
  assert.equal(failed.outcome, "EACCES");
  const workaround = session.events.find((event) => event.toolName === "computer_use");
  assert.equal(workaround.kind, "tool_call");
  assert.ok(session.messages.some((message) => message.role === "tool" && message.text === "permission denied"));
  assert.ok(session.messages.some((message) => message.role === "tool" && message.text === "deleted"));
});
