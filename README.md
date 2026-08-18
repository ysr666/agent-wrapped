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

The first milestone is small: define what counts as a quote, catchphrase, and boomerang; then test those rules against real transcripts before building integrations.

## Planned adapters

- DeepSeek Harness (DSH)
- Claude Code
- OpenAI Codex
- OpenCode (later)

## Design principles

1. **Local-first by default.** Basic extraction and ranking should work without another LLM call.
2. **Use only exposed transcript data.** Agent Wrapped analyzes visible reasoning / messages made available by the host. It does not attempt to access hidden chain-of-thought.
3. **Original wording matters.** Quotes should preserve the agent’s actual words whenever possible.
4. **Fun before analytics.** Token charts are optional; the memorable moments are the product.
5. **Cross-agent from day one.** Core analysis stays independent from any single agent runtime.

## Status

🚧 Very early prototype. We are currently defining the scoring model and transcript format before implementing host-specific plugins.

## License

MIT
