# QuoteScorer Benchmark

QuoteScorer v0 has a small regression benchmark so scoring changes are judged against examples instead of being tuned by intuition alone.

## What is in the benchmark

The executable corpus is now split into three fixture sets:

- `test/fixtures/publicQuoteBenchmarks.mjs` — source-inspired positive/regression cases;
- `test/fixtures/hardNegativeBenchmarks.mjs` — decoys for the **single quote-of-the-session ranking**;
- `test/fixtures/funCandidateBenchmarks.mjs` — lines that may not win the gold-quote slot but are still valuable for other awards.

That distinction is important: **not the best quote does not mean not interesting.**

A line such as `这次真的找到根因了！！！` may be only a middling one-off quote, but if it appears six times it is excellent material for the wolf-cried-again award. `现在问题已经非常明确了。` can be weak as a one-off gold quote and simultaneously excellent as a catchphrase.

## Positive / public-inspired cases

The positive corpus currently covers:

- Claude Code: explicit self-correction / reversal after a confident diagnosis;
- Codex: repeated "exact defect" style discovery claims versus a later retraction;
- Gemini CLI: enthusiastic discovery language versus a correction cascade;
- Chinese: a synthetic DSH guardrail that ensures a dramatic route reversal outranks generic status language.

The public cases are **source-inspired regression cases**, not copied transcripts. We keep short observed trigger phrases where useful and synthesize the surrounding lines. This prevents the test suite from turning into a transcript mirror or overfitting to one exact conversation.

Public source notes are collected in `docs/research-corpus.md`.

## Quote-ranking hard negatives

Hard negatives are negative only for one question: **should this beat the intended line as the single quote of the session?**

They are intentionally plausible false winners containing surface features a naive quote scorer may overvalue:

- lots of `!!!` / `！！！` without enough payoff;
- celebratory filler such as "Great news" / "终于修好了";
- confident root-cause claims with no reversal;
- bare apologies that acknowledge an error but add little content;
- trigger-word stuffing such as "root cause", "exact issue", "重大突破", and "完全确定" packed into one line.

These lines are not globally labeled "boring". Some are deliberately fun and should survive in other categories.

Each hard-negative case has one intended quote and several tempting decoys. The test only asserts that the intended quote outranks every decoy for the gold-quote slot.

## Fun / category candidates

DeepSeek/DSH-style lines have moved out of the hard-negative set into `funCandidateBenchmarks.mjs`.

The current categories include:

- **clarity catchphrase** — repeated “现在问题已经非常清楚/明确了”;
- **progress announcement** — “重大进展”“已经非常接近根因”; 
- **wolf-cried-again** — repeated “这次真的找到根因了”; 
- **emotional peak** — “离谱”“诡异”“这下有意思了”;
- **premature celebration** — “应该修好了”“这次应该真的没问题了”;
- **self-congratulation** — “漂亮”“完美命中”; 
- **full plot twist** — one line can score strongly across quote, discovery, reversal, and drama at the same time.

These fixtures use the multi-dimensional `scoreQuoteFacets()` helper. The current facets are:

```text
quote
 drama
 discovery
 reversal
 progress
 celebration
 catchphrase
 wolfCry
```

The facet scores are candidate signals, not final awards. `catchphrase` and `wolfCry` require a repetition count from the session; a single isolated line cannot prove either one. Likewise, a modest celebration line may become hilarious only after later context shows that the bug was not fixed.

## What the tests assert

The tests intentionally avoid locking arbitrary raw numbers where relative behavior is enough.

For each positive benchmark, QuoteScorer must:

1. extract the expected dramatic line;
2. rank it first within that mini-session;
3. rank it above generic discovery/status lines from the same case.

For each quote-ranking hard-negative benchmark, the intended quote must score higher than every tempting decoy.

For each fun-category benchmark, the line must retain the expected facet signal instead of being discarded merely because it is not the gold quote.

Additional guardrails verify that:

- dramatic Chinese reversals expose discovery + reversal + confidence signals;
- generic "problem is clear" language receives a quote-template penalty;
- exact repetition lowers one-off quote score while increasing catchphrase value;
- repeated root-cause declarations can produce a strong wolf-cried-again signal;
- repeated DSH-style clarity announcements can lose the gold-quote slot while remaining a strong catchphrase;
- commands/code noise are penalized for quote ranking;
- user/tool text is not accidentally treated as an assistant quote.

## Running locally

```bash
npm test
```

For the quote suite only:

```bash
npm run test:quote
```

The repository also runs the test suite on pushes to `main` and on pull requests through GitHub Actions.

## Benchmark philosophy

This is a regression suite, not a scientific model leaderboard.

A future scorer should be allowed to change raw scores as long as the important behavioral distinctions stay correct. When real DSH transcripts are added, they should be anonymized or represented by minimal derived fixtures unless the original text is intentionally public.

Over time we should maintain four kinds of cases:

- **positive** — obvious memorable quotes that should rank highly;
- **quote-ranking hard negatives** — tempting decoys that should not win the single gold-quote slot;
- **fun/category candidates** — interesting lines that belong to catchphrase, wolf-cry, celebration, progress, or emotional awards;
- **contextual cases** — moments whose value only emerges from earlier/later claims.

The contextual category will eventually require the semantic/context layer; QuoteScorer v0 should not pretend local surface rules solve it already.
