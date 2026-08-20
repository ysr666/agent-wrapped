import { opendir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import * as zlib from "node:zlib";

import { parseDshSessionJsonl, type ParseDshSessionOptions } from "./dsh.js";
import type { IngestedSession, IngestionDiagnostic } from "./types.js";

export interface DshDiscoveryOptions {
  /** Session root override. Defaults to `$DSH_HOME/sessions` or `~/.dsh/sessions`. */
  root?: string;
  /** Maximum files returned, newest first. Defaults to 200. */
  maxSessions?: number;
  /** Include DSH's default `.jsonl.zstd` artifacts. Defaults to true. */
  includeCompressed?: boolean;
}

export interface LoadDshSessionsOptions extends DshDiscoveryOptions, Omit<ParseDshSessionOptions, "sourcePath" | "encoding"> {
  /** Skip malformed/unreadable session files instead of failing the whole batch. Defaults to true. */
  skipUnreadable?: boolean;
  /**
   * Local-only SHA-256 session-id prefixes used to reproduce a frozen calibration split.
   * They are matched after ingestion and never leave this process or the local review workspace.
   */
  sessionIdHashes?: string[];
}

interface DshSessionFile {
  path: string;
  modifiedAtMs: number;
  compressed: boolean;
}

interface ZstdFrameRange {
  start: number;
  end: number;
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/** Match DSH's documented home-resolution precedence without importing DSH itself. */
export function resolveDshSessionsRoot(
  root?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (root && root.trim()) return resolve(expandHome(root));
  const configuredHome = env.DSH_HOME?.trim();
  const dshHome = configuredHome ? resolve(expandHome(configuredHome)) : join(homedir(), ".dsh");
  return join(dshHome, "sessions");
}

function scanCompleteZstdFrames(buffer: Buffer): { frames: ZstdFrameRange[]; tornStart?: number } {
  const magic = 0xfd2fb528;
  const frames: ZstdFrameRange[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const start = offset;
    if (buffer.length - offset < 4) return { frames, tornStart: start };
    if (buffer.readUInt32LE(offset) !== magic) {
      throw new Error(`Invalid DSH Zstandard session artifact: bad frame magic at byte ${offset}.`);
    }
    offset += 4;
    if (offset === buffer.length) return { frames, tornStart: start };

    const descriptor = buffer.readUInt8(offset);
    offset += 1;
    if ((descriptor & 0x18) !== 0) throw new Error("Invalid DSH Zstandard frame descriptor.");

    const contentSizeFlag = descriptor >>> 6;
    const singleSegment = (descriptor & 0x20) !== 0;
    const checksum = (descriptor & 0x04) !== 0;
    const dictionaryFlag = descriptor & 0x03;
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
    if (buffer.length - offset < remainingHeaderBytes) return { frames, tornStart: start };
    offset += remainingHeaderBytes;

    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start };
      const blockHeader = buffer.readUIntLE(offset, 3);
      offset += 3;
      const lastBlock = (blockHeader & 1) !== 0;
      const blockType = (blockHeader >>> 1) & 0x03;
      const blockSize = blockHeader >>> 3;
      if (blockType === 0x03) throw new Error("Invalid DSH Zstandard frame block type.");
      const payloadBytes = blockType === 0x01 ? 1 : blockSize;
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start };
      offset += payloadBytes;
      if (lastBlock) break;
    }

    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start };
      offset += 4;
    }
    frames.push({ start, end: offset });
  }

  return { frames };
}

async function zstdFrameToBuffer(frame: Buffer): Promise<Buffer> {
  const decompress = (zlib as typeof zlib & {
    zstdDecompress?: (
      input: Uint8Array,
      callback: (error: Error | null, result: Buffer) => void,
    ) => void;
  }).zstdDecompress;

  if (!decompress) {
    throw new Error(
      "This DSH session is Zstandard-compressed, but the current Node.js runtime has no zstdDecompress API. Use Node 22.19+ / 24+, or ingest an exported session.jsonl artifact.",
    );
  }

  return new Promise<Buffer>((resolvePromise, rejectPromise) => {
    decompress(frame, (error, result) => {
      if (error) rejectPromise(error);
      else resolvePromise(Buffer.from(result));
    });
  });
}

