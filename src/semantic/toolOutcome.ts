import type { SessionEvent } from "../session-events/types.js";

/**
 * Safe, local-only interpretation of a tool action. Raw tool arguments and
 * result bytes remain on SessionEvent; this summary is the only tool payload
 * allowed across the semantic/remote boundary.
 */
export type SemanticToolCategory = "observation" | "mutation" | "test" | "execution" | "other";
export type SemanticToolOutcome = "success" | "failure" | "blocked" | "observation" | "unknown";

/**
 * A small, explicit taxonomy projected locally from a tool name plus (when
 * necessary) its raw arguments. It is intentionally a behavior class, never
 * a command, path, argument, result excerpt, or fingerprint.
 */
export type SemanticToolOperation =
  | "observation"
  | "mutation"
  | "test"
  | "build"
  | "version_control"
  | "dependency_install"
  | "vision"
  | "execution"
  | "other";

/**
 * Locally computed relationship between the first action after a failed call
 * and that failed call. No tool arguments, hashes, or command text cross the
 * semantic boundary.
 */
export type SemanticFollowupRelation =
  | "alternative_action"
  | "variant_arguments_retry"
  | "same_arguments_retry"
  | "same_tool_arguments_unknown";

export interface SemanticTestSummary {
  passed?: number;
  failed?: number;
}

export interface ClassifiedToolOutcome {
  toolName?: string;
  toolCategory: SemanticToolCategory;
  operation: SemanticToolOperation;
  outcome?: SemanticToolOutcome;
  exitCode?: number;
  errorClass?: string;
  testSummary?: SemanticTestSummary;
}

export interface ClassifiedSessionToolEvent extends ClassifiedToolOutcome {
  /** Raw local call id; evidence.ts replaces this with an opaque alias. */
  followupOfCallId?: string;
  followupRelation?: SemanticFollowupRelation;
}

function normalizedToolName(name: string | undefined): string {
  return (name ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, " ").trim();
}

function hasToolWord(name: string, words: string[]): boolean {
  const tokens = new Set(name.split(" ").filter(Boolean));
  return words.some((word) => tokens.has(word));
}

export function classifyToolCategory(toolName: string | undefined): SemanticToolCategory {
  const name = normalizedToolName(toolName);
  if (hasToolWord(name, ["read", "list", "search", "find", "grep", "glob", "stat", "inspect", "query"])) {
    return "observation";
  }
  if (hasToolWord(name, ["write", "edit", "patch", "delete", "remove", "create", "move", "rename", "apply", "save"])) {
    return "mutation";
  }
  if (hasToolWord(name, ["test", "lint", "build", "check", "compile"])) return "test";
  if (hasToolWord(name, ["bash", "exec", "command", "shell", "terminal", "run"])) return "execution";
  return "other";
}

function normalizedArguments(argumentsText: string | undefined): string {
  return (argumentsText ?? "").trim();
}

/**
 * This is deliberately compact. It is only enough to distinguish the common
 * DSH command families that make an action's role legible after raw command
 * text has been withheld from the remote Story Miner.
 */
export function classifyToolOperation(
  toolName: string | undefined,
  toolArguments?: string,
): SemanticToolOperation {
  const name = normalizedToolName(toolName);
  const category = classifyToolCategory(toolName);
  if (category === "observation") return "observation";
  if (category === "mutation") return "mutation";
  if (hasToolWord(name, ["vision", "image", "screenshot", "ocr"])) return "vision";

  const command = normalizedArguments(toolArguments).toLowerCase();
  if (/\b(?:npm|pnpm|yarn|bun|deno)\s+(?:run\s+)?(?:test|check|lint)|\b(?:vitest|jest|pytest|mocha|ava|cargo\s+test|go\s+test)\b/iu.test(command)) {
    return "test";
  }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build|\b(?:tsc|vite\s+build|next\s+build|cargo\s+build|go\s+build)\b/iu.test(command)) {
    return "build";
  }
  if (/\bgit\s+(?:status|diff|log|show|fetch|pull|push|merge|rebase|commit|branch|worktree|checkout|switch)\b/iu.test(command)) {
    return "version_control";
  }
  if (/\b(?:npm|pnpm|yarn|bun|pip|pip3)\s+(?:install|add|remove|uninstall)\b/iu.test(command)) {
    return "dependency_install";
  }
  if (category === "test") return "test";
  if (category === "execution") return "execution";
  return "other";
}

