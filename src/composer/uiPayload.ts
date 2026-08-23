import { wrongTargetRepetitionExcerpt } from "../events/lexicon.js";
import { extractEventFromText } from "../events/eventExtractor.js";
import { scoreQuote } from "../core/quoteScorer.js";
import { redactSemanticText } from "../semantic/evidence.js";
import type { SemanticEvidenceEvent } from "../semantic/types.js";
import type { AwardKind } from "../awards/types.js";
import type {
  ComposedAwardCard,
  ComposedPersonaCard,
  ComposedStoryCard,
  ComposedWrappedCard,
  GeneratedComposedWrapped,
} from "./types.js";

export type WrappedUiCardKind = AwardKind | ComposedStoryCard["arcKind"] | "persona";

export interface WrappedUiEvidence {
  actor: "agent" | "user" | "tool";
  text: string;
  count?: number;
}

export interface WrappedUiCard {
  id: string;
  type: ComposedWrappedCard["type"];
  kind: WrappedUiCardKind;
  label: string;
  title: string;
  body?: string;
  evidence: WrappedUiEvidence[];
}

export interface WrappedUiPayload {
  version: 1;
  sessionId: string;
  title: string;
  host: string;
  model?: string;
  cards: WrappedUiCard[];
  strongest?: WrappedUiCard;
  emptyMessage?: string;
}

export interface CreateWrappedUiPayloadOptions {
  /** Use a local opaque hash instead of exposing the durable host session id. */
  publicSessionId?: string;
  maxEvidencePerCard?: number;
}

const AWARD_LABELS: Record<AwardKind, string> = {
  quote: "本场金句",
  catchphrase: "高频口癖",
  boomerang: "最大回旋镖",
  "wolf-cry": "狼来了",
  "premature-celebration": "香槟开早了",
  "plot-twist": "剧情急转弯",
  "emotional-peak": "精神状态",
};

const STORY_LABELS: Record<ComposedStoryCard["arcKind"], string> = {
  false_dawn: "香槟开早了",
  ending_then_more_work: "狼来了",
  failure_then_workaround: "换路继续",
  mistake_then_correction: "最大回旋镖",
  user_pushback_then_recovery: "现场抓包",
  capability_gap_then_improvisation: "剧情急转弯",
  breakdown_then_resume: "精神状态",
  reversal: "剧情急转弯",
  other: "本场剧情",
};

const STORY_COMMENTARY: Record<ComposedStoryCard["arcKind"], string> = {
  false_dawn: "刚宣布搞定，下一秒就被现实打脸。",
  ending_then_more_work: "片尾字幕刚滚完，工作又来了。",
  failure_then_workaround: "一条路走不通，换一条继续。",
  mistake_then_correction: "前面的结论刚说完，自己又收回。",
  user_pushback_then_recovery: "被用户当场点名后，重新开始干活。",
  capability_gap_then_improvisation: "工具没有，办法还是得想。",
  breakdown_then_resume: "破防归破防，活还得干。",
  reversal: "前后两句话放在一起，节目效果最好。",
  other: "几件事连起来以后，才看出这场的剧情。",
};

function compact(text: string, max = 120): string {
  const normalized = redactSemanticText(text)
    .text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`([^`\n]+)`/gu, "$1")
    .replace(/(?:\*\*|__)(.+?)(?:\*\*|__)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^\s)]+\)/gu, "$1")
    .replace(/^\s*#{1,6}\s+/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 1))}…`;
}

function evidenceActor(event: SemanticEvidenceEvent): WrappedUiEvidence["actor"] | undefined {
  if (event.actor === "assistant") return "agent";
  if (event.actor === "user") return "user";
  if (event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "tool_error") return "tool";
  return undefined;
}

function safeEventText(event: SemanticEvidenceEvent): string | undefined {
  if (event.kind === "tool_call" || event.kind === "tool_result" || event.kind === "tool_error") {
    if (!event.toolName) return undefined;
    const fields = [
      event.toolCategory,
      event.outcome,
      event.exitCode === undefined ? undefined : `exit ${event.exitCode}`,
      event.errorClass,
    ].filter((value): value is string => !!value);
    return `${event.toolName}${fields.length > 0 ? ` (${fields.join(", ")})` : ""}`;
  }
  return event.text ? compact(event.text, 96) : undefined;
}

function quotableAgentExcerpt(text: string): string | undefined {
  const patterns = [
    /[^，,。！？!?]{0,28}我的失误(?:[，,]\s*没有任何借口)?/u,
    /[^，,。！？!?]{0,24}(?:坏习惯|我错了|判断错了)/u,
    /(?:老子|他妈|不玩了|fuck|back to business)[^。！？!?\n]{0,60}/iu,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text)?.[0]?.trim();
    if (match) return match;
  }
  return undefined;
}

