import type { SessionEvent } from "../session-events/types.js";

/**
 * Safe, local-only interpretation of a tool action. Raw tool arguments and
 * result bytes remain on SessionEvent; this summary is the only tool payload
 * allowed across the semantic/remote boundary.
 */
export type SemanticToolCategory = "observation" | "mutation" | "test" | "execution" | "other";
export type SemanticToolOutcome = "success" | "failure" | "blocked" | "observation" | "unknown";

export interface SemanticTestSummary {
  passed?: number;
  failed?: number;
}

export interface ClassifiedToolOutcome {
  toolName?: string;
  toolCategory: SemanticToolCategory;
  outcome?: SemanticToolOutcome;
  exitCode?: number;
  errorClass?: string;
  testSummary?: SemanticTestSummary;
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
  if (hasToolWord(name, ["exec", "command", "shell", "terminal", "run"])) return "execution";
  return "other";
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
export function classifyToolOutcome(event: SessionEvent, resolvedToolName?: string): ClassifiedToolOutcome {
  const toolName = resolvedToolName ?? event.toolName;
  let toolCategory = classifyToolCategory(toolName);
  const errorClass = safeErrorClass(event);
  const exitCode = exitCodeFromText(event.text);
  const testSummary = testSummaryFromText(event.text);

  if (event.kind === "tool_call") return { toolName, toolCategory };
  if (event.kind !== "tool_result" && event.kind !== "tool_error") return { toolName, toolCategory };

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
    outcome,
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(errorClass ? { errorClass } : {}),
    ...(testSummary ? { testSummary } : {}),
  };
}
