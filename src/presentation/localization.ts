export type PresentationLocale = "zh-CN" | "en";

export interface RepeatedPatternLocalizationInput {
  label: string;
  family?: string;
  examples: string[];
}

export interface RepeatedPatternLocalization {
  localizedLabel?: string;
  summary?: string;
}

interface FamilyLocalization {
  label: string;
  summary: string;
}

const ZH_FAMILY_LOCALIZATION: Record<string, FamilyLocalization> = {
  "wait-reset": {
    label: "等等 / Wait",
    summary: "大概就是反复在说：“等等，我再确认一下。”",
  },
  clarity: {
    label: "问题已经很明确了 / Clear now",
    summary: "大概就是反复在说：“现在问题已经很明确了。”",
  },
  "root-cause-found": {
    label: "找到根因了 / Found the root cause",
    summary: "大概就是反复在说：“这次找到根因了。”",
  },
  "progress-near-cause": {
    label: "有进展了 / Getting closer",
    summary: "大概就是反复在说：“有进展，已经更接近根因了。”",
  },
  "resolution-confidence": {
    label: "这次应该修好了 / Should be fixed",
    summary: "大概就是反复在说：“这次应该已经修好了。”",
  },
  celebration: {
    label: "漂亮 / Perfect",
    summary: "大概就是反复在说：“漂亮，搞定了。”",
  },
};

function familyBase(family: string | undefined): string | undefined {
  return family?.split(":", 1)[0];
}

function languageWeight(text: string): { han: number; latin: number } {
  const han = [...text.matchAll(/\p{Script=Han}/gu)].length;
  const latin = [...text.matchAll(/[A-Za-z]/gu)].length;
  return { han, latin };
}

/**
 * Presentation-only language check. Mixed strings such as
 * `Wait, user said "整套测试通过"` still count as English when the surrounding
 * agent phrase is overwhelmingly Latin-script.
 */
export function isEnglishDominant(texts: string[]): boolean {
  const weight = texts.reduce(
    (total, text) => {
      const current = languageWeight(text);
      total.han += current.han;
      total.latin += current.latin;
      return total;
    },
    { han: 0, latin: 0 },
  );
  if (weight.latin < 4) return false;
  return weight.latin >= Math.max(8, weight.han * 1.35);
}

/**
 * Localize a known repeated verbal family without replacing the source quote.
 * This function only changes presentation; it never feeds extraction/ranking.
 */
export function localizeRepeatedPattern(
  input: RepeatedPatternLocalizationInput,
  locale: PresentationLocale,
): RepeatedPatternLocalization {
  if (locale !== "zh-CN") return {};
  const base = familyBase(input.family);
  if (!base) return {};
  const localization = ZH_FAMILY_LOCALIZATION[base];
  if (!localization) return {};
  if (!isEnglishDominant([input.label, ...input.examples])) return {};
  return localization;
}

interface PhraseHintRule {
  patterns: RegExp[];
  hint: string;
}

const ZH_AGENT_PHRASE_HINTS: PhraseHintRule[] = [
  {
    patterns: [/^\s*(?:wait|hold on)(?=\s*(?:[,，:：!！—-]|$))/iu],
    hint: "等等，我再确认一下。",
  },
  {
    patterns: [/\b(?:i was wrong|we were wrong|my mistake|take that back|scratch that)\b/iu],
    hint: "我刚才的判断错了 / 要收回前面的说法。",
  },
  {
    patterns: [/\byou(?:'re| are) right\b/iu],
    hint: "你说得对，我前面的判断需要改。",
  },
  {
    patterns: [
      /\b(?:found|located|identified|confirmed|isolated).{0,24}\b(?:root cause|issue|problem|bug|defect)\b/iu,
      /\b(?:root cause|exact issue|real issue).{0,24}\b(?:found|confirmed|identified|is)\b/iu,
    ],
    hint: "找到问题 / 根因了。",
  },
  {
    patterns: [/\b(?:should be fixed|should be solved|looks fixed|problem is solved|issue is fixed|all checks pass)\b/iu],
    hint: "这次应该已经修好了 / 可以收尾了。",
  },
  {
    patterns: [
      /\b(?:problem|issue|cause).{0,20}\b(?:clear|obvious|understood)\b/iu,
      /\b(?:clear|obvious).{0,20}\b(?:problem|issue|cause)\b/iu,
    ],
    hint: "现在问题已经很明确了。",
  },
  {
    patterns: [/\b(?:progress|getting closer|narrowed it down|close to the root cause)\b/iu],
    hint: "有进展，已经更接近根因了。",
  },
  {
    patterns: [/\b(?:perfect|great news|nice|nailed it|success|we got it)\b/iu],
    hint: "漂亮 / 完美命中 / 搞定了。",
  },
  {
    patterns: [/\b(?:sorry|i apologize|apologies)\b/iu],
    hint: "抱歉，我刚才弄错了。",
  },
  {
    patterns: [/\b(?:next update|i(?:'ll| will) finish|i(?:'ll| will) fix|finishing this now|not looping again)\b/iu],
    hint: "下一步我就完成 / 修掉，不再继续绕。",
  },
];

/**
 * Give Chinese readers a compact semantic cue for common English agent-speak.
 * It is deliberately labelled as a hint rather than a translation because the
 * original wording remains the evidence and arbitrary sentence details are not
 * regenerated locally.
 */
export function localizeAgentPhrase(
  text: string,
  locale: PresentationLocale,
): string | undefined {
  if (locale !== "zh-CN" || !isEnglishDominant([text])) return undefined;
  for (const rule of ZH_AGENT_PHRASE_HINTS) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.hint;
  }
  return undefined;
}
