# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Agent Wrapped product hierarchy

- The default end-of-session surface is a lightweight native floating card.
- The floating card shows exactly one strongest result: either the funniest conclusion or the funniest verbatim Agent line (including a meltdown or profanity when truthfully present).
- `看看本场大赏` opens the complete set of selected conclusions for that session.
- The tabloid/newspaper visual treatment appears only after the user explicitly chooses Share.
- Truth is a gate; entertainment and instant recognition are the product outcome.