async function decodeDshZstd(buffer: Buffer): Promise<{ content: string; diagnostics: IngestionDiagnostic[] }> {
  const { frames, tornStart } = scanCompleteZstdFrames(buffer);
  if (frames.length === 0) throw new Error("Invalid DSH Zstandard session artifact: no complete frame.");

  const chunks: Buffer[] = [];
  for (const frame of frames) {
    chunks.push(await zstdFrameToBuffer(buffer.subarray(frame.start, frame.end)));
  }

  return {
    content: Buffer.concat(chunks).toString("utf8"),
    diagnostics:
      tornStart === undefined
        ? []
        : [{
            level: "warning",
            code: "truncated-zstd-tail",
            message: `Ignored an incomplete final DSH Zstandard frame beginning at byte ${tornStart}.`,
          }],
  };
}

async function walkSessionFiles(root: string, includeCompressed: boolean): Promise<DshSessionFile[]> {
  const output: DshSessionFile[] = [];
  const pending: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || current.depth > 4) continue;

    let directory;
    try {
      directory = await opendir(current.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    for await (const entry of directory) {
      const path = join(current.path, entry.name);
      if (entry.isDirectory()) {
        pending.push({ path, depth: current.depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      const compressed = entry.name === "session.jsonl.zstd";
      if (entry.name !== "session.jsonl" && !(includeCompressed && compressed)) continue;
      const identity = await stat(path);
      output.push({ path, modifiedAtMs: identity.mtimeMs, compressed });
    }
  }

  return output.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs || a.path.localeCompare(b.path));
}

/** Discover DSH session artifacts from the configured/default harness home. */
export async function discoverDshSessionFiles(options: DshDiscoveryOptions = {}): Promise<string[]> {
  const root = resolveDshSessionsRoot(options.root);
  const maxSessions = Math.max(0, Math.floor(options.maxSessions ?? 200));
  const files = await walkSessionFiles(root, options.includeCompressed ?? true);
  return files.slice(0, maxSessions).map((entry) => entry.path);
}

/** Read one physical DSH session file and normalize it into Agent Wrapped messages. */
export async function readDshSessionFile(
  path: string,
  options: Omit<ParseDshSessionOptions, "sourcePath" | "encoding"> = {},
): Promise<IngestedSession> {
  const bytes = await readFile(path);
  const compressed = basename(path) === "session.jsonl.zstd" || path.endsWith(".zstd");
  const decoded = compressed
    ? await decodeDshZstd(bytes)
    : { content: bytes.toString("utf8"), diagnostics: [] as IngestionDiagnostic[] };
  const session = parseDshSessionJsonl(decoded.content, {
    ...options,
    sourcePath: path,
    encoding: compressed ? "jsonl-zstd" : "jsonl",
  });
  session.diagnostics.push(...decoded.diagnostics);
  return session;
}

/** Discover and ingest a newest-first batch of local DSH sessions. */
export async function loadDshSessions(options: LoadDshSessionsOptions = {}): Promise<IngestedSession[]> {
  const paths = await discoverDshSessionFiles(options);
  const requestedHashes = new Set(
    (options.sessionIdHashes ?? []).map((hash) => hash.trim().toLowerCase()).filter(Boolean),
  );
  const output: IngestedSession[] = [];
  const skipUnreadable = options.skipUnreadable ?? true;

  for (const path of paths) {
    try {
      const session = await readDshSessionFile(path, {
        includeVisibleReasoning: options.includeVisibleReasoning,
      });
      const sessionHash = createHash("sha256").update(session.id).digest("hex").slice(0, 12);
      if (requestedHashes.size > 0 && !requestedHashes.has(sessionHash)) continue;
      output.push(session);
    } catch (error) {
      if (!skipUnreadable) throw error;
    }
  }

  return output;
}
