import type { AgentHost, TranscriptMessage } from "../core/types.js";
import {
  extractTranscriptUnits,
  normalizeUnitText,
  type TranscriptUnit,
} from "../transcript/unitExtractor.js";
import { detectEventSignals, detectVerbalFamily, punctuationEnergy } from "./lexicon.js";
import { extractClaims, resolveMentionedTopics } from "./topicResolver.js";
import type { Event, EventSignal, EventType, TopicRef } from "./types.js";

export interface EventExtractorOptions {
  /** Keep neutral transcript units as events. Defaults to true. */
  includeNeutral?: boolean;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function simplifyForSimilarity(text: string): string {
  const normalized = normalizeUnitText(text);
  if (/\p{Script=Han}/u.test(normalized)) {
    return normalized
      .replace(/(?:好的?|那么|所以|然后|现在|已经|目前|基本|非常|真的|这下|这个|这里|一下|先|终于|比较|可以)/gu, "")
      .replace(/\s+/gu, "")
      .trim();
  }

  return normalized
    .replace(/\b(?:okay|ok|so|now|already|really|very|finally|basically|actually|just|the|a|an)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function mergeTopics(...groups: TopicRef[][]): TopicRef[] {
  const map = new Map<string, TopicRef>();
  for (const group of groups) {
    for (const topic of group) {
      const existing = map.get(topic.topic);
      if (!existing || topic.confidence > existing.confidence) map.set(topic.topic, topic);
    }
  }
  return [...map.values()];
}

function signalStrength(
  signals: Partial<Record<EventType, EventSignal>>,
  type: EventType,
): number {
  return signals[type]?.strength ?? 0;
}

function choosePrimaryType(signals: Partial<Record<EventType, EventSignal>>): EventType {
  const entries = Object.entries(signals) as Array<[EventType, EventSignal]>;
  if (entries.length === 0) return "neutral";
  entries.sort((a, b) => b[1].strength - a[1].strength || b[1].confidence - a[1].confidence);
  return entries[0]?.[0] ?? "neutral";
}

function eventDrama(text: string, signals: Partial<Record<EventType, EventSignal>>): number {
  return clamp(
    punctuationEnergy(text) +
      signalStrength(signals, "confusion") * 0.42 +
      signalStrength(signals, "celebration") * 0.28 +
      signalStrength(signals, "discovery_claim") * 0.18 +
      signalStrength(signals, "reversal") * 0.18,
  );
}

function standaloneQuality(
  text: string,
  signals: Partial<Record<EventType, EventSignal>>,
  drama: number,
): number {
  const meaningful = [
    "discovery_claim",
    "correction",
    "reversal",
    "celebration",
    "confusion",
    "progress_claim",
    "resolution_claim",
  ] as const;
  const maxSignal = Math.max(0, ...meaningful.map((type) => signalStrength(signals, type)));
  const lengthBonus = text.length >= 8 && text.length <= 180 ? 10 : text.length < 5 ? -8 : 0;
  return clamp(maxSignal * 0.58 + drama * 0.34 + lengthBonus);
}

export function extractEventFromUnit(unit: TranscriptUnit): Event {
  const signals = detectEventSignals(unit.text);
  const claims = extractClaims(unit.text);
  const claimTopics: TopicRef[] = claims.map((claim) => ({
    topic: claim.topic,
    label: claim.topicLabel,
    confidence: claim.confidence,
  }));
  const topics = mergeTopics(claimTopics, resolveMentionedTopics(unit.text));
  const primaryType = choosePrimaryType(signals);
  const drama = eventDrama(unit.text, signals);
  const maxSignalConfidence = Math.max(
    0,
    ...(Object.values(signals).filter(Boolean) as EventSignal[]).map((signal) => signal.confidence),
  );

  return {
    id: unit.id,
    text: unit.text,
    normalizedText: normalizeUnitText(unit.text),
    simplifiedText: simplifyForSimilarity(unit.text),
    messageIndex: unit.messageIndex,
    unitIndex: unit.unitIndex,
    host: unit.host,
    timestamp: unit.timestamp,
    primaryType,
    signals,
    claims,
    topics,
    verbalFamily: detectVerbalFamily(unit.text),
    drama,
    standaloneQuality: standaloneQuality(unit.text, signals, drama),
    confidence: primaryType === "neutral" ? 100 : maxSignalConfidence,
  };
}

export function extractEventFromText(
  text: string,
  messageIndex = 0,
  unitIndex = 0,
  host?: AgentHost,
): Event {
  return extractEventFromUnit({
    id: `m${messageIndex}:u${unitIndex}`,
    text,
    messageIndex,
    unitIndex,
    host,
  });
}

export function extractEvents(
  messages: TranscriptMessage[],
  options: EventExtractorOptions = {},
): Event[] {
  const includeNeutral = options.includeNeutral ?? true;
  const events = extractTranscriptUnits(messages, { assistantOnly: true }).map(extractEventFromUnit);
  return includeNeutral ? events : events.filter((event) => event.primaryType !== "neutral");
}

export function getEventSignal(event: Event, type: EventType): EventSignal | undefined {
  return event.signals[type];
}

export function getEventStrength(event: Event, type: EventType): number {
  return event.signals[type]?.strength ?? 0;
}
