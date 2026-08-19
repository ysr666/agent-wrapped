import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { SessionEvaluationCase, SessionHumanReview } from "../evaluation/types.js";
import type { PresentationLocale } from "../presentation/localization.js";
import { CURRENT_REVIEW_PROTOCOL_VERSION, DEFAULT_REVIEW_LOCALE } from "./protocol.js";
import type {
  ReviewWorkspace,
  ReviewWorkspaceProgress,
  ReviewWorkspaceRefreshResult,
  ReviewWorkspaceSource,
} from "./types.js";

export const AGENT_WRAPPED_HOME_ENV = "AGENT_WRAPPED_HOME";

interface LegacyReviewWorkspaceV1 {
  version: 1;
  createdAt: string;
  updatedAt: string;
  source: ReviewWorkspaceSource;
  cases: SessionEvaluationCase[];
  caseFingerprints: Record<string, string>;
  reviews: unknown[];
  completedSessionIds: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

export function resolveAgentWrappedHome(
  configured?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (configured?.trim()) return resolve(expandHome(configured));
  const fromEnv = env[AGENT_WRAPPED_HOME_ENV]?.trim();
  return fromEnv ? resolve(expandHome(fromEnv)) : join(homedir(), ".agent-wrapped");
}

export function resolveReviewWorkspacePath(
  configured?: string,
  env: Record<string, string | undefined> = process.env,
): string {
  if (configured?.trim()) return resolve(expandHome(configured));
  return join(resolveAgentWrappedHome(undefined, env), "review-workspace.json");
}

function stableCasePayload(entry: SessionEvaluationCase): unknown {
  return {
    version: entry.version,
    sessionId: entry.sessionId,
    host: entry.host,
    title: entry.title,
    model: entry.model,
    createdAt: entry.createdAt,
    moments: entry.moments,
    pairwiseTasks: entry.pairwiseTasks,
  };
}

export function fingerprintEvaluationCase(entry: SessionEvaluationCase): string {
  return createHash("sha256").update(JSON.stringify(stableCasePayload(entry))).digest("hex");
}

function hasCoreWorkspaceShape(value: unknown): value is LegacyReviewWorkspaceV1 | ReviewWorkspace {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LegacyReviewWorkspaceV1 & ReviewWorkspace>;
  return (
    (candidate.version === 1 || candidate.version === 2) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string" &&
    Array.isArray(candidate.cases) &&
    Array.isArray(candidate.reviews) &&
    Array.isArray(candidate.completedSessionIds) &&
    candidate.caseFingerprints !== null &&
    typeof candidate.caseFingerprints === "object" &&
    candidate.source !== null &&
    typeof candidate.source === "object"
  );
}

function normalizeLoadedWorkspace(value: unknown): ReviewWorkspace | undefined {
  if (!hasCoreWorkspaceShape(value)) return undefined;

  if (value.version === 1) {
    // P7 protocol v1 did not bind labels to presentation language/version.
    // Preserve the expensive P6 cases, but intentionally discard judgments so
    // old English-only ratings cannot contaminate the new Chinese-aware corpus.
    return {
      version: 2,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      source: value.source,
      protocolVersion: CURRENT_REVIEW_PROTOCOL_VERSION,
      presentationLocale: DEFAULT_REVIEW_LOCALE,
      cases: value.cases,
      caseFingerprints: value.caseFingerprints,
      reviews: [],
      completedSessionIds: [],
    };
  }

  const locale = value.presentationLocale;
  if (locale !== "zh-CN" && locale !== "en") return undefined;
  if (typeof value.protocolVersion !== "number") return undefined;

  if (value.protocolVersion !== CURRENT_REVIEW_PROTOCOL_VERSION) {
    return {
      ...value,
      protocolVersion: CURRENT_REVIEW_PROTOCOL_VERSION,
      reviews: [],
      completedSessionIds: [],
    };
  }

  const compatibleReviews = value.reviews.filter(
    (review): review is SessionHumanReview =>
      Boolean(
        review &&
          typeof review === "object" &&
          (review as SessionHumanReview).protocolVersion === value.protocolVersion &&
          (review as SessionHumanReview).presentationLocale === value.presentationLocale,
      ),
  );
  const compatibleIds = new Set(compatibleReviews.map((review) => review.sessionId));

  return {
    ...value,
    reviews: compatibleReviews,
    completedSessionIds: value.completedSessionIds.filter((id) => compatibleIds.has(id)),
  };
}

export async function loadReviewWorkspace(path?: string): Promise<ReviewWorkspace> {
  const resolved = resolveReviewWorkspacePath(path);
  let content: string;
  try {
    content = await readFile(resolved, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No review workspace found at ${resolved}. Run \"agent-wrapped dsh\" first.`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Review workspace at ${resolved} is not valid JSON.`);
  }
  const normalized = normalizeLoadedWorkspace(parsed);
  if (!normalized) {
    throw new Error(`Review workspace at ${resolved} has an unsupported or invalid schema.`);
  }
  return normalized;
}

/** Atomic replace so Ctrl+C or a process crash does not leave half-written review JSON. */
export async function saveReviewWorkspace(workspace: ReviewWorkspace, path?: string): Promise<string> {
  const resolved = resolveReviewWorkspacePath(path);
  await mkdir(dirname(resolved), { recursive: true });
  const temp = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  const updated: ReviewWorkspace = { ...workspace, updatedAt: nowIso() };
  await writeFile(temp, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  await rename(temp, resolved);
  workspace.updatedAt = updated.updatedAt;
  return resolved;
}

function reviewMap(reviews: SessionHumanReview[]): Map<string, SessionHumanReview> {
  return new Map(reviews.map((review) => [review.sessionId, review]));
}

export interface CreateOrRefreshReviewWorkspaceOptions {
  presentationLocale?: PresentationLocale;
}

export function createOrRefreshReviewWorkspace(
  cases: SessionEvaluationCase[],
  source: ReviewWorkspaceSource,
  previous?: ReviewWorkspace,
  options: CreateOrRefreshReviewWorkspaceOptions = {},
): ReviewWorkspaceRefreshResult {
  const createdAt = previous?.createdAt ?? nowIso();
  const presentationLocale = options.presentationLocale ?? previous?.presentationLocale ?? DEFAULT_REVIEW_LOCALE;
  const protocolVersion = CURRENT_REVIEW_PROTOCOL_VERSION;
  const previousReviews = reviewMap(previous?.reviews ?? []);
  const previousFingerprints = previous?.caseFingerprints ?? {};
  const previousCompleted = new Set(previous?.completedSessionIds ?? []);
  const protocolMatches = Boolean(
    previous &&
      previous.protocolVersion === protocolVersion &&
      previous.presentationLocale === presentationLocale,
  );
  const caseFingerprints: Record<string, string> = {};
  const reviews: SessionHumanReview[] = [];
  const completedSessionIds: string[] = [];
  let preservedReviews = 0;
  let invalidatedReviews = 0;
  let addedSessions = 0;

  const previousCaseIds = new Set(previous?.cases.map((entry) => entry.sessionId) ?? []);
  for (const entry of cases) {
    const fingerprint = fingerprintEvaluationCase(entry);
    caseFingerprints[entry.sessionId] = fingerprint;
    if (!previousCaseIds.has(entry.sessionId)) addedSessions += 1;

    const oldReview = previousReviews.get(entry.sessionId);
    if (!oldReview) continue;
    if (
      protocolMatches &&
      oldReview.protocolVersion === protocolVersion &&
      oldReview.presentationLocale === presentationLocale &&
      previousFingerprints[entry.sessionId] === fingerprint
    ) {
      reviews.push(oldReview);
      preservedReviews += 1;
      if (previousCompleted.has(entry.sessionId)) completedSessionIds.push(entry.sessionId);
    } else {
      invalidatedReviews += 1;
    }
  }

  const workspace: ReviewWorkspace = {
    version: 2,
    createdAt,
    updatedAt: nowIso(),
    source,
    protocolVersion,
    presentationLocale,
    cases,
    caseFingerprints,
    reviews,
    completedSessionIds,
  };

  return { workspace, addedSessions, preservedReviews, invalidatedReviews };
}

export function upsertSessionReview(
  workspace: ReviewWorkspace,
  review: SessionHumanReview,
): void {
  if (
    review.protocolVersion !== workspace.protocolVersion ||
    review.presentationLocale !== workspace.presentationLocale
  ) {
    throw new Error(
      `Review protocol mismatch: workspace is v${workspace.protocolVersion}/${workspace.presentationLocale}, ` +
        `review is v${review.protocolVersion}/${review.presentationLocale}.`,
    );
  }
  const index = workspace.reviews.findIndex((entry) => entry.sessionId === review.sessionId);
  if (index >= 0) workspace.reviews[index] = review;
  else workspace.reviews.push(review);
}

export function markSessionReviewComplete(workspace: ReviewWorkspace, sessionId: string): void {
  if (!workspace.completedSessionIds.includes(sessionId)) workspace.completedSessionIds.push(sessionId);
}

function compatibleReviews(workspace: ReviewWorkspace): SessionHumanReview[] {
  return workspace.reviews.filter(
    (review) =>
      review.protocolVersion === workspace.protocolVersion &&
      review.presentationLocale === workspace.presentationLocale,
  );
}

export function computeReviewProgress(workspace: ReviewWorkspace): ReviewWorkspaceProgress {
  const reviews = compatibleReviews(workspace);
  const awardCards = workspace.cases.reduce(
    (sum, entry) => sum + entry.moments.filter((moment) => moment.selected && moment.awardId).length,
    0,
  );
  const pairwiseTasks = workspace.cases.reduce((sum, entry) => sum + entry.pairwiseTasks.length, 0);
  const awardVotes = reviews.reduce((sum, review) => sum + (review.awardVotes?.length ?? 0), 0);
  const pairwiseVotes = reviews.reduce((sum, review) => sum + (review.pairwiseVotes?.length ?? 0), 0);
  const missedMoments = reviews.reduce((sum, review) => sum + (review.missedMoments?.length ?? 0), 0);
  const reviewIds = new Set(reviews.map((review) => review.sessionId));
  const completedSessions = new Set(
    workspace.completedSessionIds.filter((sessionId) => reviewIds.has(sessionId)),
  ).size;

  return {
    sessions: workspace.cases.length,
    completedSessions,
    remainingSessions: Math.max(0, workspace.cases.length - completedSessions),
    awardCards,
    awardVotes,
    pairwiseTasks,
    pairwiseVotes,
    missedMoments,
  };
}
