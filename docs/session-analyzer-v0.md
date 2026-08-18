# SessionAnalyzer v0

`SessionAnalyzer` is the first layer that turns sentence-level signals into a **session recap / awards show**.

The key rule is:

> Not the best quote does not mean not interesting.

A line can lose the single `Quote of the session` slot and still be excellent material for a catchphrase, wolf-cry, emotional peak, progress announcement, or premature-celebration award.

## Input

`analyzeSession(messages)` accepts normalized `TranscriptMessage[]` and only analyzes assistant-visible transcript text. User/tool/system text can provide ordering context later, but it does not become an assistant award candidate.

## v0 awards

The current analyzer can produce:

- 🏆 **Quote of the session** — highest one-off quote potential;
- 📢 **Catchphrase** — exact-normalized repeated wording;
- 🐺 **Called it too early** — repeated discovery/root-cause declarations, even when wording differs;
- 🍾 **Premature celebration** — a victory-lap line followed soon by an explicit reversal;
- 🧠 **Plot twist** — strongest explicit self-reversal/correction;
- 😱 **Emotional peak** — strongest theatrical/emotional line;
- 📈 **Progress announcement** — strongest “重大进展 / getting closer” moment;
- 🎉 **Victory lap** — strongest celebration/self-congratulation line.

The analyzer prefers category diversity when another candidate is at least 80% as strong as the category winner, so one spectacular sentence does not automatically occupy every card.

## Session metrics

v0 also reports lightweight counts used by the recap:

- assistant message count;
- extracted candidate-unit count;
- repeated exact-normalized phrase groups;
- discovery declarations;
- reversal moments;
- progress announcements;
- celebration moments.

These are entertainment/event counts, not productivity analytics.

## Important v0 boundaries

### Catchphrases are exact-normalized, not semantic yet

`现在问题已经非常明确了。` and the same sentence with different punctuation will cluster. Semantically similar variants such as `问题现在很清楚` are not merged yet.

That later belongs in a semantic clustering layer.

### Wolf-cry is event-count based

The analyzer counts high-confidence discovery/root-cause declarations across the session. It does not yet prove which declaration was actually false. Repetition is the joke signal; factual correctness can be added later when richer context is available.

### Premature celebration uses local context

A celebration candidate becomes `Premature celebration` only when a later explicit reversal appears within a configurable message window (18 transcript messages by default).

This is deliberately conservative. A distant or implicit contradiction will require the later semantic/context layer.

### Boomerang is not solved here

The classic:

> “Definitely not caching.” → “The root cause is caching.”

requires semantic claim comparison. `SessionAnalyzer v0` intentionally does not fake that with keyword rules. A future `BoomerangDetector` can feed a proper 🤡 award into the same recap model.

## Example

A long DSH session might produce:

```text
🎬 Agent Wrapped

🏆 本场金句
“重大发现！！！我们前面的路线完全错了！”

📢 口癖王
“现在问题已经非常明确了。” × 6

🐺 狼来了奖
宣布发现/根因 7 次

🍾 最早开香槟
“这次应该真的没问题了！”
→ 3 条消息后：“等等，不对……”

😱 情绪峰值
“这也太诡异了！！！”
```

This is the direction of the product: **preserve all the fun, then decide which award each moment belongs to.**
