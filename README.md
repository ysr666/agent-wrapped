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

The core is now **moment-first, award-second**:

```text
Transcript
  ↓
EventExtractor
  ↓
MomentGraph
  ↓
MomentBuilder
  ↓
MomentRanker
  ↓
AwardComposer
  ↓
🎬 Agent Wrapped
```

An award is how a strong moment gets presented; it is not a reason to create another independent language parser.

## Architecture status

- ✅ **P0 — Event model + EventExtractor**: unified multi-label events, topics, claims/stance, verbal families, drama and standalone-quality signals.
- ✅ **P1 — Moment Graph**: `repeats`, `similar_to`, `same_topic`, `contradicts`, `retracts`, `followed_by`, and `celebrates_before` relations.
- ⏭️ **P2 — MomentBuilder**: compose graph patterns into `one_liner`, `repeated_pattern`, `boomerang`, `false_dawn`, `plot_twist`, and `correction_arc` moments.

Existing QuoteScorer, CatchphraseClusterer, BoomerangDetector, and SessionAnalyzer APIs remain as compatibility surfaces while their semantics migrate underneath the Moment Engine.

See `docs/moment-engine-architecture.md` for the architecture and phase boundaries.

## Planned adapters

- DeepSeek Harness (DSH)
- Claude Code
- OpenAI Codex
- OpenCode (later)

## Design principles

1. **Local-first by default.** Basic extraction and graph building should work without another LLM call.
2. **Use only exposed transcript data.** Agent Wrapped analyzes visible messages made available by the host. It does not attempt to access hidden chain-of-thought.
3. **Original wording matters.** Quotes and paired moments should preserve the agent’s actual words whenever possible.
4. **Fun before analytics.** Token charts are optional; the memorable moments are the product.
5. **Cross-agent from day one.** Core event and relation definitions stay independent from any single model or runtime.
6. **Fun score and confidence are different.** A moment can look hilarious while still requiring semantic verification before it is shown as fact.

## Status

🚧 Early prototype. The P0/P1 Moment Engine foundation is in place; the next major step is P2 MomentBuilder plus real-session preference evaluation.

## License

MIT
