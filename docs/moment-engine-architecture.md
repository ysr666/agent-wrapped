# Moment Engine architecture

Agent Wrapped is an **awards show built from session moments**, not a collection of award-specific detectors.

The core rule is:

> First understand what happened. Then understand how those events relate. Only later decide how to present the funniest moments as awards.

## Pipeline

```text
Transcript
   ↓
Transcript / Unit normalization
   ↓
EventExtractor                 ← P0
   ↓
Event[]
   ↓
MomentGraph                    ← P1
   ├─ repeats
   ├─ similar_to
   ├─ same_topic
   ├─ contradicts
   ├─ retracts
   ├─ followed_by
   └─ celebrates_before
   ↓
MomentBuilder                  ← P2
   ↓
MomentRanker                   ← P3
   ↓
AwardComposer                  ← P3.5
   ↓
🎬 Agent Wrapped
```

Awards are a presentation layer. `🐺`, `🤡`, `🍾`, and `📢` should not each grow an independent language parser.

---

# P0 — Event model + EventExtractor ✅

P0 establishes a single structured description of each assistant-visible transcript unit.

## Canonical unit extraction

`src/transcript/unitExtractor.ts` owns sentence-like splitting for the new architecture. It keeps short dramatic lead-ins attached to the sentence that gives them meaning, for example:

```text
重大发现！！！我们前面的路线完全错了！
Wait! I was wrong.
```

User/tool/system content is not turned into assistant events.

## Event model

`src/events/types.ts` defines a multi-label `Event`.

A single line may simultaneously contain discovery, confidence, and reversal. Therefore `primaryType` is only a summary; downstream code should use `signals` for the full meaning.

Current event signals:

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

Each event also carries:

- normalized and simplified text;
- message/unit position;
- extraction confidence;
- `drama` and `standaloneQuality` surface scores;
- canonical topics;
- structured topic claims and stance;
- an optional verbal-tic family.

## One lexicon, one topic resolver

`src/events/lexicon.ts` is the shared rule/phrase layer for event signals and common verbal-tic families.

`src/events/topicResolver.ts` is the shared topic + stance layer for claims such as:

```text
可以排除缓存        → cache / exclude
最终根因还是缓存    → cache / blame
不是缓存，而是配置  → cache / exclude + config / blame
```

Host/model differences may later tune a profile or prior, but they must not create separate definitions of what a discovery, reversal, or contradiction is.

## Legacy compatibility after P0

The existing public modules remain callable, but semantic interpretation is being moved underneath them:

- `FacetScorer` now derives its semantic facets from `EventExtractor`;
- `QuoteScorer` uses the canonical UnitExtractor and EventExtractor for semantic cues, while keeping only standalone-quote concerns such as code noise, length, formatting, and generic-template penalties;
- `BoomerangDetector` no longer owns its own topic/stance parser.

This lets the existing benchmark suite keep running while the architecture migrates incrementally.

---

# P1 — Moment Graph ✅

P1 connects events. The graph describes relationships; it does **not** decide awards.

## Graph model

`src/graph/types.ts` defines `MomentGraph` and `MomentRelation`.

Current relations:

### `repeats`
Exact normalized repetition.

### `similar_to`
Conservative local paraphrase / verbal-tic similarity.

Known verbal families are high-confidence. Unknown wording can use bounded high-overlap n-gram matching.

### `same_topic`
Two events refer to the same canonical topic.

### `contradicts`
Two events make opposite explicit claims about the same topic.

Example:

```text
cache / exclude
      ↓ contradicts
cache / blame
```

### `retracts`
A later explicit correction/reversal retracts an earlier same-topic view.

### `followed_by`
Chronological adjacency between extracted events.

### `celebrates_before`
A celebration/resolution claim is followed within a bounded window by an explicit correction/reversal.

This is the graph primitive that can later become a `false_dawn` Moment; it is not itself the 🍾 award.

## Long-session behavior

P1 avoids an unrestricted all-pairs comparison.

- exact and known-family repetition use indexed previous matches;
- fuzzy repetition only scans a bounded recent-event window;
- topic/contradiction matching scans a bounded recent-event window and message-distance horizon.

This keeps local-first analysis practical for long agent sessions.

## Legacy compatibility after P1

`CatchphraseClusterer` is now a compatibility wrapper over graph repetition relations and connected components.

`BoomerangDetector` is now a compatibility wrapper over `MomentGraph.contradicts` relations.

Their external APIs remain useful for current `SessionAnalyzer` tests, but the language/relationship logic now lives below the award layer.

---

# Architectural boundary after P1

P0 and P1 answer only:

```text
What happened?
How are those things related?
```

They intentionally do **not** answer:

```text
Which relationships form a complete entertaining Moment?
Which Moments are funniest?
Which 4–7 should appear in Wrapped?
What should each award be called?
```

Those belong to P2/P3/P3.5.

Until P2 is complete, `SessionAnalyzer` remains a legacy awards-first adapter for compatibility. New features should not add another `SomethingDetector`; they should first ask whether the behavior is an Event type, a graph Relation, or eventually a Moment composition.

## Next stage

P2 should introduce a `Moment` model and `MomentBuilder` that consumes `Event[] + MomentRelation[]` and emits compositions such as:

```text
one_liner
repeated_pattern
boomerang
false_dawn
plot_twist
correction_arc
```

That is the point where Agent Wrapped moves from detecting signals to actually assembling stories.
