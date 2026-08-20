# Agent Wrapped

Turn long AI coding sessions into a playful highlight reel.

Instead of only counting tokens and tool calls, Agent Wrapped looks for the parts people actually remember:

- 🏆 **Memorable quotes** — dramatic lines such as “Major discovery!!! Our whole approach was wrong!”
- 📢 **Catchphrases** — repeated phrases and verbal habits across a session
- 🤡 **Boomerangs** — confident claims that get reversed later
- 🐺 **Called-it-too-early moments** — repeated declarations that the root cause was found
- 🧠 **Plot twists** — sudden changes of direction, realizations, and self-corrections
- 🍾 **Premature celebrations** — victory laps that get overturned a few messages later
- 🎬 **Story + session persona (experimental)** — a grounded candidate route for multi-step plots and a session-scoped character read; neither card is mandatory
- 📊 **Session / weekly / monthly Wrapped** — later, compare patterns across sessions and agents

## Goal

Agent Wrapped is intentionally entertainment-first. It should feel more like an awards show for your AI sessions than another productivity dashboard.

P0–P7 remain the local quote/moment pipeline. Experimental P8 adds a second, event-first story route so a hilarious tool sequence can be discovered even when no individual assistant sentence was ranked as a Moment:

```text
Host session logs
  ↓
Session ingestion
  ↓
Observable SessionEvent[] ───────────────────────────────┐
  │                                                     │
  ├─ text route                                         ├─ story route
  │   ↓                                                 │   ↓
  │ TranscriptMessage[]                                 │ bounded story windows
  │   ↓                                                 │   ↓
  │ P0 EventExtractor                                   │ redact secrets / identity
  │   ↓                                                 │   ↓
  │ P1 MomentGraph                                      │ LLM-A: Story Miner
  │   ↓                                                 │ structure only
  │ P2 MomentBuilder                                    │   ↓
  │   ↓                                                 │ local grounding / validation
  │ P3 MomentRanker                                     │   ↓
  │   ↓                                                 │ verified Story candidates
  │ P3.5 AwardComposer                                  │   ↓
  │   ↓                                                 │ local Wrapped admission
  │ P4 WrappedReport                                    │   ↓
  │                                                     │ deterministic Persona Aggregator
  │                                                     │ LLM-B: Narrator
  │                                                     │ editorial language only
  └────────────────────────→ Entertainment Candidate Pool ←┘
                                  ↓
                     Wrapped Composer (next product layer)
                                  ↓
                  best 3–5 optional cards, never a replay
```

A P3 Moment can help P8 choose context, but it is only a **secondary hint**. It is no longer the gate that decides what the story model is allowed to see.

## Architecture status

- ✅ **P0 — Event model + EventExtractor**: unified multi-label text events, topics, claims/stance, verbal families, drama and standalone-quality signals.
- ✅ **P1 — Moment Graph**: `repeats`, `similar_to`, `same_topic`, `contradicts`, `retracts`, `followed_by`, and `celebrates_before` relations.
- ✅ **P2 — MomentBuilder**: composes graph structure into `one_liner`, `repeated_pattern`, `boomerang`, `false_dawn`, `plot_twist`, and `correction_arc` moments.
- ✅ **P3 — MomentRanker**: ranks complete moments with separate `funScore` and `confidence`, plus standalone quality, context payoff, surprise, rarity, readability, and structural strength.
- ✅ **P3.5 — AwardComposer**: lets grounded Moments compete on entertainment value, deduplicates overlapping visible evidence across card kinds, filters formatting/code/worklog repetition from catchphrase cards, and does not force weak cards.
- ✅ **P4 — WrappedReport / output**: runs P0→P3.5 end to end and preserves original source wording.
- ✅ **P5 — Session ingestion**: host-neutral `IngestedSession`; current DeepSeek Harness JSONL/Zstandard support. DSH now also recovers observable `tool/call`, `tool/result`, and `turn/end` records into a host-neutral `SessionEvent[]` stream.
- ✅ **P6 — Real-session evaluation / calibration**: bounded human-review cases, deterministic A/B comparisons, keep/drop/skip, fun ratings and missed moments.
- ✅ **P7 — Local Evaluation Runner**: resumable workspace/CLI with review-protocol + locale isolation and language-bias safeguards.
- 🧪 **P8 — Story + session persona**: opt-in, event-first semantic candidate route. Story Miner proposes structure, local code validates truth and then admits only distinctive human-visible turns; routine tool worklogs produce no Story or Persona card. A second narrator may only write editorial titles/commentary/nicknames for admitted candidates.

## P7 quick start

```bash
npm run build

# Prepare newest real DSH sessions.
node dist/cli.js dsh --latest 30

# Review one session at a time, or use --all.
node dist/cli.js review
node dist/cli.js review --all

# Inspect progress/calibration.
node dist/cli.js status
node dist/cli.js calibration
```

