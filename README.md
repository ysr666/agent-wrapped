# Agent Wrapped

Turn long AI coding sessions into a playful highlight reel.

Instead of only counting tokens and tool calls, Agent Wrapped looks for the parts people actually remember:

- 🏆 **Memorable quotes** — dramatic lines such as “Major discovery!!! Our whole approach was wrong!”
- 📢 **Catchphrases** — repeated phrases and verbal habits across a session
- 🤡 **Boomerangs** — confident claims that get reversed later
- 🐺 **Called-it-too-early moments** — how many times the agent announced that the root cause was found
- 🧠 **Plot twists** — sudden changes of direction, realizations, and self-corrections
- 📊 **Session / weekly / monthly Wrapped** — compare patterns across sessions and agents

## Goal

Agent Wrapped is intentionally entertainment-first. It should feel more like an awards show for your AI sessions than another productivity dashboard.

The core is **moment-first, award-second**:

```text
Transcript
  ↓
EventExtractor      ✅ P0
  ↓
MomentGraph         ✅ P1
  ↓
MomentBuilder       ✅ P2
  ↓
MomentRanker        ✅ P3
  ↓
AwardComposer       ⏭️ P3.5
  ↓
🎬 Agent Wrapped
```

An award is how a strong moment gets presented; it is not a reason to create another independent language parser.

## Architecture status

- ✅ **P0 — Event model + EventExtractor**: unified multi-label events, topics, claims/stance, verbal families, drama and standalone-quality signals.
- ✅ **P1 — Moment Graph**: `repeats`, `similar_to`, `same_topic`, `contradicts`, `retracts`, `followed_by`, and `celebrates_before` relations.
- ✅ **P2 — MomentBuilder**: composes graph structure into `one_liner`, `repeated_pattern`, `boomerang`, `false_dawn`, `plot_twist`, and `correction_arc` moments.
- ✅ **P3 — MomentRanker**: ranks complete moments with separate `funScore` and `confidence`, plus standalone quality, context payoff, surprise, rarity, readability, and structural strength.
- ⏭️ **P3.5 — AwardComposer**: select a diverse 4–7 moment final set and turn it into the playful Wrapped cards users actually see.

The new high-level API `analyzeMoments(messages)` currently runs P0→P3 and returns ranked moments. Existing QuoteScorer, CatchphraseClusterer, BoomerangDetector, and SessionAnalyzer APIs remain as compatibility surfaces while the presentation layer migrates.

See `docs/moment-engine-architecture.md` for the architecture and phase boundaries.

## Planned adapters

- DeepSeek Harness (DSH)
- Claude Code
- OpenAI Codex
- OpenCode (later)

## Design principles

1. **Local-first by default.** Basic extraction, graph construction, moment composition, and ranking should work without another LLM call.
2. **Use only exposed transcript data.** Agent Wrapped analyzes visible messages made available by the host. It does not attempt to access hidden chain-of-thought.
3. **Original wording matters.** Quotes and paired/multi-step moments should preserve the agent’s actual words whenever possible.
4. **Fun before analytics.** Token charts are optional; the memorable moments are the product.
5. **Cross-agent from day one.** Core event, relation, and moment definitions stay independent from any single model or runtime.
6. **Fun score and confidence are different.** A moment can be hilarious while still requiring semantic verification before it is shown as fact.
7. **No award-specific parser sprawl.** New ideas should first be modeled as an Event, Relation, or Moment composition before adding presentation logic.

## Development

Run the full regression suite:

```bash
npm test
```

Moment Engine stages can also be checked separately:

```bash
npm run test:event
npm run test:graph
npm run test:moment-builder
npm run test:moment-ranker
npm run test:moments
```

## Status

🚧 Early prototype. P0–P3 of the Moment Engine are in place; the next major step is P3.5 AwardComposer, followed by real-session human preference evaluation.

## License

MIT
