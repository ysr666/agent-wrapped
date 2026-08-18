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

The core is **moment-first, award-second**:

```text
Transcript
  ↓
EventExtractor       ✅ P0
  ↓
MomentGraph          ✅ P1
  ↓
MomentBuilder        ✅ P2
  ↓
MomentRanker         ✅ P3
  ↓
AwardComposer        ✅ P3.5
  ↓
WrappedReport        ✅ P4
  ├─ Markdown
  ├─ plain text
  └─ preference hooks
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
- ✅ **P4 — WrappedReport / output layer**: runs P0→P3.5 end to end, returns a compact share-oriented report, renders Markdown/plain text, and exposes a lightweight human-preference feedback format for real-session evaluation.

## Public APIs

For analysis-only use:

```ts
const moments = analyzeMoments(messages);
```

For the complete product path:

```ts
const report = createWrappedReport(messages, {
  awards: { maxAwards: 5 },
});

console.log(renderWrappedText(report));
// or
console.log(renderWrappedMarkdown(report));
```

`createWrappedReport()` keeps P3 ranked candidates out of the share payload by default. Set `includeRankedMoments: true` only for debugging/evaluation.

Existing QuoteScorer, CatchphraseClusterer, BoomerangDetector, FacetScorer, and SessionAnalyzer APIs remain as compatibility surfaces while new work uses the Moment Engine pipeline.

See `docs/moment-engine-architecture.md` for architecture and phase boundaries.

## Planned adapters

- DeepSeek Harness (DSH)
- Claude Code
- OpenAI Codex
- OpenCode (later)

## Design principles

1. **Local-first by default.** P0–P4 work without another LLM call.
2. **Use only exposed transcript data.** Agent Wrapped analyzes visible messages made available by the host. It does not attempt to access hidden chain-of-thought.
3. **Original wording matters.** P3.5/P4 preserve the agent’s source wording instead of regenerating “funnier” quotes.
4. **Fun before analytics.** Token charts are optional; the memorable moments are the product.
5. **Cross-agent from day one.** Core event, relation, moment, and award definitions stay independent from any single model or runtime.
6. **Fun score and confidence are different.** A moment can be hilarious while still requiring semantic verification before it is shown as fact.
7. **No award-specific parser sprawl.** New ideas should first be modeled as an Event, Relation, or Moment composition before adding presentation logic.
8. **Do not force a Wrapped.** If nothing clears the quality threshold, P4 can legitimately return zero awards.

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
npm run test:moments
```

## Status

🚧 Early prototype. P0–P4 are now implemented locally. The next product work is real DSH/Claude Code/Codex transcript adapters plus a larger human-preference corpus to calibrate selection quality without overfitting to synthetic phrases.

## License

MIT
