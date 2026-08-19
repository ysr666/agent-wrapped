# Agent Wrapped

Turn long AI coding sessions into a playful highlight reel.

Instead of only counting tokens and tool calls, Agent Wrapped looks for the parts people actually remember:

- 🏆 **Memorable quotes** — dramatic lines such as “Major discovery!!! Our whole approach was wrong!”
- 📢 **Catchphrases** — repeated phrases and verbal habits across a session
- 🤡 **Boomerangs** — confident claims that get reversed later
- 🐺 **Called-it-too-early moments** — repeated declarations that the root cause was found
- 🧠 **Plot twists** — sudden changes of direction, realizations, and self-corrections
- 🍾 **Premature celebrations** — victory laps that get overturned a few messages later
- 📊 **Session / weekly / monthly Wrapped** — later, compare patterns across sessions and agents

## Goal

Agent Wrapped is intentionally entertainment-first. It should feel more like an awards show for your AI sessions than another productivity dashboard.

The architecture is **moment-first, award-second**:

```text
Local session logs
  ↓
Session ingestion         ✅ P5
  ↓
TranscriptMessage[]
  ↓
EventExtractor            ✅ P0
  ↓
MomentGraph               ✅ P1
  ↓
MomentBuilder             ✅ P2
  ↓
MomentRanker              ✅ P3
  ↓
AwardComposer             ✅ P3.5
  ↓
WrappedReport             ✅ P4
  ↓
Real-session evaluation   ✅ P6
  ↓
Local review runner       ✅ P7
  ↓
🎬 Agent Wrapped
```

An award is how a strong moment gets presented; it is not a reason to create another independent language parser.

## Architecture status

- ✅ **P0 — Event model + EventExtractor**: unified multi-label events, topics, claims/stance, verbal families, drama and standalone-quality signals.
- ✅ **P1 — Moment Graph**: `repeats`, `similar_to`, `same_topic`, `contradicts`, `retracts`, `followed_by`, and `celebrates_before` relations.
- ✅ **P2 — MomentBuilder**: composes graph structure into `one_liner`, `repeated_pattern`, `boomerang`, `false_dawn`, `plot_twist`, and `correction_arc` moments.
- ✅ **P3 — MomentRanker**: ranks complete moments with separate `funScore` and `confidence`, plus standalone quality, context payoff, surprise, rarity, readability, and structural strength.
- ✅ **P3.5 — AwardComposer**: protects the three MVP slots (quote, repeated verbal pattern, boomerang), fills remaining slots with strong side moments, deduplicates overlapping structural views, and never forces weak cards just to reach a quota.
- ✅ **P4 — WrappedReport / output layer**: runs P0→P3.5 end to end, returns a compact share-oriented report, renders Markdown/plain text, and exposes lightweight preference hooks.
- ✅ **P5 — Session ingestion**: adds the host-neutral `IngestedSession` boundary and a real DeepSeek Harness adapter for durable `session.jsonl` logs, including local discovery and DSH's default concatenated Zstandard storage.
- ✅ **P6 — Real-session evaluation / calibration**: turns ingested sessions into bounded human-review cases, generates deterministic pairwise comparisons, records keep/drop/skip + fun ratings + missed moments, and aggregates ranking/award calibration metrics.
- ✅ **P7 — Local Evaluation Runner**: adds a resumable local CLI/workspace loop for preparing real DSH sessions, reviewing final cards and blind A/B rankings, checkpointing every answer, protecting labels with review-protocol/locale metadata, and printing calibration/status reports.

## P7 quick start

Build once, then run the local experiment loop:

```bash
npm run build

# 1. Read the newest real DSH sessions and create/update the local review workspace.
node dist/cli.js dsh --latest 30

# 2. Review one session at a time. Re-running resumes unanswered items.
node dist/cli.js review

# Or continue through every incomplete session.
node dist/cli.js review --all

# 3. Inspect progress and calibration.
node dist/cli.js status
node dist/cli.js calibration
```

When installed as a package/bin, the same commands are:

```bash
agent-wrapped dsh --latest 30
agent-wrapped review
agent-wrapped calibration
```

The default P7 workspace is `$AGENT_WRAPPED_HOME/review-workspace.json`, falling back to `~/.agent-wrapped/review-workspace.json`. It stores P6 evaluation cases and human review data, **not copies of the full original DSH transcripts**.

P7 review protocol v2 binds every judgment to both the protocol version and a presentation locale. A new workspace defaults to `zh-CN`; an existing workspace keeps its locale when `dsh` is re-run without `--locale`. To switch intentionally, run for example:

```bash
agent-wrapped dsh --latest 30 --locale en
```

