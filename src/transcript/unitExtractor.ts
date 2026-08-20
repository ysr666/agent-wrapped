import type { AgentHost, TranscriptMessage } from "../core/types.js";

export interface TranscriptUnit {
  id: string;
  text: string;
  messageIndex: number;
  unitIndex: number;
  host?: AgentHost;
  timestamp?: string;
}

export interface UnitExtractorOptions {
  /** Analyze assistant-visible text only. Defaults to true. */
  assistantOnly?: boolean;
}

export function normalizeUnitText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[`*_~“”"']/gu, "")
    .replace(/[。！？!?…，,；;：:\s]+/gu, " ")
    .trim();
}

function shouldMergeDramaticLeadIn(sentence: string): boolean {
  const bare = sentence.replace(/[.!?。！？…]+$/gu, "").trim();
  if (bare.length > 24) return false;

  return (
    /^(?:重大发现|重大突破|重大进展|等等|等一下|先等等)$/u.test(bare) ||
    /^(?:wait|hold on|plot twist|found it|major breakthrough)$/iu.test(bare)
  );
}

function isAsciiWordCharacter(character: string | undefined): boolean {
  return !!character && /[\p{L}\p{N}_/+-]/u.test(character);
}

function isPeriodTerminator(line: string, index: number): boolean {
  const before = line[index - 1];
  const after = line[index + 1];
  // Keep dots that are part of a filename, package name, version, path, or
  // decimal number together. Splitting `tests/core.test.js` into `test.` made
  // code fragments look like repeated assistant catchphrases in real sessions.
  return !(isAsciiWordCharacter(before) && isAsciiWordCharacter(after));
}

function sentenceSegments(line: string): string[] {
  const segments: string[] = [];
  let start = 0;
  let index = 0;

  while (index < line.length) {
    const character = line[index];
    const terminates =
      character === "."
        ? isPeriodTerminator(line, index)
        : character !== undefined && /[!?。！？]/u.test(character);
    if (!terminates) {
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < line.length && /[.!?。！？]/u.test(line[end] ?? "")) end += 1;
    const segment = line.slice(start, end).trim();
    if (segment) segments.push(segment);
    start = end;
    index = end;
  }

  const tail = line.slice(start).trim();
  if (tail) segments.push(tail);
  return segments;
}

/**
 * Split exposed transcript text into stable sentence-like units.
 *
 * Short dramatic lead-ins are kept with the sentence that gives them meaning,
 * e.g. `重大发现！！！我们前面的路线完全错了！` and
 * `Wait! I was wrong.`.
 */
export function extractSentenceLikeUnits(text: string): string[] {
  const normalized = text.replace(/\r\n?/gu, "\n");
  const units: string[] = [];

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine
      .replace(/^\s*(?:[-*+]\s+|>+\s*|#{1,6}\s+|\d+[.)]\s+)/u, "")
      .trim();
    if (!line) continue;

    const matches = sentenceSegments(line);
    if (matches.length === 0) {
      units.push(line);
      continue;
    }

    for (let index = 0; index < matches.length; index += 1) {
      const sentence = matches[index]?.trim();
      if (!sentence) continue;

      if (shouldMergeDramaticLeadIn(sentence) && index + 1 < matches.length) {
        const next = matches[index + 1]?.trim();
        if (next) {
          const bare = sentence.replace(/[.!?。！？…]+$/gu, "").trim();
          const spacer = /\p{Script=Han}$/u.test(bare) ? "" : " ";
          units.push(`${sentence}${spacer}${next}`);
          index += 1;
          continue;
        }
      }

      units.push(sentence);
    }
  }

  return units;
}

export function extractTranscriptUnits(
  messages: TranscriptMessage[],
  options: UnitExtractorOptions = {},
): TranscriptUnit[] {
  const assistantOnly = options.assistantOnly ?? true;
  const units: TranscriptUnit[] = [];

  messages.forEach((message, messageIndex) => {
    if (assistantOnly && message.role !== "assistant") return;

    extractSentenceLikeUnits(message.text).forEach((text, unitIndex) => {
      if (text.length < 2) return;
      units.push({
        id: `m${messageIndex}:u${unitIndex}`,
        text,
        messageIndex,
        unitIndex,
        host: message.host,
        timestamp: message.timestamp,
      });
    });
  });

  return units;
}
