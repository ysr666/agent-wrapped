# Moment Engine architecture

Agent Wrapped is an **awards show built from session moments**, not a collection of award-specific detectors.

The core rule is:

> First understand what happened. Then understand how those events relate. Then assemble complete moments and rank how entertaining they are. Only after that decide which moments deserve cards and how to present them.

## Pipeline

```text
Transcript
   ↓
Transcript / Unit normalization
   ↓
EventExtractor                 ← P0 ✅
   ↓
Event[]
   ↓
MomentGraph                    ← P1 ✅
   ├─ repeats
   ├─ similar_to
   ├─ same_topic
   ├─ contradicts
   ├─ retracts
   ├─ followed_by
   └─ celebrates_before
   ↓
MomentBuilder                  ← P2 ✅
   ├─ one_liner
   ├─ repeated_pattern
   ├─ boomerang
   ├─ false_dawn
   ├─ plot_twist
   └─ correction_arc
   ↓
MomentRanker                   ← P3 ✅
   ├─ funScore
   ├─ confidence
   ├─ standaloneQuality
   ├─ contextPayoff
   ├─ surprise
   ├─ rarity
   ├─ readability
   └─ structuralStrength
   ↓
AwardComposer                  ← P3.5 ✅
   ├─ quote
   ├─ catchphrase
   ├─ boomerang
   ├─ wolf-cry
   ├─ premature-celebration
   ├─ plot-twist
   └─ emotional-peak
   ↓
WrappedReport / Renderer       ← P4 ✅
   ├─ compact share payload
   ├─ Markdown
   ├─ plain text
   └─ human-preference hooks
   ↓
🎬 Agent Wrapped
```

Awards are a presentation layer. `🐺`, `🤡`, `🍾`, and `📢` do not each get an independent language parser.

---

# P0 — Event model + EventExtractor ✅

P0 establishes a single structured description of each assistant-visible transcript unit.

`src/transcript/unitExtractor.ts` owns sentence-like splitting. `src/events/eventExtractor.ts` converts those units into multi-label events rather than forcing each line into a single class.

Current event signals include:

```text
discovery_claim
confidence_claim
progress_claim
resolution_claim
correction
reversal
celebration
confusion
apology
promise
neutral
```

Each event also carries normalized/simplified text, message position, topics, structured claims/stance, an optional verbal family, drama, standalone quality, and extraction confidence.

`src/events/lexicon.ts` is the shared phrase/rule layer. `src/events/topicResolver.ts` is the shared topic/stance layer.

Examples:

```text
可以排除缓存        → cache / exclude
最终根因还是缓存    → cache / blame
不是缓存，而是配置  → cache / exclude + config / blame
```

Host/model differences may later tune profiles or priors, but they must not create separate definitions of discovery, reversal, or contradiction.

---

# P1 — Moment Graph ✅

P1 connects events without deciding awards.

`src/graph/types.ts` defines `MomentGraph` and `MomentRelation`.

Current relations:

- `repeats` — exact normalized repetition;
- `similar_to` — conservative local paraphrase/verbal-tic similarity;
- `same_topic` — shared canonical topic;
- `contradicts` — opposite explicit claims about the same topic;
- `retracts` — later explicit correction/reversal of an earlier same-topic view;
- `followed_by` — chronological adjacency;
- `celebrates_before` — celebration/resolution followed soon by correction/reversal.

P1 avoids unrestricted all-pairs scans. Exact/family repetition uses indexed previous matches; fuzzy repetition and topic comparison use bounded recent-event windows.

The old CatchphraseClusterer and BoomerangDetector APIs remain compatibility surfaces, but their semantic relationship logic now lives underneath the award layer.

---

# P2 — Moment model + MomentBuilder ✅

P2 assembles **stories** rather than isolated facts.

The canonical model lives in `src/moments/types.ts`. A `Moment` contains:

```text
id
type
eventIds
relationIds
messageIndexes
primaryText
relatedTexts
topic/topicLabel (when relevant)
family (for repeated verbal patterns)
count/variants (when relevant)
evidence[]
```

