# Product Vision

## One-line idea

Make an awards show out of AI coding sessions.

## What this is

Agent Wrapped extracts the funniest, most dramatic, and most repeated moments from AI-agent transcripts.

The product is **moment-first, award-second**. “Quote”, “catchphrase”, “boomerang”, and “wolf cry” are presentation choices for interesting session moments, not separate definitions of how the transcript should be understood.

## Core experience

### Memorable quote
A one-off line with strong dramatic or comedic value.

> “Major discovery!!! Our whole approach was wrong!”

### Catchphrase
A phrase or sentence pattern that repeats enough to feel like the agent’s verbal tic.

- “Now the problem is very clear.” × 9
- “Wait…” × 14
- “We found the root cause.” × 7

Near-duplicate wording should be clustered rather than counted separately.

### Boomerang
Two statements from the same session that form a funny or striking contradiction.

> 21:06 — “We can rule out caching.”
>
> 21:48 — “The root cause is caching.”

### Called-it-too-early moment
Repeated declarations that the issue is solved, understood, or traced to a root cause before the session actually converges.

### Plot twist
A sudden change in direction, especially when the agent explicitly retracts or overturns an earlier assumption.

### Emotional peak / celebration
Short lines such as “离谱！！！”, “完美命中！！！”, or “这次应该真的没问题了！” may be entertaining even when they are not the best standalone quote.

## Fun-first principle

**Not the quote-of-the-session winner does not mean not interesting.**

A sentence can be weak in one dimension and excellent in another. Repetition, later context, contradiction, or a spectacular self-own can turn an ordinary-looking line into the best moment of the session.

This means the system must preserve two different questions:

- **How entertaining is this moment?**
- **How confident are we that we understood it correctly?**

`funScore` and extraction/relation confidence should remain separate throughout the architecture.

## MVP boundary

The prototype should **not** become a telemetry or productivity dashboard.

It should answer three questions well:

1. What moment is most worth quoting from this session?
2. What did the agent keep saying?
3. What was the biggest reversal / self-own?

Lightweight side moments such as emotional peaks, false dawns, and repeated root-cause declarations are welcome when they are genuinely strong.

## Moment Engine

The analysis core follows this direction:

```text
Transcript
   ↓
UnitExtractor
   ↓
EventExtractor
   ↓
Event[]
   ↓
MomentGraph
   ├─ repeats / similar_to
   ├─ same_topic
   ├─ contradicts / retracts
   ├─ followed_by
   └─ celebrates_before
   ↓
MomentBuilder
   ↓
MomentRanker
   ↓
optional semantic rerank
   ↓
AwardComposer
   ↓
🎬 Agent Wrapped
```

The important separation is:

- **Event** — what happened in one transcript unit;
- **Relation** — how two events relate;
- **Moment** — why one or more events are worth revisiting;
- **Award** — how that moment is presented to the user.

P0 (`EventExtractor`) and P1 (`MomentGraph`) are now the foundation. Existing QuoteScorer / CatchphraseClusterer / BoomerangDetector APIs remain as compatibility surfaces while their semantic logic moves underneath them.

## Local-first strategy

Local-first does not mean local-only.

The default local engine should reduce a long private transcript to a small set of high-recall structured events and moment candidates. A later optional semantic layer can rerank or resolve ambiguous candidates without uploading the full transcript.

Target flow:

```text
large transcript
  ↓ local
structured events + graph
  ↓ local
small Moment candidate set
  ↓ optional
local embedding / small model / opt-in LLM director
```

An LLM should be a quality upgrade for ambiguous semantics and final taste, not a requirement for basic operation.

## Model / host boundary

The core event and relation definitions are host-agnostic.

DeepSeek/DSH, Claude Code, Codex, and other runtimes can have calibration profiles or lexical priors, but the core must not encode assumptions such as “DeepSeek always talks like X”. Style depends on model, harness, version, system prompt, and user behavior together.

## Output concept

A single session might end with only the strongest 4–7 moments rather than forcing every possible award:

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
> **🐺 Called it too early**  
> Root-cause declarations: 7
>
> **🍾 Premature celebration**  
> “This should be fixed now.” → “Wait, no…”

Award titles may eventually become dynamic when that produces a better joke than a fixed label.

## Privacy boundary

Agent Wrapped only analyzes transcript content exposed by the host runtime or exported by the user. It does not attempt to recover hidden chain-of-thought.

## Long-term direction

Keep the analysis core host-agnostic so the same engine can eventually produce weekly / monthly / yearly Wrapped reports and compare recurring behavior across DSH, Claude Code, Codex, and other agent runtimes.
