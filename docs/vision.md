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

## MVP boundary

The first prototype should **not** try to become a full telemetry dashboard.

It should answer three questions well:

1. What was the funniest / most dramatic line in this session?
2. What did the agent keep saying?
3. What was the biggest reversal?

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
5. Detect contradiction candidates between nearby or semantically related claims.
6. Optionally allow an LLM reranker later, but do not require it for the default experience.

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

## Privacy boundary

Agent Wrapped only analyzes transcript content exposed by the host runtime or exported by the user. It does not attempt to recover hidden chain-of-thought.

## Long-term direction

Keep the analysis core host-agnostic so the same engine can eventually compare DSH, Claude Code, Codex, and other agent runtimes in weekly / monthly / yearly Wrapped reports.