When installed as a package/bin:

```bash
agent-wrapped dsh --latest 30
agent-wrapped review
agent-wrapped calibration
```

The default workspace is `$AGENT_WRAPPED_HOME/review-workspace.json`, falling back to `~/.agent-wrapped/review-workspace.json`. It stores evaluation cases and human review data, not copies of full DSH transcripts.

P7 protocol v2 binds judgments to both the review protocol and presentation locale. Changing the candidate set, protocol, or locale invalidates incompatible labels rather than mixing them. In `zh-CN`, an incompletely localized English A/B pair is automatically skipped instead of measuring English-reading friction.

See `docs/p7-local-review-runner.md` for the review protocol and storage behavior.

## Experimental P8: story + session persona

P8 accepts that “剧情 + 人格” is genuinely semantic, but it does not hand the entire transcript to an LLM and hope for a funny summary. It is an Entertainment Candidate Pool input, not a required Session Replay card.

### 1. Observable event stream first

Host adapters normalize what actually happened into `SessionEvent[]`:

```text
user_message
assistant_text
tool_call
tool_result / tool_error
turn_end
```

For DSH, `tool/call`, `tool/result`, and `turn/end` are now read from the durable session log. This lets P8 see stories such as:

```text
attempt delete
→ permission error
→ switch to another tool
→ success
```

That story can be discovered even if P0–P3 found no funny assistant quote.

### 2. Bounded story windows, not the full transcript

Local code selects a small set of event windows around structural signals such as tool failures, user pushback, assistant corrections and turn failures. A small number of coverage windows is also sampled so Story Discovery is not entirely gated by hand-written cues.

P3 Moments are included only as secondary attention hints.

Before a remote semantic call, common secrets and identity-bearing text are redacted, including bearer tokens, common API-key/token forms, email addresses and home-directory usernames. Evidence is also capped by event count, per-event characters and total characters.

### 3. LLM-A: Story Miner outputs structure only

The first semantic pass may propose only a controlled structure such as:

```json
{
  "arcKind": "failure_then_workaround",
  "beats": [
    { "kind": "attempt", "evidenceIds": ["event:..."] },
    { "kind": "failure", "evidenceIds": ["event:..."] },
    { "kind": "workaround", "evidenceIds": ["event:..."] }
  ],
  "confidence": "high"
}
```

It is not allowed to write the story title, comedy copy, persona, or 0–100 scores.

### 4. Local grounding validates more than “the ID exists”

Before any generated story can reach presentation, local code verifies:

- every cited event exists;
- beats are in chronological order;
- the cited actor/event type can support that beat (`user_pushback` must cite a user event, failure must cite a failure-like event, etc.);
- the requested arc shape is actually present, for example failure before workaround.

Candidates that fail these checks are dropped instead of being narrated.

### 5. A true tool sequence still has to earn a card

Passing structural grounding only means a sequence happened. A bare `tool failure → another tool action` is often useful local evidence but ordinary worklog, not a reason to show a story or invent a personality. Before narration, P8 admits a Story only when the same verified episode contains a human-visible turn (claim, correction/reversal, user pushback, capability gap, or breakdown) or overlaps a grounded P3 dramatic Moment. Otherwise it emits no P8 card and makes no narration call.

### 6. Persona is aggregated locally

Persona does not come from an LLM inventing “内心戏 82/100”. Agent Wrapped derives coarse observed signals from verified stories + grounded Moments, for example:

```text
内心戏        high · 3
自我纠错      medium · 2
执着程度      high · 4
临场变通      low · 1
```

The exact thresholds are local and reproducible. These are **session behavior signals**, not claims that a model has an inherent personality.

### 7. LLM-B: Narrator does editorial language only

After structure and persona signals are fixed, the second optional pass may write only:

- a title for each verified story;
- clearly labeled `赛后解说` editorial commentary;
- a session-scoped persona nickname/tagline such as `本场表现像……`.

It cannot add another tool result, user reaction, accident or source quote. Story facts stay in the verified structure.

### Try the newest DSH session

No endpoint is assumed. Configure any OpenAI-compatible endpoint explicitly:

```bash
export AGENT_WRAPPED_LLM_BASE_URL="https://your-endpoint.example/v1"
export AGENT_WRAPPED_LLM_MODEL="your-model"
export AGENT_WRAPPED_LLM_API_KEY="..."   # optional for local endpoints

npm run story:latest
```

Optional knobs:

```bash
export AGENT_WRAPPED_LOCALE=zh-CN
export AGENT_WRAPPED_TOP_MOMENTS=6
export AGENT_WRAPPED_LLM_JSON_MODE=1
# Only when the host actually exposed reasoning to the user:
export AGENT_WRAPPED_INCLUDE_REASONING=1
```

