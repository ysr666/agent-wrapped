import type { EventClaim, EventStance, TopicRef } from "./types.js";

interface TopicAliasRule {
  topic: string;
  label: string;
  pattern: RegExp;
}

const TOPIC_ALIASES: TopicAliasRule[] = [
  { topic: "cache", label: "cache", pattern: /\b(?:cache|caching|cached)\b|缓存/iu },
  { topic: "config", label: "config", pattern: /\b(?:config|configuration|settings?)\b|配置/iu },
  { topic: "provider", label: "provider", pattern: /\bproviders?\b|提供商/iu },
  { topic: "model", label: "model", pattern: /\bmodels?\b|模型/iu },
  { topic: "network", label: "network", pattern: /\b(?:network|http|https|proxy)\b|网络|代理/iu },
  { topic: "database", label: "database", pattern: /\b(?:database|db|sql)\b|数据库/iu },
  { topic: "auth", label: "auth", pattern: /\b(?:auth|authentication|authorization|token)\b|鉴权|认证|授权/iu },
  { topic: "frontend", label: "frontend", pattern: /\b(?:frontend|front-end|ui|web ui)\b|前端|界面/iu },
  { topic: "backend", label: "backend", pattern: /\b(?:backend|server|service)\b|后端|服务端/iu },
  { topic: "plugin", label: "plugin", pattern: /\bplugins?\b|插件/iu },
  { topic: "dependency", label: "dependency", pattern: /\b(?:dependency|dependencies|peer dependency)\b|依赖/iu },
  { topic: "permission", label: "permission", pattern: /\bpermissions?\b|权限/iu },
  { topic: "concurrency", label: "concurrency", pattern: /\b(?:race|concurrency|concurrent|mutex|rwmutex|lock)\b|竞态|并发|互斥|锁/iu },
  { topic: "schema", label: "schema", pattern: /\b(?:schema|serialization|serializer)\b|序列化|结构校验/iu },
  { topic: "read-path", label: "read path", pattern: /\b(?:read path|read-path|reader)\b|读取路径|读路径/iu },
  { topic: "write-path", label: "write path", pattern: /\b(?:write path|write-path|writer)\b|写入路径|写路径/iu },
];

interface ClaimPattern {
  stance: EventStance;
  strength: number;
  confidence: number;
  cue: string;
  regex: RegExp;
}

const CLAIM_PATTERNS: ClaimPattern[] = [
  {
    stance: "exclude",
    strength: 92,
    confidence: 94,
    cue: "rule-out",
    regex: /(?:已经)?(?:可以)?(?:基本|完全|明确)?\s*(?:排除|排除了)\s*([^，。；;！？!?]{1,32})/gu,
  },
  {
    stance: "exclude",
    strength: 78,
    confidence: 88,
    cue: "not-it",
    regex: /(?:不是|并非)\s*([^，。；;！？!?]{1,32}?)(?=(?:，|、|；|;|。|！|!|？|\?|$|而是|其实是|才是))/gu,
  },
  {
    stance: "exclude",
    strength: 76,
    confidence: 86,
    cue: "fine",
    regex: /([^，。；;！？!?]{1,32}?)(?:没有问题|没问题|是正常的|正常|不是根因|不是原因|与此无关|无关)/gu,
  },
  {
    stance: "exclude",
    strength: 92,
    confidence: 94,
    cue: "rule-out",
    regex: /\b(?:we\s+can\s+|can\s+)?(?:definitely\s+|safely\s+|clearly\s+)?rule(?:d)?\s+out\s+([^,.!?;]{1,56})/giu,
  },
  {
    stance: "exclude",
    strength: 78,
    confidence: 86,
    cue: "fine",
    regex: /\b([^,.!?;]{1,56}?)\s+(?:is|was|looks|seems)\s+(?:fine|not\s+the\s+(?:issue|problem|cause)|unrelated|not\s+involved)\b/giu,
  },
  {
    stance: "exclude",
    strength: 90,
    confidence: 92,
    cue: "not-caused-by",
    regex: /\b(?:not|isn't|is\s+not|wasn't|was\s+not)\s+caused\s+by\s+([^,.!?;]{1,56})/giu,
  },
  {
    stance: "blame",
    strength: 94,
    confidence: 95,
    cue: "root-cause",
    regex: /(?:最终|最后|结果)?(?:真正的?)?(?:根因|原因)(?:还是|仍然是|其实是|就是|是|在于|出在|来自|源于)\s*([^，。；;！？!?]{1,32})/gu,
  },
  {
    stance: "blame",
    strength: 82,
    confidence: 88,
    cue: "problem-is",
    regex: /(?:真正的问题|实际问题|问题)(?:就是|是|在于|出在|来自|源于)\s*([^，。；;！？!?]{1,32})/gu,
  },
  {
    stance: "blame",
    strength: 80,
    confidence: 88,
    cue: "contrast-replacement",
    regex: /(?:而是|其实是|才是)\s*([^，。；;！？!?]{1,32})/gu,
  },
  {
    stance: "blame",
    strength: 90,
    confidence: 92,
    cue: "causes",
    regex: /([^，。；;！？!?]{1,32}?)(?:导致|造成|引起|触发)(?:了)?(?:这个|该|当前)?(?:问题|故障|异常|失败)/gu,
  },
  {
    stance: "blame",
    strength: 94,
    confidence: 95,
    cue: "root-cause",
    regex: /\b(?:the\s+)?(?:root cause|real issue|actual issue|exact issue|cause)\s+(?:is|was|lies in|comes from)\s+([^,.!?;]{1,56})/giu,
  },
  {
    stance: "blame",
    strength: 90,
    confidence: 92,
    cue: "caused-by",
    regex: /\b(?:caused by|due to|comes from|originates in)\s+([^,.!?;]{1,56})/giu,
  },
  {
    stance: "blame",
    strength: 90,
    confidence: 92,
    cue: "causes",
    regex: /\b([^,.!?;]{1,56}?)\s+(?:causes|caused|is causing|was causing|triggers|triggered)\s+(?:the\s+)?(?:issue|problem|bug|failure|error)\b/giu,
  },
];

