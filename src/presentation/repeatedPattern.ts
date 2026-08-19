import {
  localizeRepeatedPattern,
  type PresentationLocale,
} from "./localization.js";

export interface RepeatedPatternPresentationInput {
  primaryText: string;
  variants?: string[];
  count?: number;
  family?: string;
}

export interface RepeatedPatternPresentation {
  /** Compact source-language label, for example `Wait`. */
  label: string;
  count: number;
  examples: string[];
  /** Optional reader-language label; source wording remains available in `label`. */
  localizedLabel?: string;
  /** Optional reader-language explanation, explicitly not a verbatim translation. */
  localizedSummary?: string;
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, { count: number; first: number }>();
  values.forEach((value, index) => {
    const current = counts.get(value);
    if (current) current.count += 1;
    else counts.set(value, { count: 1, first: index });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)[0]?.[0];
}

function waitResetCue(text: string): string | undefined {
  const match = text.match(/^\s*(等等|等一下|先等等|先等一下|wait|hold on)(?=\s*(?:[,，:：!！—-]|$))/iu);
  if (!match?.[1]) return undefined;
  const cue = match[1];
  if (/^wait$/iu.test(cue)) return "Wait";
  if (/^hold on$/iu.test(cue)) return "Hold on";
  return cue;
}

/** Presentation-only compression for repeated verbal patterns. */
export function presentRepeatedPattern(
  input: RepeatedPatternPresentationInput,
  maxExamples = 3,
  locale: PresentationLocale = "en",
): RepeatedPatternPresentation {
  const variants = input.variants?.length ? input.variants : [input.primaryText];
  let label = input.primaryText;

  const waitCues = variants.map(waitResetCue).filter((cue): cue is string => Boolean(cue));
  const waitCueMajority = waitCues.length >= 2 && waitCues.length / variants.length >= 0.6;
  if (input.family?.startsWith("wait-reset:") || waitCueMajority) {
    label = mostCommon(waitCues) ?? label;
  }

  const examples = variants
    .filter((text, index, all) => text.trim() && all.indexOf(text) === index)
    .slice(0, Math.max(0, maxExamples));
  const localization = localizeRepeatedPattern(
    {
      label,
      family: input.family,
      examples,
    },
    locale,
  );

  return {
    label,
    count: input.count ?? variants.length,
    examples,
    localizedLabel: localization.localizedLabel,
    localizedSummary: localization.summary,
  };
}
