# QuoteScorer Benchmark

QuoteScorer v0 has a small regression benchmark so scoring changes are judged against examples instead of being tuned by intuition alone.

## What is in the benchmark

The executable corpus is split into two fixture sets:

- `test/fixtures/publicQuoteBenchmarks.mjs` — source-inspired positive/regression cases
- `test/fixtures/hardNegativeBenchmarks.mjs` — deliberately misleading lines that look quote-worthy on the surface

The positive corpus currently covers:

- Claude Code: explicit self-correction / reversal after a confident diagnosis
- Codex: repeated "exact defect" style discovery claims versus a later retraction
- Gemini CLI: enthusiastic discovery language versus a correction cascade
- Chinese: a synthetic DSH guardrail that ensures a dramatic route reversal outranks generic status language

The public cases are **source-inspired regression cases**, not copied transcripts. We keep short observed trigger phrases where useful and synthesize the surrounding lines. This prevents the test suite from turning into a transcript mirror or overfitting to one exact conversation.

Public source notes are collected in `docs/research-corpus.md`.

## Hard negatives

Hard negatives are intentionally plausible false winners. They contain the kinds of surface features a naive scorer may overvalue:

- lots of `!!!` / `！！！` without a meaningful event;
- celebratory filler such as "Great news" / "终于修好了";
- confident root-cause claims with no reversal or payoff;
- bare apologies that acknowledge an error but say nothing memorable;
- trigger-word stuffing such as "root cause", "exact issue", "重大突破", and "完全确定" packed into one line.

Each hard-negative case has one intended quote and several tempting decoys. The test asserts that the intended quote outranks every decoy.

The current v0 hard-negative corpus includes both Chinese and English cases for:

1. punctuation bait;
2. confidence bait;
3. generic resolution/completion language;
4. apology bait;
5. keyword stuffing.

These cases are deliberately limited to distinctions that the local surface scorer can reasonably make. Subtle semantic twists whose value only appears after comparing distant context belong to the later context/semantic benchmark rather than being faked with regex expectations.

## What the tests assert

The tests intentionally assert **relative ranking**, not fixed numeric scores.

For each positive benchmark, QuoteScorer must:

1. extract the expected dramatic line;
2. rank it first within that mini-session;
3. rank it above generic discovery/status lines from the same case.

For each hard-negative benchmark, the intended quote must score higher than every tempting decoy.

Additional guardrails verify that:

- dramatic Chinese reversals expose discovery + reversal + confidence signals;
- generic "problem is clear" language receives a template penalty;
- exact repetition lowers quote score because repeated wording belongs in catchphrase analysis;
- commands/code noise are penalized;
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

A future scorer should be allowed to change raw scores as long as the important orderings stay correct. When real DSH transcripts are added, they should be anonymized or represented by minimal derived fixtures unless the original text is intentionally public.

Over time we should maintain three kinds of cases:

- **positive**: obvious memorable quotes that should rank highly;
- **hard negatives**: emotional or confident lines that look dramatic but should not win;
- **contextual cases**: lines that only become funny or important because of earlier claims.

The third category will eventually require the semantic/context layer; QuoteScorer v0 should not pretend local surface rules solve it already.
