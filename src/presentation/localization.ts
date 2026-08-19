export type PresentationLocale = "zh-CN" | "en";

export type LocalizationCoverage = "native" | "localized" | "partial" | "uncovered";

export interface RepeatedPatternLocalizationInput {
  label: string;
  family?: string;
  examples: string[];
}

export interface RepeatedPatternLocalization {
  localizedLabel?: string;
  summary?: string;
}

export interface LocalizedTextLine {
  text: string;
  englishDominant: boolean;
  hint?: string;
}

export interface TextLocalizationAssessment {
  coverage: LocalizationCoverage;
  lines: LocalizedTextLine[];
  reviewSafe: boolean;
  englishLines: number;
  localizedEnglishLines: number;
  uncoveredEnglishLines: number;
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
  return {
    localizedLabel: localization.label,
    summary: localization.summary,
  };
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
    patterns: [/\b(?:i was wrong|we were wrong|my mistake|take that back|scratch that|i stand corrected)\b/iu],
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
  {
    patterns: [/\b(?:definitely|certainly|clearly|absolutely).{0,26}\b(?:not|isn't|is not).{0,24}\b(?:issue|problem|cause|bug)\b/iu],
    hint: "这里在很确定地排除一个原因。",
  },
  {
    patterns: [/\b(?:actually|instead|turns out|in fact).{0,40}\b(?:issue|problem|cause|bug|causing|responsible)\b/iu],
    hint: "这里在改口，指出真正的问题来源。",
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

/**
 * Moment-level language coverage assessment used by P7. A Chinese review is
 * considered safe only when every English-dominant source line has a local
 * semantic cue. Unknown English is explicitly surfaced instead of silently
 * turning language friction into a negative entertainment label.
 */
export function assessTextLocalization(
  texts: string[],
  locale: PresentationLocale,
): TextLocalizationAssessment {
  const lines = texts.map((text) => {
    const englishDominant = locale === "zh-CN" && isEnglishDominant([text]);
    return {
      text,
      englishDominant,
      hint: englishDominant ? localizeAgentPhrase(text, locale) : undefined,
    };
  });

  if (locale !== "zh-CN") {
    return {
      coverage: "native",
      lines,
      reviewSafe: true,
      englishLines: 0,
      localizedEnglishLines: 0,
      uncoveredEnglishLines: 0,
    };
  }

  const englishLines = lines.filter((line) => line.englishDominant).length;
  const localizedEnglishLines = lines.filter((line) => line.englishDominant && line.hint).length;
  const uncoveredEnglishLines = englishLines - localizedEnglishLines;
  let coverage: LocalizationCoverage;
  if (englishLines === 0) coverage = "native";
  else if (uncoveredEnglishLines === 0) coverage = "localized";
  else if (localizedEnglishLines > 0) coverage = "partial";
  else coverage = "uncovered";

  return {
    coverage,
    lines,
    reviewSafe: uncoveredEnglishLines === 0,
    englishLines,
    localizedEnglishLines,
    uncoveredEnglishLines,
  };
}

/** Structural context is safe to localize because it describes the Moment type,
 * not the transcript wording itself. */
export function localizeMomentStructure(
  type: string,
  locale: PresentationLocale,
): string | undefined {
  if (locale !== "zh-CN") return undefined;
  switch (type) {
    case "boomerang":
      return "结构提示：这是前后判断互相打脸的一组。";
    case "false_dawn":
      return "结构提示：前面刚宣布好消息 / 搞定，后面又被推翻。";
    case "plot_twist":
      return "结构提示：这里发生了明显的方向反转。";
    case "correction_arc":
      return "结构提示：这是“原判断 → 改口 → 新判断”的三段式反转。";
    default:
      return undefined;
  }
}
