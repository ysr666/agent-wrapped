# Moment Engine architecture

Agent Wrapped is an **awards show built from session moments**, not a collection of award-specific detectors.

The core rule is:

> Ingest what the host actually exposed. Understand what happened. Connect related events. Assemble complete moments. Rank how entertaining they are. Only then decide which moments deserve cards — and measure those decisions against real human preference.

## Pipeline

```text
Host session artifacts
   ↓
Session ingestion / adapters       ← P5 ✅
   ↓
TranscriptMessage[]
   ↓
EventExtractor                     ← P0 ✅
   ↓
Event[]
   ↓
MomentGraph                        ← P1 ✅
   ├─ repeats / similar_to
   ├─ same_topic
   ├─ contradicts / retracts
   ├─ followed_by
   └─ celebrates_before
   ↓
MomentBuilder                      ← P2 ✅
   ├─ one_liner
   ├─ repeated_pattern
   ├─ boomerang
   ├─ false_dawn
   ├─ plot_twist
   └─ correction_arc
   ↓
MomentRanker                       ← P3 ✅
   ├─ funScore
   ├─ confidence
   ├─ standaloneQuality
   ├─ contextPayoff
   ├─ surprise / rarity
   ├─ readability
   └─ structuralStrength
   ↓
AwardComposer                      ← P3.5 ✅
   ├─ quote / catchphrase / boomerang
   ├─ wolf-cry / premature-celebration
   └─ plot-twist / emotional-peak
   ↓
WrappedReport / Renderer           ← P4 ✅
   ↓
Real-session evaluation            ← P6 ✅
   ├─ keep / drop
   ├─ 1–5 fun rating
   ├─ pairwise preference
   ├─ missed moments
   └─ calibration report
   ↓
🎬 Agent Wrapped
```

P5 is drawn at the top because ingestion happens before P0 at runtime even though it was implemented later. P6 is the feedback loop around the completed local pipeline.

---

## P0 — Event model + EventExtractor ✅

P0 owns the shared description of one assistant-visible transcript unit. A unit may carry multiple event signals instead of being forced into one class.

Current signals include:

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

Events also carry normalized text, topics, structured claims/stance, verbal-family hints, drama, standalone quality, position and extraction confidence.

Language rules belong in the shared event/topic layer, not inside individual awards.

---

## P1 — MomentGraph ✅

P1 connects events without deciding whether anything deserves an award.

Current relations:

```text
repeats
similar_to
same_topic
contradicts
retracts
followed_by
celebrates_before
```

The graph uses bounded recent-event windows and indexes for common repetition/topic paths rather than unrestricted all-pairs comparison.

Examples:

```text
“可以完全排除缓存”
        │ contradicts
        ▼
“最终根因还是缓存”
```

and:

```text
“这次应该真的没问题了”
        │ celebrates_before
        ▼
“等等，不对……”
```

---

## P2 — MomentBuilder ✅

P2 turns events and relations into complete **stories**:

```text
one_liner
repeated_pattern
boomerang
false_dawn
plot_twist
correction_arc
```

A `Moment` has no emoji or award title. It preserves source text, event/relation evidence, message positions, topic metadata and repetition variants when relevant.

P2 intentionally allows overlapping candidates. The same reversal can be a one-liner, a plot twist, part of a correction arc and one side of a boomerang. Later stages decide which presentation survives.

---

## P3 — MomentRanker ✅

P3 ranks complete moments. It exposes separate dimensions rather than hiding everything inside one score:

```text
funScore
confidence
standaloneQuality
contextPayoff
surprise
rarity
readability
structuralStrength
```

`funScore` and `confidence` are deliberately independent. A moment can be highly entertaining but semantically uncertain:

```text
funScore = 94
confidence = 57
```

That candidate can remain available for later semantic verification instead of being silently treated as “not funny.”

`analyzeMoments(messages)` is the P0→P3 analysis-only API.

---

## P3.5 — AwardComposer ✅

P3.5 turns ranked moments into a small, diverse user-facing award set. It never reparses raw transcript language.

Current award kinds:

```text
🏆 quote
📢 catchphrase
🤡 boomerang
🐺 wolf-cry
🍾 premature-celebration
🧠 plot-twist
💀 emotional-peak
```

Selection policy:

- protect the strongest quote, repeated verbal pattern and boomerang when they clear quality thresholds;
- fill remaining slots with strong side moments;
- default to at most five cards, hard cap seven;
- deduplicate identical/strongly overlapping structural views;
- never force weak filler merely to reach a card count;
- preserve original transcript wording.

---

## P4 — WrappedReport / output ✅

P4 is the product-facing local result.

```ts
createWrappedReport(messages)
renderWrappedMarkdown(report)
renderWrappedText(report)
```

`WrappedReport` carries final awards, compact metrics and diagnostics. P3 ranked candidates are excluded from the share payload by default and are opt-in for debugging/evaluation.

P4 also keeps a lightweight per-award preference helper, while the full real-session evaluation workflow lives in P6.

---

## P5 — Session ingestion / host adapters ✅

P5 establishes a host-neutral `IngestedSession` boundary:

