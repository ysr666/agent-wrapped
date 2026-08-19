export interface RepeatedPatternPresentationInput {
  primaryText: string;
  variants?: string[];
  count?: number;
  family?: string;
}

export interface RepeatedPatternPresentation {
  label: string;
  count: number;
  examples: string[];
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

/**
 * Presentation-only compression for repeated verbal patterns.
 *
 * The Moment keeps full source variants for analysis/evaluation. UI surfaces
 * should not render those variants as a fake chronological causal chain.
 */
export function presentRepeatedPattern(
  input: RepeatedPatternPresentationInput,
  maxExamples = 3,
): RepeatedPatternPresentation {
  const variants = input.variants?.length ? input.variants : [input.primaryText];
  let label = input.primaryText;

  if (input.family?.startsWith("wait-reset:")) {
    label = mostCommon(variants.map(waitResetCue).filter((cue): cue is string => Boolean(cue))) ?? label;
  }

  const examples = variants
    .filter((text, index, all) => text.trim() && all.indexOf(text) === index)
    .slice(0, Math.max(0, maxExamples));

  return {
    label,
    count: input.count ?? variants.length,
    examples,
  };
}
