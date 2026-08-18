# Regression benchmarks

Agent Wrapped uses layered regression tests so changes are judged against examples instead of being tuned by intuition alone.

The suite now mirrors the Moment Engine architecture:

```text
Unit / quote regression
        ↓
Event regression        (P0)
        ↓
Graph regression        (P1)
        ↓
Moment regression       (P2, next)
        ↓
Human preference        (later, product truth)
```

## Quote / surface benchmark

The executable quote corpus is split into three fixture sets:

- `test/fixtures/publicQuoteBenchmarks.mjs` — source-inspired positive/regression cases;
- `test/fixtures/hardNegativeBenchmarks.mjs` — decoys for the **single quote-of-the-session ranking**;
- `test/fixtures/funCandidateBenchmarks.mjs` — lines that may not win the gold-quote slot but are still valuable for other moments.

That distinction remains important: **not the best quote does not mean not interesting.**

The public-inspired corpus covers Claude Code, Codex, Gemini CLI, and Chinese synthetic DSH guardrails. The cases are source-inspired regression examples rather than copied transcript mirrors. Public source notes live in `docs/research-corpus.md`.

Hard negatives only test whether a tempting surface line should beat a stronger one-off quote. They do not globally label the losing line as boring.

## P0 Event benchmark

`test/eventExtractor.test.mjs` verifies the shared event layer rather than a downstream award.

Current guardrails include:

- one dramatic line can expose discovery + reversal + confidence simultaneously;
- `不是缓存，而是配置` produces two structured topic claims with opposite stances;
- neutral assistant text remains available for later repetition analysis;
- positive/negative verbal-family polarity is separated;
- user/tool text does not become assistant events.

Run:

```bash
npm run test:event
```

## P1 Moment Graph benchmark

`test/momentGraph.test.mjs` verifies relationships independently from award names.

Current guardrails include:

- DSH-style clarity paraphrases form repetition/similarity clusters;
- opposite-polarity variants do not merge;
- `排除缓存 → 根因缓存` creates `same_topic + contradicts` edges;
- explicit later self-correction can create `retracts`;
- chronological adjacency creates `followed_by`;
- celebration followed by correction creates `celebrates_before`;
- user/tool content cannot create assistant graph relations.

Run:

```bash
npm run test:graph
```

## Compatibility benchmarks

The old public APIs are still tested during the migration:

```bash
npm run test:quote
npm run test:catchphrase
npm run test:boomerang
npm run test:session
```

`CatchphraseClusterer` now delegates to repetition graph logic. `BoomerangDetector` delegates to contradiction graph logic. `FacetScorer` and QuoteScorer consume the shared event layer for semantic cues.

That means compatibility tests also act as regression checks that P0/P1 did not silently break the current awards-first prototype.

## Full suite

```bash
npm test
```

The repository workflow runs type-checking and the full test suite on pushes to `main` and pull requests.

## Benchmark philosophy

Raw scores are not the product truth. Tests should prefer behavioral orderings and structured relationships over arbitrary fixed numbers.

The benchmark stack should evolve into four levels:

1. **Unit / scorer regression** — formatting, extraction, local ranking and hard-negative behavior.
2. **Event regression** — what happened in each transcript unit.
3. **Graph / Moment regression** — which events repeat, contradict, retract, or form a larger story.
4. **Human preference** — if a person can only keep one or a few moments, which ones are actually worth putting in Wrapped?

The fourth layer is the most important long-term evaluation. Synthetic examples are useful for preventing regressions, but they must not become a closed loop where we write rules, write examples for those rules, and then call passing tests proof that the output is funny.

When real DSH or other agent transcripts are added, they should be anonymized or represented by minimal derived fixtures unless the original text is intentionally public.
