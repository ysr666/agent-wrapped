import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const serverRoot = dirname(fileURLToPath(import.meta.url));
const prototypeRoot = resolve(serverRoot, "..");
const repoRoot = resolve(prototypeRoot, "..");
const cacheRoot = join(prototypeRoot, ".cache", "real-wrapped");

export const CALIBRATION_SESSION_HASHES = [
  "1c03f89d7844",
  "bc63ce9fee84",
  "9005b00acc52",
  "0edd389dd40e",
];

function publicSessionHash(sessionId) {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 12);
}

function yamlScalar(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function requiredYamlValue(text, pattern, name) {
  const match = pattern.exec(text);
  if (!match?.[1]) throw new Error(`DSH ${name} is not configured.`);
  return yamlScalar(match[1]);
}

async function loadDshOpenRouterConfig() {
  const dshRoot = process.env.DSH_HOME?.trim() || join(homedir(), ".dsh");
  const [settings, credentials] = await Promise.all([
    readFile(join(dshRoot, "settings.yaml"), "utf8"),
    readFile(join(dshRoot, ".credentials.yaml"), "utf8"),
  ]);
  return {
    baseUrl: requiredYamlValue(settings, /^\s{6}baseURL:\s*(\S.*?)\s*$/mu, "OpenRouter base URL"),
    apiKey: requiredYamlValue(credentials, /^\s{2}OPENROUTER_API_KEY:\s*(\S.*?)\s*$/mu, "OpenRouter key"),
  };
}

function openRouterModel(session) {
  const model = session.model?.trim();
  if (!model) return "deepseek/deepseek-v4-flash";
  if (model.includes("/")) return model;
  if (model.startsWith("deepseek-")) return `deepseek/${model}`;
  return model;
}

async function engineCacheVersion() {
  const identity = await stat(join(repoRoot, "dist", "composer", "wrappedComposer.js"));
  return Math.floor(identity.mtimeMs).toString(36);
}

async function readCachedPayload(hash, version) {
  try {
    const text = await readFile(join(cacheRoot, `${hash}-${version}.json`), "utf8");
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function writeCachedPayload(hash, version, payload) {
  await mkdir(cacheRoot, { recursive: true });
  await writeFile(join(cacheRoot, `${hash}-${version}.json`), JSON.stringify(payload, null, 2), "utf8");
}

async function loadEngine() {
  const [{ loadDshSessions }, { generateComposedWrapped }, { createOpenAICompatibleNarrator }, { createWrappedUiPayload }] = await Promise.all([
    import(pathToFileURL(join(repoRoot, "dist", "ingest", "dshFilesystem.js")).href),
    import(pathToFileURL(join(repoRoot, "dist", "composer", "wrappedComposer.js")).href),
    import(pathToFileURL(join(repoRoot, "dist", "semantic", "openaiCompatible.js")).href),
    import(pathToFileURL(join(repoRoot, "dist", "composer", "uiPayload.js")).href),
  ]);
  return { loadDshSessions, generateComposedWrapped, createOpenAICompatibleNarrator, createWrappedUiPayload };
}

export function createRealWrappedService(options = {}) {
  const hashes = options.sessionHashes ?? CALIBRATION_SESSION_HASHES;
  const allowRemote = options.allowRemote ?? /^(?:1|true|yes)$/iu.test(process.env.AGENT_WRAPPED_ALLOW_REMOTE_REAL_SESSIONS?.trim() ?? "");
  const generationCache = new Map();
  let sessionsPromise;
  let configPromise;

  async function sessions() {
    if (!sessionsPromise) {
      sessionsPromise = (async () => {
        const engine = await loadEngine();
        const loaded = await engine.loadDshSessions({
          maxSessions: options.maxSessions ?? 400,
          sessionIdHashes: hashes,
        });
        const byHash = new Map(loaded.map((session) => [publicSessionHash(session.id), session]));
        return hashes.map((hash) => byHash.get(hash)).filter(Boolean);
      })();
    }
    return sessionsPromise;
  }

  async function list() {
    return (await sessions()).map((session) => ({
      id: publicSessionHash(session.id),
      title: session.title ?? "未命名真实会话",
      host: session.host,
      model: session.model,
      messageCount: session.messages.length,
    }));
  }

  async function generate(hash) {
    if (generationCache.has(hash)) return generationCache.get(hash);
    const promise = (async () => {
      const session = (await sessions()).find((candidate) => publicSessionHash(candidate.id) === hash);
      if (!session) throw new Error("Requested real session is not in the local calibration set.");
      const version = `${await engineCacheVersion()}-${allowRemote ? "remote" : "local"}`;
      const cached = await readCachedPayload(hash, version);
      if (cached) return { ...cached, cached: true };
      const engine = await loadEngine();
      let narrator;
      if (allowRemote) {
        if (!configPromise) configPromise = loadDshOpenRouterConfig();
        const config = await configPromise;
        narrator = engine.createOpenAICompatibleNarrator({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: openRouterModel(session),
          timeoutMs: 60000,
        });
      } else {
        narrator = { async generate() { throw new Error("Remote real-session narration is disabled."); } };
      }
      const generated = await engine.generateComposedWrapped(session, narrator, {
        wrapped: { locale: "zh-CN" },
        semantic: { locale: "zh-CN", topMoments: 6 },
        composer: { maxCards: 5 },
      });
      const payload = engine.createWrappedUiPayload(generated, {
        publicSessionId: hash,
        maxEvidencePerCard: 4,
      });
      const stored = { ...payload, generationMode: allowRemote ? "remote-semantic" : "local-deterministic", generatedAt: new Date().toISOString() };
      await writeCachedPayload(hash, version, stored);
      return { ...stored, cached: false };
    })();
    generationCache.set(hash, promise);
    try {
      return await promise;
    } catch (error) {
      generationCache.delete(hash);
      throw error;
    }
  }

  return { list, generate };
}

function json(response, status = 200) {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    body: JSON.stringify(response),
  };
}

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/(?:sk-|github_pat_|Bearer\s+)[A-Za-z0-9._~+\/-]+/giu, "[REDACTED]").slice(0, 240);
}

export function realWrappedDevApi(options = {}) {
  const service = createRealWrappedService(options);
  const middleware = async (request, response, next) => {
    if (!request.url?.startsWith("/api/real-wrapped")) return next();
    if (request.method !== "GET") {
      const result = json({ error: "Method not allowed." }, 405);
      response.writeHead(result.status, result.headers); response.end(result.body); return;
    }
    try {
      const url = new URL(request.url, "http://localhost");
      let result;
      if (url.pathname === "/api/real-wrapped/sessions") {
        result = json({ version: 1, sessions: await service.list() });
      } else {
        const match = /^\/api\/real-wrapped\/([a-f0-9]{12})$/u.exec(url.pathname);
        result = match?.[1]
          ? json(await service.generate(match[1]))
          : json({ error: "Not found." }, 404);
      }
      response.writeHead(result.status, result.headers); response.end(result.body);
    } catch (error) {
      const result = json({ error: safeError(error) }, 500);
      response.writeHead(result.status, result.headers); response.end(result.body);
    }
  };
  return {
    name: "agent-wrapped-real-session-api",
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
