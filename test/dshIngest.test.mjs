import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as zlib from "node:zlib";

import { parseDshSessionJsonl } from "../dist/ingest/dsh.js";
import {
  discoverDshSessionFiles,
  loadDshSessions,
  readDshSessionFile,
  resolveDshSessionsRoot,
} from "../dist/ingest/dshFilesystem.js";

/** Mirrors the current DSH SessionEventMap shape from @deepseek-ai/dsh-session. */
function dshJsonl(sessionId = "session-123") {
  return [
    JSON.stringify({
      type: "session",
      version: 0,
      id: sessionId,
      createdAt: 1784973850091,
      cwd: "/work/project",
    }),
    JSON.stringify({
      type: "user/message",
      seq: 1,
      time: 1784973850103,
      surfaceOp: "append",
      data: {
        id: "user-message-1",
        role: "user",
        content: [{ type: "text", text: "帮我看看这个问题" }],
        source: { kind: "user" },
      },
    }),
    JSON.stringify({
      type: "session/title",
      seq: 2,
      time: 1784973850105,
      data: { title: "排查缓存问题" },
    }),
    // Streaming chunks must not be counted again once assistant/message exists.
    JSON.stringify({
      type: "assistant/chunk",
      seq: 3,
      time: 1784973850200,
      data: { turn: 1, step: 1, chunk: { type: "text-delta", index: 1, text: "重大发现" } },
    }),
    JSON.stringify({
      type: "assistant/message",
      seq: 4,
      time: 1784973850300,
      surfaceOp: "append",
      sourceEventSeqs: [3],
      data: {
        turn: 1,
        step: 1,
        message: {
          id: "assistant-message-1",
          role: "assistant",
          content: [
            { type: "reasoning", text: "internal-ish reasoning surface" },
            { type: "text", text: "重大发现！！！我们前面的路线完全错了！" },
          ],
          source: {
            kind: "model",
            provider: "deepseek-official",
            model: "deepseek-v4-flash",
          },
        },
      },
    }),
    "",
  ].join("\n");
}

function legacyDshJsonl() {
  return [
    JSON.stringify({
      type: "session",
      version: 0,
      id: "legacy-session",
      createdAt: 1784973850091,
    }),
    JSON.stringify({
      type: "assistant/message",
      seq: 1,
      time: 1784973850300,
      data: {
        turn: 1,
        step: 1,
        content: [{ type: "text", text: "旧格式也应该继续能读。" }],
        provenance: { provider: "legacy-provider", model: "legacy-model" },
      },
    }),
    "",
  ].join("\n");
}

test("P5 parses current durable DSH messages without double-counting streaming chunks", () => {
  const session = parseDshSessionJsonl(dshJsonl());
  assert.equal(session.id, "session-123");
  assert.equal(session.title, "排查缓存问题");
  assert.equal(session.cwd, "/work/project");
  assert.equal(session.provider, "deepseek-official");
  assert.equal(session.model, "deepseek-v4-flash");
  assert.equal(session.messages.length, 2);
  assert.equal(session.messages[0].role, "user");
  assert.equal(session.messages[0].metadata?.dshMessageId, "user-message-1");
  assert.equal(session.messages[1].role, "assistant");
  assert.equal(session.messages[1].text, "重大发现！！！我们前面的路线完全错了！");
  assert.equal(session.messages[1].metadata?.dshMessageId, "assistant-message-1");
  assert.equal(session.messages[1].metadata?.dshMessageShape, "current");
  assert.equal(session.messages[1].metadata?.provider, "deepseek-official");
  assert.ok(!session.messages.some((message) => message.text === "重大发现"));
  assert.ok(session.diagnostics.some((entry) => entry.code === "reasoning-skipped"));
  assert.ok(!session.diagnostics.some((entry) => entry.code === "no-visible-assistant-messages"));
});

test("P5 only includes DSH reasoning when explicitly marked as visible by the caller", () => {
  const session = parseDshSessionJsonl(dshJsonl(), { includeVisibleReasoning: true });
  const assistant = session.messages.filter((message) => message.role === "assistant");
  assert.equal(assistant.length, 2);
  assert.equal(assistant[0].text, "internal-ish reasoning surface");
  assert.equal(assistant[0].metadata?.visibleReasoning, true);
  assert.equal(assistant[1].text, "重大发现！！！我们前面的路线完全错了！");
});

test("P5 retains compatibility with the earlier direct-content assistant envelope", () => {
  const session = parseDshSessionJsonl(legacyDshJsonl());
  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].role, "assistant");
  assert.equal(session.messages[0].text, "旧格式也应该继续能读。");
  assert.equal(session.messages[0].metadata?.dshMessageShape, "legacy");
  assert.equal(session.provider, "legacy-provider");
  assert.equal(session.model, "legacy-model");
});

test("P5 emits an explicit warning when assistant/message exists but its envelope is unknown", () => {
  const broken = [
    JSON.stringify({ type: "session", version: 0, id: "broken-session", createdAt: 1784973850091 }),
    JSON.stringify({ type: "assistant/message", seq: 1, data: { turn: 1, step: 1, response: "unknown" } }),
    "",
  ].join("\n");
  const session = parseDshSessionJsonl(broken);
  assert.ok(session.diagnostics.some((entry) => entry.code === "assistant-message-shape-unrecognized"));
  assert.ok(session.diagnostics.some((entry) => entry.code === "no-visible-assistant-messages"));
});