```text
host artifact
   ↓ adapter
IngestedSession
   ├─ id / host / title / time
   ├─ provider / model / cwd
   ├─ source + diagnostics
   └─ TranscriptMessage[]
```

### DeepSeek Harness adapter

The first production adapter follows the current DSH durable session format.

DSH stores sessions beneath:

```text
$DSH_HOME/sessions
```

or, when `DSH_HOME` is unset:

```text
~/.dsh/sessions
```

The adapter supports:

- logical/exported `session.jsonl`;
- the current default physical `session.jsonl.zstd` concatenated-frame format;
- newest-first local discovery;
- session title, cwd and assistant provider/model provenance;
- user `text` blocks and durable `assistant/message` text blocks;
- malformed/truncated-artifact diagnostics.

It intentionally consumes the final durable `assistant/message` rather than streaming `assistant/chunk` rows, preventing the same answer from being counted twice.

### Reasoning privacy boundary

A reasoning block being present in a durable artifact does **not** automatically mean it was user-visible. Therefore DSH reasoning is excluded by default.

`includeVisibleReasoning: true` is an explicit caller policy for a surface where that reasoning was actually shown to the user. Agent Wrapped does not claim access to hidden chain-of-thought.

### Compression/runtime boundary

Direct reads of DSH's Zstandard artifacts use the runtime's `node:zlib` Zstandard API. Current DSH itself targets Node 22.19+ / 24+, so CI exercises the adapter on Node 22. Exported plaintext `session.jsonl` remains a portable ingestion path.

### Cross-host boundary

P5 is structurally complete but host coverage is incremental:

```text
DSH          ✅
Claude Code  next
Codex        next
OpenCode     later
```

Every future adapter must end at `TranscriptMessage[]`; it must not change P0–P6 semantics.

---

## P6 — Real-session evaluation & calibration ✅

P6 exists to stop the project from optimizing synthetic phrases against its own rules.

For each `IngestedSession`, P6 can create a deterministic, privacy-conscious `SessionEvaluationCase` containing only the Moment material needed for review rather than copying the entire transcript.

The case keeps:

- the top P3 moment candidates;
- **every P3.5-selected award**, even when a protected core award falls outside the raw top-N;
- bounded pairwise comparison tasks;
- model/session metadata needed for slicing results.

Pairwise tasks cover two useful failure modes:

1. adjacent P3 candidates — “did the ranker order these correctly?”;
2. selected vs strong rejected candidates — “did AwardComposer choose the right card?”

Human review supports:

```text
award keep / drop
optional 1–5 fun rating
pairwise left / right / tie / skip
human-supplied missed moments
```

`buildCalibrationReport()` aggregates:

```text
review coverage
award keep-rate
average award fun rating
pairwise ranking accuracy
missed-moment count
per-award-kind keep/fun metrics
```

The API measures the current engine; it does not automatically mutate thresholds or train a model. That separation keeps calibration evidence inspectable.

For local DSH data, `prepareLocalDshEvaluation()` connects P5 and P6 directly:

```text
~/.dsh/sessions
   ↓
loadDshSessions()
   ↓
P0 → P4
   ↓
buildEvaluationDataset()
   ↓
human review
   ↓
buildCalibrationReport()
```

---

## Legacy compatibility

The earlier QuoteScorer, FacetScorer, CatchphraseClusterer, BoomerangDetector and SessionAnalyzer APIs remain compatibility surfaces. New product work should follow:

```text
Adapter
→ TranscriptMessage
→ Event
→ Relation
→ Moment
→ RankedMoment
→ Award
→ WrappedReport
→ Evaluation
```

No new `SomethingDetector` should be introduced unless the concept truly cannot be represented inside those layers.

---

## Test boundaries

```text
test:event           → P0
test:graph           → P1
test:moment-builder  → P2
test:moment-ranker   → P3
test:award-composer  → P3.5
test:wrapped         → P4
test:ingest          → P5 DSH parsing/discovery/Zstandard
test:evaluation      → P6 preference/calibration
test:p5-p6           → P5 + P6 focused regression
```

P5 tests include real concatenated Zstandard frames generated through Node's Zstandard API so compressed-session support is exercised rather than mocked.

P6 tests cover bounded case generation, latest-vote semantics, unknown task IDs, pairwise accuracy, award keep/fun aggregation, missed moments, and retention of P3.5 awards outside raw P3 top-N.

---

## Boundary after P6

P0–P6 now provide the complete local measurement loop:

```text
real host session
→ ingest
→ understand
→ compose
→ rank
→ present
→ ask humans whether it was actually good
```

Still intentionally outside the current implementation:

```text
Claude Code / Codex / OpenCode adapters
large real human-reviewed corpus
optional embedding / LLM semantic rerank
CLI / plugin product entry
web / share-card visual UI
weekly / monthly / yearly aggregation
cross-agent leaderboards
```

The next major decision should be driven by P6 evidence. If real-session reviews show semantic misses that local rules cannot fix cleanly, an optional semantic reranker is justified. If the dominant failures are ingestion or rule calibration, adding an LLM would only hide the wrong problem.
