# CatchphraseClusterer v0

CatchphraseClusterer turns repeated wording into **verbal-tic clusters** before SessionAnalyzer assigns the 📢 catchphrase or 🐺 called-it-too-early awards.

The important distinction is that a catchphrase does not need to repeat character-for-character.

For example, these should belong together:

- `现在问题已经非常明确了。`
- `问题现在已经很清楚了。`
- `这下问题就非常明确了！`

Likewise, these are one repeated root-cause-announcement family:

- `这次真的找到根因了！！！`
- `真正的根因已经确认了！`
- `终于定位到根因了！！！`

## Local-first strategy

v0 does not use embeddings or another LLM. It clusters in three increasingly loose stages:

1. **Exact normalized match** — casing, punctuation, whitespace, and light Markdown differences are ignored.
2. **Known verbal-tic families** — a conservative bilingual rule set recognizes common patterns such as clarity announcements, root-cause declarations, progress announcements, resolution confidence, wait/reset interjections, and celebration language.
3. **Conservative fuzzy overlap** — phrases outside known families may merge only when their simplified local n-gram overlap is high.

The goal is useful offline grouping without pretending that surface similarity is full semantic understanding.

## Polarity guardrail

Known families include a simple polarity split. For example:

- `现在问题已经很明确了。`
- `现在问题还不明确。`

must not be merged merely because both contain `问题` and `明确`.

This is intentionally small and defensive; contradiction detection belongs to the later BoomerangDetector rather than CatchphraseClusterer.

## SessionAnalyzer integration

SessionAnalyzer now uses cluster counts rather than only exact-string repetition.

That changes the meaning of `repetitionCount` used by the facet scorer:

```text
现在问题已经非常明确了。
问题现在已经很清楚了。
这下问题就非常明确了！
```

Each line can now see a repetition count of `3`, which raises its catchphrase value even though no sentence is textually identical.

The catchphrase award keeps:

- a canonical representative;
- total count;
- all observed variants;
- message indexes;
- the detected family when available.

Root-cause variants also help the 🐺 award recognize repeated "we found it" behavior without requiring the exact same sentence every time.

## What v0 intentionally does not do

It does not try to cluster every semantic paraphrase. Examples such as:

- `缓存层可以排除。`
- `旧数据不是缓存产生的。`

may be semantically related but do not share enough local verbal structure to be safely treated as one catchphrase.

Those cases are candidates for an optional local embedding / semantic layer later.

## Tests

Run:

```bash
npm run test:catchphrase
```

The current tests cover:

- Chinese DSH clarity paraphrases;
- varied root-cause declarations;
- opposite-polarity separation;
- conservative fuzzy matching outside known families;
- SessionAnalyzer catchphrase integration;
- SessionAnalyzer wolf-cry integration.