Changing locale, changing the review protocol, or changing a session's evaluation-case fingerprint invalidates incompatible human labels instead of mixing them into one calibration dataset. Legacy v1 workspaces keep their P6 cases but discard old unversioned judgments.

Chinese review keeps original source wording as evidence and adds local semantic hints where the presentation layer can do so reliably. If an English award still lacks enough Chinese coverage, the reviewer can `skip` it; `skip` is not counted as a drop or a fun rating. If either side of a zh-CN A/B task has incomplete language coverage, P7 automatically skips that pair and excludes it from pairwise accuracy rather than measuring English-reading friction.

Pairwise review remains blind to `funScore`, confidence, predicted winner, and selected/rejected status. Award review still shows the award category because the question there is whether that final card belongs in the Wrapped.

See `docs/p7-local-review-runner.md` for the review protocol and storage behavior.

## Public APIs

For analysis-only use:

```ts
const moments = analyzeMoments(messages);
```

For a complete Wrapped from normalized messages:

```ts
const report = createWrappedReport(messages, {
  awards: { maxAwards: 5 },
});

console.log(renderWrappedText(report));
```

For current DeepSeek Harness local sessions:

```ts
const sessions = await loadDshSessions({ maxSessions: 20 });
const report = createWrappedReport(sessions[0].messages);
```

DSH discovery follows the harness convention: `$DSH_HOME/sessions` when `DSH_HOME` is set, otherwise `~/.dsh/sessions`. It understands plaintext `session.jsonl` and the current default `session.jsonl.zstd` layout.

Reasoning blocks are **not included by default**. `includeVisibleReasoning: true` is an explicit caller choice for hosts/surfaces where that reasoning was actually exposed to the user.

For P6/P7 calibration APIs:

```ts
const refreshed = await refreshLocalDshReviewWorkspace({
  ingest: { maxSessions: 50 },
  evaluation: { topMoments: 8, maxPairwiseTasks: 12 },
  reviewLocale: "zh-CN",
});

const calibration = calibrateReviewWorkspace(refreshed.workspace);
```

Existing QuoteScorer, CatchphraseClusterer, BoomerangDetector, FacetScorer, and SessionAnalyzer APIs remain as compatibility surfaces while new work uses the Moment Engine pipeline.

See `docs/moment-engine-architecture.md` for architecture and phase boundaries.

## Host coverage

- ✅ DeepSeek Harness (DSH) — current durable JSONL/Zstandard session format
- ⏭️ Claude Code — next adapter
- ⏭️ OpenAI Codex — next adapter
- ⏭️ OpenCode — later

The ingestion boundary is host-neutral; adding another adapter must end in the same `TranscriptMessage[]` model instead of changing P0–P7 semantics.

## Design principles

1. **Local-first by default.** P0–P7 work without another LLM call.
2. **Use only exposed transcript data.** Agent Wrapped analyzes visible messages made available by the host. It does not attempt to recover hidden chain-of-thought.
3. **Original wording matters.** Award/report layers preserve the agent’s source wording instead of regenerating “funnier” quotes.
4. **Fun before analytics.** Token charts are optional; the memorable moments are the product.
5. **Cross-agent core.** Core event, relation, moment, award, and evaluation definitions stay independent from any single model/runtime.
6. **Fun score and confidence are different.** A moment can be hilarious while still requiring semantic verification before it is shown as fact.
7. **No award-specific parser sprawl.** New ideas should first be modeled as an Event, Relation, or Moment composition before adding presentation logic.
8. **Do not force a Wrapped.** If nothing clears the quality threshold, the report can legitimately contain zero awards.
9. **Calibrate on people, not synthetic regex wins.** P6/P7 measure pairwise human preference, award keep-rate, and missed moments before a semantic reranker is justified.
10. **Human labels must match both candidates and presentation.** P7 fingerprints evaluation cases and binds reviews to a protocol version + locale; stale or language-incompatible judgments are invalidated or skipped.

## Development

Run the full regression suite:

```bash
npm test
```

Stages can also be checked separately:

```bash
npm run test:event
npm run test:graph
npm run test:moment-builder
npm run test:moment-ranker
npm run test:award-composer
npm run test:wrapped
npm run test:ingest
npm run test:evaluation
npm run test:review
npm run test:p5-p6
npm run test:p7
```

## Status

🚧 Early prototype. P0–P7 are implemented. The next work should be collecting a first real reviewed DSH corpus with the P7 v2 protocol, inspecting the failure distribution, and using that evidence to decide whether the next engineering step is local calibration, another host adapter, or an optional semantic reranker.

## License

MIT
