# Moment Engine architecture

Agent Wrapped is an **awards show built from session moments**, not a collection of award-specific detectors.

The core rule is:

> First understand what happened. Then understand how those events relate. Then assemble complete moments and rank how entertaining they are. Only after that decide how to present them as awards.

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
   └─ readability
   ↓
AwardComposer                  ← P3.5 next
   ↓
🎬 Agent Wrapped
```

Awards are a presentation layer. `🐺`, `🤡`, `🍾`, and `📢` should not each grow an independent language parser.

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

The old CatchphraseClusterer and BoomerangDetector APIs remain compatibility surfaces, but their semantic relationship logic lives underneath the award layer.

---

# P2 — Moment model + MomentBuilder ✅

P2 is the first stage that assembles **stories** rather than isolated facts.

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
count/variants (when relevant)
evidence[]
```

A Moment deliberately has no award title or emoji. It is analysis output, not presentation output.

`src/moments/momentBuilder.ts` currently composes six moment types.

## `one_liner`

A single event with enough standalone/drama value to remain a candidate without context.

Example:

```text
重大发现！！！我们前面的路线完全错了！
```

## `repeated_pattern`

A connected repetition cluster assembled from `repeats` / `similar_to` relations.

Example:

```text
现在问题已经非常明确了。
问题现在已经很清楚了。
这下问题就非常明确了！
```

The Moment preserves canonical text, variants, count, and all message positions.

## `boomerang`

A pair created from a `contradicts` relation.

```text
可以完全排除缓存。
        ↓
最终根因还是缓存。
```

This is the structural moment. Calling it `🤡 最大回旋镖` belongs to P3.5.

## `false_dawn`

A pair created from `celebrates_before`.

```text
这次应该真的没问题了！
        ↓
等等，不对……
```

## `plot_twist`

An explicit correction/reversal. When a `retracts` relation exists, the Moment includes the earlier view as context; otherwise a sufficiently strong standalone reversal can still become a plot-twist candidate.

## `correction_arc`

A short multi-event narrative:

```text
earlier diagnosis / confident state
        ↓
explicit correction or reversal
        ↓
renewed diagnosis / discovery state
```

P2 uses a bounded message window and requires at least a three-event structure. This is deliberately a composition primitive, not a hard-coded award.

## P2 overlap policy

The builder is allowed to emit overlapping moments.

For example, a dramatic reversal line may simultaneously appear as:

- a `one_liner`;
- a `plot_twist`;
- the pivot of a `correction_arc`;
- one side of a `boomerang`.

That is intentional. P2 maximizes useful structural recall. P3 ranks candidates; P3.5 will perform final diversity/deduplication for display.

---

# P3 — MomentRanker ✅

P3 answers:

> Which complete moments are most entertaining and worth showing?

It does **not** assign award names.

`src/moments/momentRanker.ts` scores each composed Moment on independent dimensions.

## `funScore`

Overall entertainment ranking signal. It uses type-specific weights rather than pretending a one-liner and a boomerang are funny for the same reason.

For example:

- one-liners emphasize standalone wording and surprise;
- repeated patterns emphasize repetition structure and context payoff;
- boomerangs emphasize contradiction, surprise, and before/after payoff;
- false dawns emphasize sequence payoff;
- correction arcs emphasize multi-step context and structural strength.

## `confidence`

Confidence that the underlying extraction/relationship is genuinely present.

**Confidence never multiplies `funScore`.**

This is a hard design boundary. A candidate can be:

```text
funScore = 94
confidence = 57
```

and remain a strong candidate for a future semantic reranker instead of being silently treated as “not funny.”

## Supporting dimensions

P3 also exposes:

- `standaloneQuality` — how well the wording works without context;
- `contextPayoff` — how much the session structure adds;
- `surprise` — reversal/unexpected-turn energy;
- `rarity` — relative scarcity of the moment type in the current candidate set;
- `readability` — whether the selected span is screenshot/readback friendly;
- `structuralStrength` — strength of the event/graph evidence supporting the Moment.

## Ranking behavior

`rankMoments(graph, moments)` sorts primarily by `funScore`, using confidence/context only as tie-breakers. Optional filters can set independent minimums for fun and confidence.

The convenience API:

```ts
analyzeMoments(messages)
```

runs the current core pipeline end-to-end:

```text
P0 EventExtractor
→ P1 MomentGraph
→ P2 MomentBuilder
→ P3 MomentRanker
```

and returns ranked `RankedMoment[]`.

---

# Legacy compatibility after P3

The existing QuoteScorer, FacetScorer, CatchphraseClusterer, BoomerangDetector, and SessionAnalyzer APIs still exist so the earlier regression suite and integrations do not break during migration.

`SessionAnalyzer` is still an awards-first compatibility adapter. It already consumes the P1 graph for repeated patterns, contradictions, and false-dawn relationships, but it should **not** become the new product architecture.

P3.5 will introduce `AwardComposer`, and that will become the proper presentation layer over ranked Moments.

No new `SomethingDetector` should be introduced unless the concept truly cannot be represented as:

```text
Event
→ Relation
→ Moment composition
```

---

# Test boundaries

The regression suite is now layered:

```text
test:event           → P0 event extraction
test:graph           → P1 relations
test:moment-builder  → P2 composition
test:moment-ranker   → P3 scoring/ranking
test:moments         → P2 + P3 together
```

The older quote/catchphrase/boomerang/session tests remain compatibility tests.

P2 tests verify that the same graph can create repeated patterns, boomerangs, false dawns, plot twists, and correction arcs without award metadata leaking into the Moment model.

P3 tests verify that:

- contextual boomerangs outrank generic status lines;
- `funScore` remains independent from confidence;
- stronger repetition increases repeated-pattern payoff;
- correction arcs gain value from context rather than only one sentence;
- `analyzeMoments()` returns descending ranked Moments.

The repository CI runs both `npm run check` and the complete `npm test` suite, so P2/P3 regressions are validated together with the legacy compatibility tests rather than in isolation.

---

# Architectural boundary after P3

P0 through P3 now answer:

```text
P0  What happened?
P1  How are those things related?
P2  Which event/relationship structures form complete moments?
P3  Which moments are most entertaining?
```

They intentionally do **not** answer:

```text
Which 4–7 moments should appear together on the final Wrapped card?
How much category diversity should the final set have?
Should two overlapping moments collapse into one display item?
What should each award be called?
Should an award title be fixed or dynamically generated from the moment?
```

Those belong to **P3.5 — AwardComposer**.

The next stage should consume ranked Moments, perform display-level diversity/deduplication, select only genuinely strong material, and map those moments into the playful award language users actually see.