function categoryForOperation(
  toolName: string | undefined,
  operation: SemanticToolOperation,
): SemanticToolCategory {
  if (operation === "observation") return "observation";
  if (operation === "mutation") return "mutation";
  if (operation === "test" || operation === "build") return "test";
  if (operation === "execution" || operation === "version_control" || operation === "dependency_install") return "execution";
  return classifyToolCategory(toolName);
}

function exitCodeFromText(text: string | undefined): number | undefined {
  const match = text?.match(/\b(?:exit\s*(?:code|status)?|status)\s*[:=]?\s*(-?\d+)\b/iu);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : undefined;
}

function testSummaryFromText(text: string | undefined): SemanticTestSummary | undefined {
  if (!text) return undefined;
  const paired = text.match(/\b(\d+)\s+(?:tests?\s+)?passed\s*,\s*(\d+)\s+(?:tests?\s+)?failed\b/iu);
  if (paired) return { passed: Number(paired[1]), failed: Number(paired[2]) };

  const passed = text.match(/\b(\d+)\s+(?:tests?\s+)?passed\b/iu);
  const failed = text.match(/\b(\d+)\s+(?:tests?\s+)?failed\b/iu);
  if (!passed && !failed) return undefined;
  return {
    ...(passed ? { passed: Number(passed[1]) } : {}),
    ...(failed ? { failed: Number(failed[1]) } : {}),
  };
}

function blockedBy(text: string | undefined, errorClass: string | undefined): boolean {
  return /(?:permission denied|forbidden|blocked|sandbox|read[- ]?only|\bEACCES\b|权限|拒绝|禁止|无权)/iu.test(
    `${text ?? ""}\n${errorClass ?? ""}`,
  );
}

function explicitMutationSuccess(text: string | undefined): boolean {
  return !!text && /(?:\b(?:written|deleted|created|updated|applied|saved|renamed|removed)\b|已(?:写入|删除|创建|更新|应用|保存|重命名))/iu.test(text);
}

function explicitTestSuccess(text: string | undefined): boolean {
  return !!text && /(?:\b(?:tests?\s+passed|all\s+tests?\s+passed|0\s+(?:failed|failures?|errors?))\b|全部通过|0\s*个?失败)/iu.test(text);
}

function explicitFailure(text: string | undefined, exitCode: number | undefined, summary: SemanticTestSummary | undefined): boolean {
  if (exitCode !== undefined && exitCode !== 0) return true;
  if ((summary?.failed ?? 0) > 0) return true;
  return !!text && /(?:\btests?\s+failed\b|\b(?:failed|failure|error)\b|失败|报错|崩溃)/iu.test(text);
}

function safeErrorClass(event: SessionEvent): string | undefined {
  const metadata = event.metadata;
  const raw = typeof metadata?.errorCode === "string"
    ? metadata.errorCode
    : typeof metadata?.errorName === "string"
      ? metadata.errorName
      : undefined;
  if (!raw || !/^[A-Za-z0-9_.-]{1,80}$/u.test(raw)) return undefined;
  return raw;
}

