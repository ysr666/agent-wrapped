# QuoteScorer v0

QuoteScorer v0 is deliberately **local-first, not local-only**.

Its job is narrow: rank sentence-like assistant utterances by how likely they are to be a memorable, funny, dramatic quote.

It does **not** try to fully understand the whole session, prove contradictions, or replace a semantic model.

## Why start local

For the quote-of-the-session task, many of the strongest signals are structural and cheap to detect:

- explicit reversal: “we were wrong”, “our whole approach was wrong”, “不对”, “前面的路线完全错了”
- discovery language: “found it”, “root cause”, “重大发现”, “找到了真正的问题”
- self-correction: “I was wrong”, “我刚才判断错了”
- confidence escalation: “exact defect”, “definitely”, “可以确定”, “根因就是”
- dramatic punctuation and interjections
- contrast / plot-twist language
- repetition, which is useful as a **negative** signal for quote ranking because repeated lines usually belong in the catchphrase category instead

These signals are multilingual enough to get a useful first ranking without sending private transcripts to another model or adding token cost.

## What v0 scores

The current scorer combines:

1. expressive punctuation
2. discovery / root-cause declarations
3. explicit reversals
4. self-corrections
5. confidence markers
6. dramatic / surprising wording
7. contrast markers
8. quote-friendly length
9. cross-signal synergy

It subtracts points for:

- generic agent templates such as “Now the problem is very clear.”
- code / command / stack-trace noise
- exact repetition, because repeated lines are more likely to be catchphrases than one-off quotes

A line such as:

> 重大发现！！！我们前面的路线完全错了！

scores highly because it combines discovery + reversal + confidence + dramatic punctuation, not merely because it contains one magic keyword.

## What local rules will *not* reliably solve

Rule-based scoring is intentionally weaker at:

- subtle irony
- domain-specific jokes
- semantic contradiction with very different wording
- deciding whether a technical discovery was genuinely surprising in context
- long-range callbacks spanning many messages
- distinguishing a brilliant line from a merely emotional line when both use similar surface language

Those belong to later stages.

## Planned architecture

```text
transcript
  ↓
local deterministic extraction
  ├─ sentence-like units
  ├─ quote signals
  ├─ repetition / catchphrase candidates
  └─ obvious reversal events
  ↓
local ranking (default, zero API cost)
  ↓
optional semantic layer
  ├─ local embeddings / small local model, if practical
  └─ opt-in LLM reranker for a small Top-N candidate set
```

The default experience should remain useful offline and private. An LLM should be an optional quality upgrade, not a requirement for the product to function.

## v0 success criterion

Before adding any LLM reranking, QuoteScorer v0 should consistently rank explicit dramatic reversals above generic confident status updates.

For example, this ordering is desired:

1. `重大发现！！！我们前面的路线完全错了！`
2. `等等，我刚才的判断可能完全反了。`
3. `我找到了真正的根因。`
4. `现在问题已经非常明确了。`
5. `我先检查一下配置文件。`

The exact scores are not important yet; the ordering is.