`story:latest` prints the number of bounded events/windows, secondary Moment hints, redaction count and truncation state before semantic generation. A normal P8 run may make **two** semantic calls: Story Miner, then Narrator only after local validation and local Wrapped admission. The full DSH transcript is not included in either request.

P8 is still experimental and is not part of P7 calibration yet. P4 awards and P8 candidates do not yet compete in one cross-route final composer; that is deliberately deferred until real-session calibration shows the candidate pool is both truthful and worth showing.

## Public APIs

Analysis-only Moment Engine:

```ts
const moments = analyzeMoments(messages);
```

Complete local Wrapped:

```ts
const report = createWrappedReport(messages, {
  awards: { maxAwards: 5 },
});

console.log(renderWrappedText(report));
```

Current DeepSeek Harness local sessions:

```ts
const sessions = await loadDshSessions({ maxSessions: 20 });
const report = createWrappedReport(sessions[0].messages);
```

P6/P7 calibration:

```ts
const refreshed = await refreshLocalDshReviewWorkspace({
  ingest: { maxSessions: 50 },
  evaluation: { topMoments: 8, maxPairwiseTasks: 12 },
  reviewLocale: "zh-CN",
});

const calibration = calibrateReviewWorkspace(refreshed.workspace);
```

For a frozen local calibration subset, pass SHA-256 prefixes of session IDs. The
selector is local-only; the review workspace stores the prefixes, not original
session artifacts:

```bash
agent-wrapped dsh --latest 200 \
  --session-hashes 0123456789ab,abcdef012345 \
  --pairs 3 \
  --store ~/.agent-wrapped/review-calibration.json
```

P8 v2:

```ts
const { narrator } = createOpenAICompatibleNarratorFromEnv();
const { report, evidence } = await generateSemanticStoryPersona(
  session,
  narrator,
  { topMoments: 6 },
);

console.log(renderSemanticStoryPersonaText(report, evidence));
```

Existing QuoteScorer, CatchphraseClusterer, BoomerangDetector, FacetScorer, and SessionAnalyzer APIs remain compatibility surfaces while new work uses the Moment Engine.

## Host coverage

- ✅ DeepSeek Harness — current durable JSONL/Zstandard format, including tool calls/results and turn outcomes
- ⏭️ Claude Code — next adapter
- ⏭️ OpenAI Codex — next adapter
- ⏭️ OpenCode — later

The host-neutral boundaries are now both `TranscriptMessage[]` for the local text/Moment route and `SessionEvent[]` for observable story behavior. A new host adapter should normalize into those shared contracts instead of leaking host-specific event semantics into P8.

## Design principles

1. **Local-first by default.** P0–P7 work without another LLM call. P8 is explicit opt-in and has no default network endpoint.
2. **Use only exposed / observable session data.** Agent Wrapped does not attempt to recover hidden chain-of-thought.
3. **Original wording matters.** Source quotes stay source quotes; editorial narration is visibly labeled as narration.
4. **Fun before analytics.** Token charts are optional; memorable moments are the product.
5. **Cross-agent core.** Core event, moment, story and evaluation concepts stay independent from any single runtime.
6. **Fun score and confidence are different.** Entertainment value never substitutes for factual confidence.
7. **No parser sprawl.** New ideas should first fit Event → Relation → Moment/Story → Presentation rather than becoming another one-off detector.
8. **Do not force a Wrapped.** Weak or ungrounded material may legitimately produce no card/story.
9. **Calibrate on people.** P6/P7 remain the source of truth for whether local Moments are useful; P8 needs its own real-session evaluation before becoming default.
10. **Labels must match candidates and presentation.** P7 protocol/locale isolation remains intact.
11. **Story Discovery is not P3-gated.** P3 Moments may hint, but observable event windows get independent coverage.
12. **LLMs interpret structure and write copy; local code owns evidence boundaries and card admission.** Story Miner output is validated and then selectively admitted before Narrator sees it.
13. **No fake persona precision.** Persona magnitude is deterministic and coarse, never an LLM-generated 0–100 number.
14. **Remote evidence is bounded and redacted.** Full transcripts stay local unless a future explicit mode says otherwise.

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
npm run test:p8
```

## Status

🚧 Early prototype. P0–P7 are implemented. P8 is an opt-in candidate route. The next evidence should come from side-by-side real-session review: does event-first Story Discovery recover the “剧情 + 人格” people actually enjoy, and is the added value worth its cost/latency/privacy tradeoff? If yes, the next engineering work is an explicit P8 human evaluation and then a cross-route Wrapped Composer — not more award-specific regex detectors.

## License

MIT