/** Classifies only locally observable tool outcomes; it never returns raw payload text. */
export function classifyToolOutcome(
  event: SessionEvent,
  resolvedToolName?: string,
  resolvedToolArguments?: string,
): ClassifiedToolOutcome {
  const toolName = resolvedToolName ?? event.toolName;
  const toolArguments = event.toolArguments ?? resolvedToolArguments;
  const operation = classifyToolOperation(toolName, toolArguments);
  let toolCategory = categoryForOperation(toolName, operation);
  const errorClass = safeErrorClass(event);
  const exitCode = exitCodeFromText(event.text);
  const testSummary = testSummaryFromText(event.text);

  if (event.kind === "tool_call") return { toolName, toolCategory, operation };
  if (event.kind !== "tool_result" && event.kind !== "tool_error") return { toolName, toolCategory, operation };

  let outcome: SemanticToolOutcome;
  if (blockedBy(event.text, errorClass)) outcome = "blocked";
  else if (event.isError || event.kind === "tool_error" || explicitFailure(event.text, exitCode, testSummary)) outcome = "failure";
  else if (toolCategory === "observation") outcome = "observation";
  else if (toolCategory === "other" && explicitMutationSuccess(event.text)) {
    // Some hosts expose a generic UI/computer tool while its observable result
    // explicitly confirms a mutation. Keep only that classified fact.
    toolCategory = "mutation";
    outcome = "success";
  }
  else if (
    (exitCode === 0 && (toolCategory === "mutation" || toolCategory === "test" || toolCategory === "execution")) ||
    (toolCategory === "test" && explicitTestSuccess(event.text)) ||
    (toolCategory === "mutation" && explicitMutationSuccess(event.text))
  ) outcome = "success";
  else outcome = "unknown";

  return {
    toolName,
    toolCategory,
    operation,
    outcome,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(errorClass ? { errorClass } : {}),
    ...(testSummary ? { testSummary } : {}),
  };
}

interface LocalToolCall {
  callId?: string;
  toolName?: string;
  toolArguments?: string;
  turn?: number;
}

interface LocalFailure {
  callId: string;
  toolName?: string;
  toolArguments?: string;
  turn?: number;
  eventIndex: number;
}

const MAX_FOLLOWUP_EVENT_GAP = 4;

/**
 * Projects a complete local event stream into allowlisted tool facts. Raw
 * arguments/results remain in `SessionEvent` and are only used here to decide
 * a coarse operation and whether the first response to a failure was an exact
 * retry, a variant, or a different action.
 */
export function classifySessionToolEvents(events: SessionEvent[]): Map<string, ClassifiedSessionToolEvent> {
  const ordered = [...events].sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const calls = new Map<string, LocalToolCall>();
  const projections = new Map<string, ClassifiedSessionToolEvent>();
  let pendingFailure: LocalFailure | undefined;

  for (const [eventIndex, event] of ordered.entries()) {
    if (event.kind === "tool_call") {
      const projection = classifyToolOutcome(event);
      const call: LocalToolCall = {
        callId: event.callId,
        toolName: event.toolName,
        toolArguments: event.toolArguments,
        turn: event.turn,
      };
      if (event.callId) calls.set(event.callId, call);

      if (
        pendingFailure &&
        eventIndex - pendingFailure.eventIndex <= MAX_FOLLOWUP_EVENT_GAP &&
        (pendingFailure.turn === undefined || event.turn === undefined || pendingFailure.turn === event.turn)
      ) {
        const sameTool = normalizedToolName(pendingFailure.toolName) === normalizedToolName(event.toolName);
        const priorArguments = normalizedArguments(pendingFailure.toolArguments);
        const nextArguments = normalizedArguments(event.toolArguments);
        const followupRelation: SemanticFollowupRelation = !sameTool
          ? "alternative_action"
          : !priorArguments || !nextArguments
            ? "same_tool_arguments_unknown"
            : priorArguments === nextArguments
              ? "same_arguments_retry"
              : "variant_arguments_retry";
        projections.set(event.id, {
          ...projection,
          followupOfCallId: pendingFailure.callId,
          followupRelation,
        });
        pendingFailure = undefined;
      } else {
        projections.set(event.id, projection);
        if (pendingFailure && eventIndex - pendingFailure.eventIndex > MAX_FOLLOWUP_EVENT_GAP) pendingFailure = undefined;
      }
      continue;
    }

    if (event.kind !== "tool_result" && event.kind !== "tool_error") continue;
    const call = event.callId ? calls.get(event.callId) : undefined;
    const projection = classifyToolOutcome(event, call?.toolName, call?.toolArguments);
    projections.set(event.id, projection);
    if ((projection.outcome === "failure" || projection.outcome === "blocked") && event.callId) {
      pendingFailure = {
        callId: event.callId,
        toolName: call?.toolName,
        toolArguments: call?.toolArguments,
        turn: event.turn ?? call?.turn,
        eventIndex,
      };
    }
  }

  return projections;
}
