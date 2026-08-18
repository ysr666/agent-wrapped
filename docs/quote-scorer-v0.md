# QuoteScorer v0

QuoteScorer is deliberately **local-first, not local-only** and now has a narrower architectural role:

> Given one extracted transcript unit, how well does this line work as a standalone, screenshot-worthy quote?

It is **not** the system's language-understanding layer and it is not a universal “is this fun?” classifier.

A line can lose the standalone quote ranking and still become the best catchphrase, boomerang, false dawn, or other Moment once session context is considered.

## P0 relationship

Semantic cues now come from the shared `EventExtractor`.

QuoteScorer consumes event-level discovery, reversal, self-correction, confidence, and drama signals. It keeps quote-specific concerns locally:

- expressive punctuation;
- rhetorical contrast;
- quote-friendly length;
- cross-signal synergy;
- generic-template penalty;
- code / command / stack-trace noise;
- repetition penalty for the **one-off quote slot**.

This avoids maintaining a second independent definition of `root cause`, `wrong`, `confidence`, and similar event language inside QuoteScorer.

The canonical sentence-like splitting also lives in `src/transcript/unitExtractor.ts` rather than in QuoteScorer.

## Why standalone scoring still matters

Some Moments work because one line is already excellent by itself:

> 重大发现！！！我们前面的路线完全错了！

Others only become funny after context:

> 这次应该真的没问题了！
>
> → later: 等等，不对……

The first needs strong standalone quality. The second needs graph/context payoff. Keeping those concepts separate is important for P2/P3.

## Current compatibility facets

`scoreQuoteFacets()` remains available for the legacy `SessionAnalyzer`, but its semantic values also derive from `EventExtractor`.

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

These compatibility facets will gradually give way to Event + Relation + Moment data as P2/P3 land.

## Local-first boundary

Rules are useful for high-recall structural extraction, but they are intentionally weaker at:

- subtle irony;
- domain-specific jokes;
- implicit semantic contradiction;
- long-range callbacks;
- deciding whether a discovery was genuinely surprising in context;
- taste-level decisions between several equally plausible funny moments.

Those problems do not belong in QuoteScorer. P0/P1 structure the transcript locally; P2 builds Moments; a later optional semantic layer can rerank a small candidate set.

## v0 regression criterion

For the standalone quote slot, explicit dramatic reversals should consistently outrank generic confident status updates.

A useful ordering remains:

1. `重大发现！！！我们前面的路线完全错了！`
2. `等等，我刚才的判断可能完全反了。`
3. `我找到了真正的根因。`
4. `现在问题已经非常明确了。`
5. `我先检查一下配置文件。`

But line 4 repeated twelve times should still become strong repetition evidence in the Moment Graph. Losing the quote ranking must never mean the line is discarded from the rest of the system.
