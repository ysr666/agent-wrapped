# Product Vision

## One-line idea

Make an awards show out of AI coding sessions.

## What this is

Agent Wrapped extracts the funniest, most dramatic, and most repeated moments from AI-agent transcripts.

The core categories are deliberately different from ordinary session analytics:

### 1. Memorable quote
A one-off line with strong dramatic or comedic value.

Example:

> “Major discovery!!! Our whole approach was wrong!”

Frequency is not required. A quote can win because it has a strong reversal, surprise, emotional spike, or absurd level of confidence.

### 2. Catchphrase
A phrase or sentence pattern that repeats enough to feel like the agent’s verbal tic.

Examples:

- “Now the problem is very clear.” × 9
- “Wait…” × 14
- “We found the root cause.” × 7

Near-duplicate wording should be clustered rather than counted separately.

### 3. Boomerang
Two statements from the same session that form a funny or striking contradiction.

Example:

> 21:06 — “We can rule out caching.”
>
> 21:48 — “The root cause is caching.”

### 4. Called-it-too-early moment
Repeated declarations that the issue is solved, understood, or traced to a root cause before the session actually converges.

### 5. Plot twist
A sudden change in direction, especially when the agent explicitly retracts or overturns an earlier assumption.

### 6. Emotional peak / celebration
Short lines such as “离谱！！！”, “完美命中！！！”, or “这次应该真的没问题了！” may be entertaining even when they are not the best standalone quote. They should remain eligible for emotional-peak, celebration, or premature-victory awards.

## Fun-first scoring principle

**Not the quote-of-the-session winner does not mean not interesting.**

Agent Wrapped should not collapse every line into a single good/bad score. A sentence can be weak in one dimension and excellent in another:

```text
“现在问题已经非常明确了。”
quote: medium/low
catchphrase: very high when repeated

“这次真的找到根因了！！！”
quote: medium/high
discovery: high
wolf-cried-again: extremely high when repeated

“完美命中！！！”
quote: medium
celebration: high
emotional peak: high

“重大发现！！！我们前面的路线完全错了！”
quote: very high
discovery: high
reversal: very high
drama: very high
```

The current local prototype therefore treats quote ranking as only one facet. Other candidate facets include drama, discovery, reversal, progress, celebration, catchphrase, and repeated root-cause / wolf-cry potential.

Final awards should be decided from the whole session, not by throwing away lines that fail to win one ranking.

## MVP boundary

The first prototype should **not** try to become a full telemetry dashboard.

It should answer three questions well:

1. What was the funniest / most dramatic line in this session?
2. What did the agent keep saying?
3. What was the biggest reversal?

Then it can add lightweight side awards such as emotional peak, premature celebration, and wolf-cried-again without turning into a productivity dashboard.

## Extraction strategy

Start local and deterministic:

1. Normalize transcript messages.
2. Split exposed assistant text into sentence-like units.
3. Extract repeated n-grams / sentence patterns for catchphrases.
4. Score quote candidates using signals such as:
   - exclamation / punctuation intensity
   - reversal language
   - surprise / discovery language
   - explicit self-correction
   - unusual wording
   - confidence markers
5. Keep additional fun-category facets instead of discarding non-winning lines.
6. Detect contradiction candidates between nearby or semantically related claims.
7. Optionally allow an LLM reranker later, but do not require it for the default experience.

## Output concept

A single session could end with:

> ## 🎬 Tonight’s Agent Wrapped
>
> **🏆 Quote of the session**  
> “Major discovery!!! Our whole approach was wrong!”
>
> **📢 Catchphrase**  
> “Now the problem is very clear.” × 9
>
> **🤡 Biggest boomerang**  
> “Definitely not caching.” → “The root cause is caching.”
>
> **🐺 Root cause declarations**  
> 7
>
> **🍾 Earliest victory lap**  
> “This should be fixed now.”
>
> **😱 Emotional peak**  
> “这也太诡异了！！！”

## Privacy boundary

Agent Wrapped only analyzes transcript content exposed by the host runtime or exported by the user. It does not attempt to recover hidden chain-of-thought.

## Long-term direction

Keep the analysis core host-agnostic so the same engine can eventually compare DSH, Claude Code, Codex, and other agent runtimes in weekly / monthly / yearly Wrapped reports.
