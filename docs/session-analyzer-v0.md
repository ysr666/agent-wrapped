# SessionAnalyzer v0

`SessionAnalyzer` is now a **legacy awards-first compatibility adapter** over the P0/P1 Moment Engine foundation.

The long-term architecture is moment-first:

```text
Transcript
  ↓
EventExtractor
  ↓
MomentGraph
  ↓
MomentBuilder       ← P2
  ↓
MomentRanker
  ↓
AwardComposer
```

Until P2/P3 land, `analyzeSession(messages)` continues to expose the familiar awards result so the current prototype and regression suite remain usable.

## What changed in P0/P1

`SessionAnalyzer` now builds one shared `MomentGraph` for the session and consumes that graph rather than independently rediscovering relationships for each paired award.

In particular:

- 📢 catchphrase counts come from graph repetition clusters;
- 🤡 boomerang comes from the strongest `contradicts` relation;
- 🍾 premature celebration comes from the strongest `celebrates_before` relation;
- cluster-aware repetition counts feed the current compatibility facets;
- the graph is built from assistant-visible `Event` objects produced by the shared EventExtractor.

The existing public awards API is therefore preserved while P0/P1 semantics live below it.

## Current compatibility awards

The current analyzer can still produce:

- 🏆 **Quote of the session**;
- 📢 **Catchphrase**;
- 🐺 **Called it too early**;
- 🤡 **Biggest boomerang**;
- 🍾 **Premature celebration**;
- 🧠 **Plot twist**;
- 😱 **Emotional peak**;
- 📈 **Progress announcement**;
- 🎉 **Victory lap**.

These are not the target P2 data model. They are a stable bridge while `MomentBuilder` is introduced.

## Relationship examples

### Repetition / catchphrase

```text
现在问题已经非常明确了。
问题现在已经很清楚了。
这下问题就非常明确了！
```

The graph connects these with `similar_to` / `repeats`, and connected components provide the catchphrase cluster.

### Boomerang

```text
可以完全排除缓存。
        ↓ contradicts
最终根因还是缓存。
```

The award is only a presentation of that graph relation.

### False dawn

```text
这次应该真的没问题了！
        ↓ celebrates_before
等等，不对……
```

Explicit resolution claims receive stronger false-dawn evidence than generic cheers such as `Perfect!`, although both remain valid celebration events.

## Boundaries

The analyzer still contains awards-era ranking/diversity logic for standalone categories such as quote, emotional peak, and victory lap. P2/P3 should replace that logic with `MomentBuilder + MomentRanker` rather than extending it with more award-specific detectors.

Likewise, implicit semantic contradictions may still be missed by the local graph. A future optional semantic layer can improve ambiguous relation recall without changing the Event/Relation/Moment boundary.

## Migration rule

From P0 onward, new behavior should first be classified as one of:

```text
Event
Relation
Moment composition
presentation / Award
```

Do not add a new `SomethingDetector` merely because a new award idea sounds fun.
