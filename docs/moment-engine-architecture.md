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
Local evaluation runner            ← P7 ✅
   ├─ durable local review workspace
   ├─ resumable interactive review
   ├─ blind A/B decisions
   ├─ progress/status
   └─ calibration CLI
   ↓
🎬 Agent Wrapped
```

P5 is drawn at the top because ingestion happens before P0 at runtime even though it was implemented later. P6/P7 form the feedback loop around the completed local pipeline.

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

DSH stores sessions beneath `$DSH_HOME/sessions`, or `~/.dsh/sessions` when `DSH_HOME` is unset.

The adapter supports:

- logical/exported `session.jsonl`;
- the current default physical `session.jsonl.zstd` concatenated-frame format;
- newest-first local discovery;
- session title, cwd and assistant provider/model provenance;
- user `text` blocks and durable `assistant/message` text blocks;
- malformed/truncated-artifact diagnostics.

It intentionally consumes the final durable `assistant/message` rather than streaming `assistant/chunk` rows, preventing the same answer from being counted twice.

A reasoning block being present in a durable artifact does **not** automatically mean it was user-visible. Therefore DSH reasoning is excluded by default. `includeVisibleReasoning: true` is an explicit caller policy for a surface where that reasoning was actually shown to the user.

Direct reads of DSH's Zstandard artifacts use the runtime's `node:zlib` Zstandard API. Agent Wrapped now targets Node 22.19+ so the primary DSH/P7 path can read current compressed artifacts directly.

Every future adapter must still end at `TranscriptMessage[]`; it must not change P0–P7 semantics.

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

Human review supports award keep/drop, optional 1–5 fun rating, pairwise left/right/tie/skip, and human-supplied missed moments.

`buildCalibrationReport()` aggregates review coverage, award keep-rate, average fun rating, pairwise ranking accuracy, missed-moment count, and per-award-kind metrics.

The API measures the current engine; it does not automatically mutate thresholds or train a model. That separation keeps calibration evidence inspectable.

---

## P7 — Local Evaluation Runner ✅

P7 turns P5/P6 from library APIs into a real repeatable experiment loop.

The primary commands are:

```bash
agent-wrapped dsh --latest 30
agent-wrapped review
agent-wrapped status
agent-wrapped calibration
```

When developing directly from the repository, the same entry point is `node dist/cli.js ...` after `npm run build`.

### Durable review workspace

Default storage:

```text
$AGENT_WRAPPED_HOME/review-workspace.json
```

with fallback:

```text
~/.agent-wrapped/review-workspace.json
```

The workspace stores `SessionEvaluationCase[]`, human `SessionHumanReview[]`, completion state, and deterministic case fingerprints. It does **not** store a second copy of the source DSH transcripts.

Writes checkpoint after every accepted answer using a temporary JSON file plus rename. Quitting midway leaves a resumable partial review rather than losing the whole session.

### Refresh safety

Running `agent-wrapped dsh` again rebuilds current P6 cases. Existing human reviews are preserved only when the case fingerprint is unchanged.

If P0–P3.5 changes produce a different moment/task set for a session, the old review is invalidated. This prevents stale labels from silently contaminating calibration.

### Interactive review

Award review shows the actual selected card type and source wording, then asks:

```text
keep / drop
optional 1–5 fun score
```

Pairwise review is intentionally blind to the algorithm's current opinion. The prompt does not expose `funScore`, confidence, predicted winner, or selected/rejected status while asking which candidate deserves the Wrapped slot.

At the end of a session, the reviewer can manually record missed moments. These are the key signal for separating recall failures from ranking/selection failures.

### Resume semantics

Already-answered awards and pairwise tasks are skipped on the next run. A session is marked complete only after the award, pairwise, and missed-moment steps finish.

`review --all` can continue through every incomplete case; `review --session <id>` targets one session.

### Status and calibration

`agent-wrapped status` reports review progress. `agent-wrapped calibration` runs the existing P6 `buildCalibrationReport()` over the persisted workspace and exposes both human-readable and `--json` output.

P7 intentionally does not auto-tune weights. Its job is to make collecting trustworthy evidence cheap enough that the next algorithmic decision can be data-driven.

See `docs/p7-local-review-runner.md` for the operational protocol.

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
→ Local Review
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
test:review          → P7 workspace/review/CLI
test:p5-p6           → P5 + P6 focused regression
test:p7              → P7 focused regression
```

P7 tests cover fingerprint-safe refresh, partial checkpoint/resume, atomic workspace persistence, completed-session progress, calibration against persisted votes, CLI review/status/calibration, and invalid argument handling.

---

## Boundary after P7

P0–P7 now provide the complete local **measurement workflow**:

```text
real host session
→ ingest
→ understand
→ compose
→ rank
→ present
→ collect blind/explicit human judgments
→ persist and resume review
→ measure the failure distribution
```

Still intentionally outside the current implementation:

```text
Claude Code / Codex / OpenCode adapters
first substantial human-reviewed real corpus
optional embedding / LLM semantic rerank
polished plugin/end-user UI
web / share-card visual UI
weekly / monthly / yearly aggregation
cross-agent leaderboards
```

The immediate next action is not another detector. It is to run P7 over a meaningful DSH corpus and inspect where the failures actually concentrate. If reviews show semantic misses that local rules cannot fix cleanly, an optional semantic reranker becomes justified. If the failures mostly come from thresholds, ingestion, composition, or award diversity, those layers should be corrected directly.