A Moment deliberately has no award title or emoji. It is analysis output, not presentation output.

`src/moments/momentBuilder.ts` composes six moment types.

## `one_liner`

A single event with enough standalone/drama value to remain a candidate without context.

```text
重大发现！！！我们前面的路线完全错了！
```

## `repeated_pattern`

A connected repetition cluster assembled from `repeats` / `similar_to` relations.

```text
现在问题已经非常明确了。
问题现在已经很清楚了。
这下问题就非常明确了！
```

The Moment preserves canonical text, variants, count, message positions, and its typed verbal-family hint.

## `boomerang`

A pair created from a `contradicts` relation.

```text
可以完全排除缓存。
        ↓
最终根因还是缓存。
```

This is structural analysis. Calling it `🤡 最大回旋镖` happens later in P3.5.

## `false_dawn`

A pair created from `celebrates_before`.

```text
这次应该真的没问题了！
        ↓
等等，不对……
```

## `plot_twist`

An explicit correction/reversal. When a `retracts` relation exists, the Moment carries the earlier view as context; otherwise a sufficiently strong standalone reversal can still become a plot-twist candidate.

## `correction_arc`

A short multi-event narrative:

```text
earlier diagnosis / confident state
        ↓
explicit correction or reversal
        ↓
renewed diagnosis / discovery state
```

P2 intentionally allows overlapping candidates. One dramatic reversal can appear as a one-liner, plot twist, correction-arc pivot, or one side of a boomerang. P3.5 decides what should actually survive to display.

---

# P3 — MomentRanker ✅

P3 answers:

> Which complete moments are most entertaining and worth showing?

It does **not** assign award names.

`src/moments/momentRanker.ts` scores each Moment on independent dimensions.

## `funScore`

Overall entertainment ranking signal. Type-specific weights are used because a one-liner and a boomerang are funny for different reasons.

- one-liners emphasize standalone wording and surprise;
- repeated patterns emphasize repetition structure and context payoff;
- boomerangs emphasize contradiction and before/after payoff;
- false dawns emphasize sequence payoff;
- correction arcs emphasize multi-step context and structural strength.

## `confidence`

Confidence that the underlying extraction/relationship is genuinely present.

**Confidence never multiplies `funScore`.**

A candidate can legitimately be:

```text
funScore = 94
confidence = 57
```

and remain visible for later semantic verification instead of being silently treated as “not funny.”

Supporting dimensions:

```text
standaloneQuality
contextPayoff
surprise
rarity
readability
structuralStrength
```

`rankMoments(graph, moments)` sorts primarily by `funScore`, with confidence/context only as tie-breakers. Independent minimum thresholds can be applied.

`analyzeMoments(messages)` remains the convenient P0→P3 analysis-only API.

---

# P3.5 — AwardComposer ✅

P3.5 answers:

> Which ranked moments should actually appear together in one Wrapped?

It consumes `RankedMoment[]`. It does **not** inspect raw transcript messages and it does not add another phrase detector.

The canonical code lives in:

```text
src/awards/types.ts
src/awards/awardComposer.ts
```

Current user-facing award kinds:

```text
quote
catchphrase
boomerang
wolf-cry
premature-celebration
plot-twist
emotional-peak
```

Default Chinese labels are:

```text
🏆 本场金句
📢 高频口癖
🤡 最大回旋镖
🐺 狼来了奖
🍾 香槟开早了
🧠 剧情急转弯
💀 精神状态
```

English labels are also supported.

## Core-slot policy

The first selection pass protects the three MVP questions when strong candidates exist:

1. strongest quote;
2. strongest repeated verbal pattern (`catchphrase` or `wolf-cry`);
3. strongest boomerang.

The second pass fills remaining slots from the ranked candidate pool.

This prevents a flood of structurally rich plot-twist variants from accidentally removing the product’s basic “best quote / what did it keep saying / biggest self-own” experience.

## Quality policy

P3.5 does not force a fixed number of awards.

Default behavior:

