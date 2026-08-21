import type { EventSignal, EventType } from "./types.js";

interface SignalRule {
  type: Exclude<EventType, "neutral">;
  baseStrength: number;
  confidence: number;
  patterns: Array<{ cue: string; regex: RegExp }>;
}

const SIGNAL_RULES: SignalRule[] = [
  {
    type: "discovery_claim",
    baseStrength: 58,
    confidence: 86,
    patterns: [
      { cue: "major-discovery", regex: /重大发现|重大突破/u },
      { cue: "found-cause", regex: /(?:终于)?(?:发现|找到|找到了|定位到|确认了|锁定)(?:真正|实际|确切)?(?:的)?(?:问题|根因|原因|bug|缺陷)?/iu },
      { cue: "real-cause", regex: /(?:真正|实际|确切)(?:的)?(?:问题|根因|原因)/u },
      { cue: "found-it", regex: /\b(?:found it|found the (?:issue|problem|root cause)|located the (?:issue|problem)|identified the (?:issue|problem|root cause))\b/iu },
      { cue: "root-cause", regex: /\b(?:root cause|exact (?:bug|issue|defect|cause|break)|real issue)\b/iu },
    ],
  },
  {
    type: "confidence_claim",
    baseStrength: 50,
    confidence: 82,
    patterns: [
      { cue: "explicit-certainty", regex: /(?:可以)?(?:确定|确认|肯定|明确)(?:了)?|毫无疑问/u },
      { cue: "absolute", regex: /(?:绝对|完全|唯一|真正|确切)(?:的)?(?:根因|原因|问题)?/u },
      { cue: "english-certainty", regex: /\b(?:definitely|certainly|clearly|exactly|without a doubt|absolutely)\b/iu },
      { cue: "rule-out", regex: /可以(?:完全)?排除|\b(?:we can|can)\s+(?:definitely\s+)?rule out\b/iu },
    ],
  },
  {
    type: "progress_claim",
    baseStrength: 62,
    confidence: 88,
    patterns: [
      { cue: "progress", regex: /(?:重大|关键)?进展/u },
      { cue: "closer", regex: /(?:接近|很接近|非常接近|快接近).{0,10}(?:根因|答案|问题)/u },
      { cue: "narrowing", regex: /(?:范围|问题范围).{0,12}(?:缩小|收窄)/u },
      { cue: "direction-right", regex: /(?:方向|路线).{0,12}(?:基本对|对了|正确)/u },
      { cue: "english-progress", regex: /\b(?:progress|getting closer|narrowed it down|close to the root cause)\b/iu },
    ],
  },
  {
    type: "resolution_claim",
    baseStrength: 62,
    confidence: 84,
    patterns: [
      { cue: "fixed", regex: /(?:应该|这次|现在|目前)?.{0,8}(?:修好|修复完成|解决了|搞定了|没问题了|可以结束了)/u },
      { cue: "problem-solved", regex: /(?:问题|bug|缺陷).{0,10}(?:解决|修好|修复|搞定)/u },
      { cue: "english-fixed", regex: /\b(?:should be fixed|should be solved|looks fixed|problem is solved|issue is fixed|all checks pass)\b/iu },
    ],
  },
  {
    type: "correction",
    baseStrength: 72,
    confidence: 92,
    patterns: [
      { cue: "self-correction", regex: /(?:我|我们)(?:刚才|之前|前面)?(?:说错了|判断错了|搞错了|错了)/u },
      { cue: "retract", regex: /(?:我收回|我撤回|更正一下|纠正一下|推翻前面)/u },
      { cue: "user-right", regex: /(?:你说得对|你质疑得对|你是对的)/u },
      { cue: "english-correction", regex: /\b(?:i was wrong|we were wrong|you(?:'re| are) right|i stand corrected|my mistake|take that back|scratch that)\b/iu },
    ],
  },
  {
    type: "reversal",
    baseStrength: 76,
    confidence: 90,
    patterns: [
      { cue: "wait-no", regex: /(?:等等|等一下|先等等).{0,20}(?:不对|错了|反了)/u },
      // Do not treat the noun phrase "刚才的报错" (a command happened to
      // error) as the agent retracting its own earlier judgment. A reversal
      // needs ownership of a prior conclusion, or the dedicated correction
      // rules above will handle it instead.
      {
        cue: "earlier-wrong",
        regex: /(?:(?:我|我们).{0,16}(?:之前|前面|刚才|先前).{0,16}|(?:之前|前面|刚才|先前).{0,12}(?:的)?(?:判断|结论|思路|路线|方案)).{0,16}(?:错(?:了|的)?|不对|判断有误|搞反了|走偏了|推翻)/u,
      },
      { cue: "approach-wrong", regex: /(?:路线|方向|思路|假设|判断|结论|方案).{0,28}(?:完全)?(?:错(?:了|的)?|不对|反了|走偏了)/u },
      { cue: "not-but", regex: /(?:不是|并非).{0,40}(?:而是|其实是|真正是|才是)/u },
      { cue: "english-wrong", regex: /\b(?:i|we)\s+(?:was|were)\s+wrong\b/iu },
      { cue: "english-approach-wrong", regex: /\b(?:our|the)\s+(?:approach|assumption|direction|theory|path).{0,32}\bwrong\b/iu },
      { cue: "english-reset", regex: /\b(?:wait[,—\s-]*(?:no|that's wrong|i was wrong)|start over|retract(?:ing)?)\b/iu },
    ],
  },
  {
    type: "celebration",
    baseStrength: 64,
    confidence: 86,
    patterns: [
      { cue: "celebration", regex: /(?:太棒了|太好了|漂亮|完美|好家伙)/u },
      // "命中内部错误" means the opposite of a celebration. Keep the cue
      // only for explicitly positive targets.
      { cue: "victory", regex: /(?:搞定了|修好了|解决了|完成了|命中(?:预期|目标|答案|修复|根因)|终于对了|没问题了|可以结束了)/u },
      { cue: "english-celebration", regex: /\b(?:great news|perfect|fixed|solved|done|nailed it|success|we got it)\b/iu },
    ],
  },
  {
    type: "confusion",
    baseStrength: 54,
    confidence: 80,
    patterns: [
      // A bare "wait" is a common coding-worklog transition, not an
      // emotional beat. It becomes one only when the rest of the utterance
      // supplies a turn, surprise, or new problem.
      {
        cue: "wait-turn",
        regex: /(?:等等|等一下|先等等|先等一下).{0,36}(?:不对|错了|反了|怎么|奇怪|更严重|问题)/u,
      },
      { cue: "weird", regex: /(?:离谱|诡异|奇怪|有意思|没想到|居然|竟然)/u },
      { cue: "good-bad-news", regex: /好消息|坏消息/u },
      {
        cue: "english-wait-turn",
        regex: /\b(?:wait|hold on).{0,36}\b(?:no|wrong|weird|strange|problem|seriously|actually)\b/iu,
      },
      { cue: "english-surprise", regex: /\b(?:plot twist|this is interesting|surprisingly|unexpectedly|weird)\b/iu },
    ],
  },
  {
    type: "apology",
    baseStrength: 62,
    confidence: 92,
    patterns: [
      { cue: "apology", regex: /(?:抱歉|对不起|是我的错|我弄错了)/u },
      { cue: "english-apology", regex: /\b(?:sorry|i apologize|apologies|my mistake)\b/iu },
    ],
  },
  {
    type: "promise",
    baseStrength: 52,
    confidence: 76,
    patterns: [
      { cue: "promise-next", regex: /(?:接下来|下一步|马上|现在就).{0,18}(?:完成|修复|解决|给出|结束|收尾)/u },
      { cue: "english-promise", regex: /\b(?:next update|i(?:'ll| will) finish|i(?:'ll| will) fix|finishing this now|not looping again)\b/iu },
    ],
  },
];

interface VerbalFamilyRule {
  family: string;
  patterns: RegExp[];
}

const VERBAL_FAMILY_RULES: VerbalFamilyRule[] = [
  {
    family: "clarity",
    patterns: [
      /(?:问题|关键点|情况|原因).{0,12}(?:明确|清楚|清晰|明朗)/u,
      /(?:明确|清楚|清晰).{0,10}(?:问题|关键点|原因)/u,
      /\b(?:problem|issue|cause).{0,18}\b(?:clear|obvious|understood)\b/iu,
      /\b(?:clear|obvious).{0,18}\b(?:problem|issue|cause)\b/iu,
    ],
  },
  {
    family: "root-cause-found",
    patterns: [
      /(?:找到|找到了|定位到|确认了|确认|锁定).{0,12}(?:真正的?)?(?:根因|原因|问题|bug|缺陷)/iu,
      /(?:真正的?)?(?:根因|原因|问题).{0,14}(?:找到|确认|定位|锁定|就是|就在)/u,
      /\b(?:found|located|identified|confirmed|isolated).{0,20}\b(?:root cause|issue|problem|bug|defect)\b/iu,
      /\b(?:root cause|exact issue|real issue).{0,20}\b(?:found|confirmed|identified|is)\b/iu,
    ],
  },
  {
    family: "progress-near-cause",
    patterns: [
      /(?:重大|关键)?进展/u,
      /(?:接近|很接近|非常接近|快接近).{0,10}(?:根因|答案|问题)/u,
      /(?:范围|问题范围).{0,12}(?:缩小|收窄)/u,
      /\b(?:progress|getting closer|narrowed it down|close to the root cause)\b/iu,
    ],
  },
  {
    family: "resolution-confidence",
    patterns: [
      /(?:应该|这次|现在|目前).{0,12}(?:修好|修复|解决|没问题|可以结束|搞定)/u,
      /(?:问题|bug|缺陷).{0,10}(?:解决|修好|修复|搞定)/u,
      /\b(?:should be fixed|should be solved|looks fixed|problem is solved|issue is fixed)\b/iu,
    ],
  },
  {
    family: "wait-reset",
    patterns: [
      /^(?:等等|等一下|先等等|先等一下)(?:[，,:：—\s-]|$)/u,
      /^(?:wait|hold on)(?=\s*(?:[,!:—-]|$))/iu,
    ],
  },
  {
    family: "celebration",
    patterns: [
      /^(?:漂亮|完美|太好了|太棒了|很好)(?:[！!，,。.]|$)/u,
      /^(?:perfect|great news|nice|nailed it)(?:[!,.\s]|$)/iu,
    ],
  },
];

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function hitCues(text: string, patterns: Array<{ cue: string; regex: RegExp }>): string[] {
  const cues: string[] = [];
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) cues.push(pattern.cue);
  }
  return cues;
}

export function detectEventSignals(text: string): Partial<Record<EventType, EventSignal>> {
  const signals: Partial<Record<EventType, EventSignal>> = {};

  for (const rule of SIGNAL_RULES) {
    const cues = hitCues(text, rule.patterns);
    if (cues.length === 0) continue;
    signals[rule.type] = {
      strength: clamp(rule.baseStrength + Math.max(0, cues.length - 1) * 12),
      confidence: clamp(rule.confidence + Math.max(0, cues.length - 1) * 2),
      cues,
    };
  }

  return signals;
}

export function verbalPolarity(text: string): "positive" | "negative" {
  return /(?:不明确|不清楚|还不明确|还不清楚|没解决|没有解决|没修好|没有修好|不是根因|并非根因|\bnot\s+(?:clear|fixed|solved)\b|\bnever\b|\bno longer\b|\bunclear\b)/iu.test(text)
    ? "negative"
    : "positive";
}

export function detectVerbalFamily(text: string): string | undefined {
  for (const rule of VERBAL_FAMILY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) {
      return `${rule.family}:${verbalPolarity(text)}`;
    }
  }
  return undefined;
}

export function punctuationEnergy(text: string): number {
  const exclamations = [...text.matchAll(/[!！]/gu)].length;
  const questions = [...text.matchAll(/[?？]/gu)].length;
  const ellipses = [...text.matchAll(/(?:…{2,}|\.{3,})/gu)].length;
  return clamp(
    Math.min(exclamations, 3) * 12 +
      Math.min(questions, 2) * 6 +
      Math.min(ellipses, 1) * 8,
  );
}