function strongestGroundedLine(texts: string[]): string | undefined {
  const candidates = texts.flatMap((text) => compact(text, 240)
    .split(/(?<=[。！？!?])|\n+/u)
    .map((part) => part.trim())
    .filter((part) => part.length >= 4 && part.length <= 120));
  return candidates
    .map((text, index) => {
      const event = extractEventFromText(text);
      const signal = Math.max(0, ...Object.values(event.signals)
        .filter((value) => value !== undefined)
        .map((value) => value.strength));
      const assertionPriority = /(?:根因.{0,12}(?:明确|清楚)|原因查明|真不是|绝对|完全)/u.test(text)
        ? 60
        : /(?:修好了|解决了|搞定|全绿|完成)/u.test(text)
          ? 40
          : 0;
      const score = assertionPriority + scoreQuote(text).score + event.standaloneQuality + event.drama + signal;
      return { text, score, index };
    })
    .sort((left, right) => right.score - left.score || right.index - left.index)[0]?.text;
}

function claimHeadline(text: string): string {
  const separator = text.search(/[：:]/u);
  if (separator >= 4 && separator <= 48) return text.slice(0, separator).trim();
  return text;
}

function uniqueEvidence(items: WrappedUiEvidence[], max: number): WrappedUiEvidence[] {
  const seen = new Set<string>();
  const output: WrappedUiEvidence[] = [];
  for (const item of items) {
    const key = `${item.actor}:${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= max) break;
  }
  return output;
}

function awardCard(card: ComposedAwardCard, maxEvidence: number): WrappedUiCard {
  const award = card.award;
  const primary = compact(wrongTargetRepetitionExcerpt(award.primaryText) ?? award.primaryText, 128);
  const related = award.relatedTexts.map((text) => compact(text, 96)).filter(Boolean);
  const count = award.count && award.count > 1 ? award.count : undefined;
  const title = count ? `${primary} ×${count}` : primary;
  return {
    id: card.id,
    type: "award",
    kind: card.awardKind,
    label: AWARD_LABELS[card.awardKind],
    title,
    body: related.length > 0 ? related.join(" → ") : undefined,
    evidence: uniqueEvidence([
      { actor: "agent", text: primary, count },
      ...related.map((text) => ({ actor: "agent" as const, text })),
    ], maxEvidence),
  };
}

function storyCard(
  card: ComposedStoryCard,
  generated: GeneratedComposedWrapped,
  maxEvidence: number,
): WrappedUiCard {
  const eventById = new Map(generated.semanticEvidence.events.map((event) => [event.id, event]));
  const evidence: WrappedUiEvidence[] = [];
  const claimTexts: string[] = [];
  const counterTexts: string[] = [];
  for (const story of card.stories) {
    for (const beat of story.beats) {
      const event = beat.evidenceIds.map((id) => eventById.get(id)).find((candidate) => candidate !== undefined);
      if (!event) continue;
      const actor = evidenceActor(event);
      const text = safeEventText(event);
      if (actor && text) {
        evidence.push({ actor, text });
        if (beat.kind === "claim" && actor === "agent") claimTexts.push(text);
        if (["failure", "user_pushback", "reversal"].includes(beat.kind)) counterTexts.push(text);
      }
    }
  }
  const quotable = evidence
    .filter((item) => item.actor === "agent")
    .map((item) => quotableAgentExcerpt(item.text))
    .find((text): text is string => !!text);
  const falseDawnClaim = card.arcKind === "false_dawn" ? strongestGroundedLine(claimTexts) : undefined;
  const falseDawnCounter = card.arcKind === "false_dawn" ? strongestGroundedLine(counterTexts) : undefined;
  return {
    id: card.id,
    type: "story",
    kind: card.arcKind,
    label: STORY_LABELS[card.arcKind],
    title: quotable
      ? `“${compact(quotable, 72)}”`
      : falseDawnClaim
        ? `“${compact(claimHeadline(falseDawnClaim), 72)}”`
        : compact(card.title, 96),
    body: falseDawnCounter
      ? `下一条：${compact(falseDawnCounter, 90)}`
      : card.commentary
        ? compact(card.commentary, 120)
        : STORY_COMMENTARY[card.arcKind],
    evidence: uniqueEvidence(evidence, maxEvidence),
  };
}

function personaCard(card: ComposedPersonaCard): WrappedUiCard {
  return {
    id: card.id,
    type: "persona",
    kind: "persona",
    label: "本场角色",
    title: compact(card.label, 80),
    body: compact(card.tagline, 120),
    evidence: [],
  };
}

/**
 * Convert the final Composer result into the only shape the local UI receives.
 * Raw SessionEvent tool payloads and durable session ids never enter this object.
 */
export function createWrappedUiPayload(
  generated: GeneratedComposedWrapped,
  options: CreateWrappedUiPayloadOptions = {},
): WrappedUiPayload {
  const maxEvidence = Math.max(1, Math.min(6, Math.floor(options.maxEvidencePerCard ?? 4)));
  const cards = generated.report.cards.map((card): WrappedUiCard => {
    if (card.type === "award") return awardCard(card, maxEvidence);
    if (card.type === "story") return storyCard(card, generated, maxEvidence);
    return personaCard(card);
  });
  return {
    version: 1,
    sessionId: options.publicSessionId ?? "local-session",
    title: compact(generated.session.title ?? "本场 Agent 会话", 80),
    host: generated.session.host,
    model: generated.session.model ? compact(generated.session.model, 80) : undefined,
    cards,
    strongest: cards[0],
    emptyMessage: cards.length === 0 ? "这场暂时没有强到值得上榜的名场面。" : undefined,
  };
}