- quality floor via `minFunScore`;
- confidence can be filtered independently via `minConfidence`;
- default max is 5;
- hard cap is 7;
- default max per award kind is 1;
- identical underlying event sets collapse;
- strongly overlapping candidates within the same award family collapse;
- cross-award reuse of a line is allowed when the surrounding structure changes the joke.

A quiet session may produce zero cards. That is preferred to inventing filler.

## Source wording boundary

P3.5 never rewrites `primaryText` or `relatedTexts`. Award titles are presentation metadata; the quoted transcript text stays source-faithful.

---

# P4 — WrappedReport / output + evaluation shell ✅

P4 is the first complete product-facing layer.

It is intentionally thin: it orchestrates the already-tested phases and packages the result for display, sharing, and human evaluation.

The canonical code lives in:

```text
src/wrapped/types.ts
src/wrapped/wrappedReport.ts
src/wrapped/renderer.ts
src/wrapped/preference.ts
```

## `createWrappedReport(messages)`

Runs:

```text
P0 EventExtractor
→ P1 MomentGraph
→ P2 MomentBuilder
→ P3 MomentRanker
→ P3.5 AwardComposer
→ WrappedReport
```

The report contains:

```text
version
locale
title
awards[]
metrics
diagnostics
rankedMoments?   // opt-in only
```

By default the share payload does **not** include all P3 ranked moments. `includeRankedMoments: true` exists for debugging and human preference evaluation.

## Renderers

P4 currently exports:

```ts
renderWrappedMarkdown(report)
renderWrappedText(report)
```

Renderers preserve source wording and hide `funScore` / confidence unless score display is explicitly enabled.

Paired and multi-step moments are rendered chronologically. For example a correction arc is shown as:

```text
before
  →
correction pivot
  →
after
```

rather than exposing P2’s internal `primaryText` storage order.

## Human-preference hook

`summarizeWrappedPreferences(report, votes)` provides a small local data contract for real-session evaluation:

```text
keep / drop
optional 1–5 fun rating
latest vote per award wins
unknown award ids ignored
keep rate / average fun / missing votes summarized
```

This is deliberately not a learned reranker yet. It creates the measurement seam needed to collect preference data before adding more semantic complexity.

---

# Legacy compatibility after P4

The existing QuoteScorer, FacetScorer, CatchphraseClusterer, BoomerangDetector, and SessionAnalyzer APIs remain so earlier tests/integrations do not break during migration.

`SessionAnalyzer` is an awards-first compatibility adapter. New product work should use:

```text
Event
→ Relation
→ Moment
→ RankedMoment
→ Award
→ WrappedReport
```

No new `SomethingDetector` should be introduced unless the concept truly cannot be represented inside those layers.

---

# Test boundaries

The regression suite is layered:

```text
test:event           → P0 event extraction
test:graph           → P1 relations
test:moment-builder  → P2 composition
test:moment-ranker   → P3 scoring/ranking
test:award-composer  → P3.5 selection/presentation mapping
test:wrapped         → P4 end-to-end report/render/evaluation
test:moments         → P2 through P4 combined
```

P3.5 tests verify:

- seven distinct award families can coexist;
- identical underlying stories collapse;
- weak moments are not forced into the report;
- output remains capped at seven;
- the core quote/repetition/boomerang slots survive competition from side moments.

P4 tests verify:

- P0→P3.5 runs end to end;
- user/tool text does not become analysis content;
- source wording survives report composition and rendering;
- Markdown/plain-text output hides internal scores by default;
- quiet sessions can return zero awards;
- English presentation works without rewriting transcript text;
- human preference votes are summarized deterministically.

---

# Architectural boundary after P4

P0 through P4 now answer:

```text
P0    What happened?
P1    How are those things related?
P2    Which event/relation structures form complete moments?
P3    Which moments are most entertaining?
P3.5  Which moments belong together in the final award set?
P4    How do we package, render, and evaluate that Wrapped result?
```

Still intentionally outside the current core:

```text
host-specific transcript discovery/adapters
weekly/monthly aggregation
cross-agent leaderboards
optional embedding/LLM semantic rerank
web/share-card visual UI
large-scale preference-trained calibration
```

Those should build on `WrappedReport` rather than bypassing the Moment Engine.