test("P5 tolerates a real-shaped image-only user message without inventing text", () => {
  const imageOnly = [
    JSON.stringify({ type: "session", version: 0, id: "image-only-session", createdAt: 1784973850091 }),
    JSON.stringify({
      type: "user/message",
      seq: 1,
      data: {
        id: "image-1",
        role: "user",
        content: [{ type: "image", mimeType: "image/png", data: "opaque-local-bytes" }],
        source: { kind: "user" },
      },
    }),
    "",
  ].join("\n");
  const session = parseDshSessionJsonl(imageOnly);
  assert.equal(session.messages.length, 0);
  assert.equal(session.events?.length, 0);
  assert.ok(session.diagnostics.some((entry) => entry.code === "no-visible-assistant-messages"));
});

test("P5 keeps DSH host injections local without treating them as human speech", () => {
  const jsonl = [
    JSON.stringify({ type: "session", version: 0, id: "source-kind-session", createdAt: 1784973850091 }),
    JSON.stringify({
      type: "user/message",
      seq: 1,
      data: {
        id: "instructions-1",
        content: [{ type: "text", text: "HOST_INSTRUCTION_SENTINEL" }],
        source: { kind: "agent-instructions" },
      },
    }),
    JSON.stringify({
      type: "user/message",
      seq: 2,
      data: {
        id: "human-1",
        content: [{ type: "text", text: "你第一轮竟然没看图" }],
        source: { kind: "user" },
      },
    }),
    JSON.stringify({
      type: "user/message",
      seq: 3,
      data: {
        id: "plugin-1",
        content: [{ type: "text", text: "PLUGIN_RUNTIME_SENTINEL" }],
        source: { kind: "plugin" },
      },
    }),
    "",
  ].join("\n");
  const session = parseDshSessionJsonl(jsonl);

  assert.deepEqual(session.messages.map((message) => message.role), ["system", "user", "system"]);
  assert.deepEqual(session.events?.map((event) => event.actor), ["system", "user", "system"]);
  assert.deepEqual(session.events?.map((event) => event.kind), ["unknown", "user_message", "unknown"]);
  assert.equal(session.messages[0].text, "HOST_INSTRUCTION_SENTINEL");
  assert.equal(session.messages[2].text, "PLUGIN_RUNTIME_SENTINEL");
  assert.equal(session.messages[0].metadata?.sourceKind, "agent-instructions");
  assert.equal(session.events?.[2].metadata?.sourceKind, "plugin");
});

test("P5 resolves the DSH sessions root from DSH_HOME", () => {
  const root = resolveDshSessionsRoot(undefined, { DSH_HOME: "/tmp/custom-dsh" });
  assert.equal(root, join("/tmp/custom-dsh", "sessions"));
});

function zstdCompress(input) {
  const fn = zlib.zstdCompress;
  assert.equal(typeof fn, "function", "Node 22+ zstd API is required for this CI test");
  return new Promise((resolve, reject) => {
    fn(Buffer.from(input), (error, result) => (error ? reject(error) : resolve(Buffer.from(result))));
  });
}

test("P5 discovers plaintext and default DSH zstd session files newest-first", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-wrapped-dsh-"));
  const project = join(root, "--work-project--");
  const oldDir = join(project, "old");
  const newDir = join(project, "new");
  await mkdir(oldDir, { recursive: true });
  await mkdir(newDir, { recursive: true });
  const oldPath = join(oldDir, "session.jsonl");
  const newPath = join(newDir, "session.jsonl.zstd");
  await writeFile(oldPath, dshJsonl());
  await new Promise((resolve) => setTimeout(resolve, 10));
  const logical = dshJsonl().split("\n");
  const firstFrame = await zstdCompress(`${logical[0]}\n`);
  const secondFrame = await zstdCompress(`${logical.slice(1).join("\n")}\n`);
  await writeFile(newPath, Buffer.concat([firstFrame, secondFrame]));

  const discovered = await discoverDshSessionFiles({ root, maxSessions: 10 });
  assert.equal(discovered.length, 2);
  assert.equal(discovered[0], newPath);
  assert.equal(discovered[1], oldPath);

  const session = await readDshSessionFile(newPath);
  assert.equal(session.id, "session-123");
  assert.equal(session.source.encoding, "jsonl-zstd");
  assert.ok(session.messages.some((message) => message.text.includes("路线完全错了")));
});

test("P5 can reproduce a local fixed review subset from session-id hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-wrapped-dsh-hash-"));
  const selectedId = "session-selected";
  try {
    await mkdir(join(root, "selected"), { recursive: true });
    await mkdir(join(root, "other"), { recursive: true });
    await writeFile(join(root, "selected", "session.jsonl"), dshJsonl(selectedId));
    await writeFile(join(root, "other", "session.jsonl"), dshJsonl("session-other"));

    const selectedHash = createHash("sha256").update(selectedId).digest("hex").slice(0, 12);
    const sessions = await loadDshSessions({ root, maxSessions: 10, sessionIdHashes: [selectedHash] });
    assert.deepEqual(sessions.map((session) => session.id), [selectedId]);

    const missing = await loadDshSessions({ root, maxSessions: 10, sessionIdHashes: ["000000000000"] });
    assert.equal(missing.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