function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[`*_~“”"']/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizeGenericTopic(raw: string): string {
  return normalizeText(raw)
    .replace(/^(?:the|a|an|this|that|our|your|current|actual|real)\s+/iu, "")
    .replace(/^(?:这个|该|当前|真正的?|实际的?)\s*/u, "")
    .replace(/\b(?:layer|path|behavior|behaviour|mechanism|component|subsystem)\b/giu, " ")
    .replace(/(?:层|路径|链路|机制)$/u, "")
    .replace(/\b(?:issue|problem|bug|failure|error)\b$/iu, "")
    .replace(/(?:问题|故障|异常)$/u, "")
    .replace(/\s+/gu, " ")
    .replace(/^[：:，,\s]+|[：:，,\s]+$/gu, "")
    .trim();
}

export function canonicalizeTopic(raw: string): TopicRef | undefined {
  const normalized = normalizeGenericTopic(raw);
  if (normalized.length < 2 || normalized.length > 48) return undefined;

  for (const rule of TOPIC_ALIASES) {
    if (rule.pattern.test(normalized)) {
      return { topic: rule.topic, label: rule.label, confidence: 96 };
    }
  }

  const generic = normalized
    .replace(/\b(?:the|this|that|some|any)\b/giu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (generic.length < 2) return undefined;
  return { topic: `generic:${generic}`, label: generic, confidence: 72 };
}

export function extractClaims(text: string): EventClaim[] {
  const claims: EventClaim[] = [];
  const seen = new Set<string>();

  for (const pattern of CLAIM_PATTERNS) {
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    for (const match of text.matchAll(regex)) {
      const rawTopic = match[1]?.trim();
      if (!rawTopic) continue;
      const canonical = canonicalizeTopic(rawTopic);
      if (!canonical) continue;
      const key = `${canonical.topic}\u0000${pattern.stance}`;
      if (seen.has(key)) continue;
      seen.add(key);
      claims.push({
        topic: canonical.topic,
        topicLabel: canonical.label,
        stance: pattern.stance,
        strength: pattern.strength,
        confidence: Math.min(pattern.confidence, canonical.confidence),
        cue: pattern.cue,
      });
    }
  }

  return claims;
}

export function resolveMentionedTopics(text: string): TopicRef[] {
  const topics: TopicRef[] = [];
  for (const rule of TOPIC_ALIASES) {
    if (rule.pattern.test(text)) {
      topics.push({ topic: rule.topic, label: rule.label, confidence: 92 });
    }
  }
  return topics;
}

function genericTopicTokens(topic: string): Set<string> {
  const value = topic.replace(/^generic:/u, "");
  if (/\p{Script=Han}/u.test(value)) {
    const chars = [...value.replace(/\s+/gu, "")];
    if (chars.length <= 2) return new Set([chars.join("")]);
    const grams = new Set<string>();
    for (let i = 0; i < chars.length - 1; i += 1) grams.add(chars.slice(i, i + 2).join(""));
    return grams;
  }
  return new Set(value.split(/[^\p{L}\p{N}_+-]+/u).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

export function topicsMatch(
  a: Pick<TopicRef, "topic"> | Pick<EventClaim, "topic">,
  b: Pick<TopicRef, "topic"> | Pick<EventClaim, "topic">,
): { match: boolean; similarity: number } {
  if (a.topic === b.topic) return { match: true, similarity: 1 };
  if (!a.topic.startsWith("generic:") || !b.topic.startsWith("generic:")) {
    return { match: false, similarity: 0 };
  }
  const similarity = jaccard(genericTopicTokens(a.topic), genericTopicTokens(b.topic));
  return { match: similarity >= 0.72, similarity };
}
