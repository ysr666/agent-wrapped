# Public Research Corpus

This document collects public examples of entertaining or diagnostically useful AI-agent language. It is **not** a model benchmark. The goal is to discover recurring event patterns that Agent Wrapped should detect without overfitting to one model's wording.

## Design rule

Do not score fixed phrases like `I found the issue` directly as "gold quotes". Treat them as evidence for higher-level events such as:

- discovery claim
- self-correction / retraction
- confidence escalation
- contradiction with an earlier claim
- repeated discovery claim ("wolf cried again")
- promise without progress
- apology loop
- dramatic punctuation / emphasis

Phrase dictionaries should only be weak features. The same event can be expressed very differently by Claude, Codex, Gemini, DeepSeek, or a model running under another harness.

## Claude Code

### Repeated confident discoveries

Chris Smith documented a debugging session where Claude Code repeatedly announced variants of `I found the issue!`, `I found the root cause!`, `Now I found the real issue!`, and `I found it!` before eventually reaching the correct explanation. The article even includes a composite image of 11 confident "found it" responses.

Source: https://chameth.com/finding-an-awkward-bug-with-claude-code/

Useful labels:
- `discovery_claim`
- `false_discovery`
- `repeated_discovery`
- `confidence_escalation`
- `wolf_cried`

### "Wait, I see the problem now..." as a community-recognized tell

In a Hacker News discussion about Claude Code, one commenter joked about adding another agent that would stop the first whenever it detected `Wait, I see the problem now...`.

Source: https://news.ycombinator.com/item?id=47660925

Useful labels:
- `catchphrase_candidate`
- `discovery_claim`
- `community_meme_signal`

### Explicit self-correction

A Claude Code issue includes a sequence where Claude first defended a wrong interpretation, then said `You're right to push back — I misspoke`, re-read the spec, and admitted `I was wrong`.

Source: https://github.com/anthropics/claude-code/issues/53653

Useful labels:
- `user_pushback`
- `self_correction`
- `retraction`

### Reversal after checking raw logs

A Fable 5 bug report documents Claude insisting that a fabricated sentence came from the user, then checking the JSONL and retracting its earlier explanation after discovering that it had generated the fake user turn itself.

Source: https://github.com/anthropics/claude-code/issues/75655

Useful labels:
- `strong_reversal`
- `self_correction`
- `evidence_triggered_retraction`
- `plot_twist`

## Codex

### "Exact defect" loop + promise without progress

A Codex issue documents a long auto-compaction loop in which Codex repeatedly said variants of `I found the exact break`, `I'm on the exact defect now`, and promised that the next update would contain the completed result, but then reread the same files and compacted again without finishing the edit.

Source: https://github.com/openai/codex/issues/35226

Useful labels:
- `discovery_claim`
- `repeated_discovery`
- `promise_without_progress`
- `loop`
- `wolf_cried`

### Direct contradiction caused by losing task state

Another Codex issue gives a compact example: Codex says it found the issue, begins fixing it, then later behaves as if it still needs to find the issue.

Source: https://github.com/openai/codex/issues/14513

Useful labels:
- `state_regression`
- `contradiction`
- `plot_twist`

## Gemini CLI

### Enthusiastic discovery phrasing

A Gemini CLI issue contains output with `Found it!` followed later by `Perfect! I found ...` after searching and reading files.

Source: https://github.com/google-gemini/gemini-cli/issues/12085

Useful labels:
- `discovery_claim`
- `enthusiastic_prefix`
- `catchphrase_candidate`

### Apology / correction cascade

A Gemini CLI hallucination report shows Gemini first saying `You are absolutely right. I was wrong`, then immediately hallucinating another nonexistent mechanism, then being corrected again and admitting another mistake.

Source: https://github.com/google-gemini/gemini-cli/issues/5855

Useful labels:
- `self_correction`
- `apology_loop`
- `correction_then_rehallucination`
- `plot_twist`

## DeepSeek and other models

Public, attributable long-form coding transcripts are much scarcer and noisier than Claude Code / Codex / Gemini CLI examples. We should therefore avoid pretending we already know a universal DeepSeek phrase profile. User-provided DSH sessions will be especially valuable for calibration.

The core detector should still work on DeepSeek because it should detect event structure rather than English trigger phrases. Chinese examples such as `重大发现！！！我们前面的路线完全错了！` should score highly because they combine:

- a strong discovery claim
- confidence / emphasis escalation
- explicit reversal of the previous route
- high standalone entertainment value

## First scoring hypothesis

Gold-quote score should be mostly semantic/event-based:

`gold = reversal + surprise + confidence_shift + standalone_readability + rarity + emotional_intensity + context_payoff - template_penalty`

Catchphrase score should be separate:

`catchphrase = normalized_frequency + semantic_cluster_size + cross_session_persistence - genericity`

A sentence can be a strong catchphrase and a weak gold quote. For example, `现在问题已经非常明确了` may be funny because it appears 12 times, while a one-off line such as `重大发现！！！我们前面的路线完全错了！` may be the actual quote of the session.

## Calibration implication

Do not compare raw phrase frequency across models. Use a per-model / per-session baseline where possible. Claude's `I found the issue!`, Codex's `exact defect`, Gemini's `Perfect!`, and DeepSeek's Chinese high-emotion phrasing may be stylistically different expressions of the same underlying event.
