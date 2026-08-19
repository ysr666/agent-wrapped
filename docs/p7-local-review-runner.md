# P7 — Local Evaluation Runner

P7 turns the P5 ingestion and P6 evaluation APIs into a repeatable local experiment loop.

The goal is not a polished end-user UI yet. The goal is to make real-session calibration cheap enough that we can stop tuning the Moment Engine against synthetic examples **without collecting labels that accidentally measure language friction instead of entertainment value**.

## Workflow

```text
~/.dsh/sessions
      ↓
agent-wrapped dsh --latest 30
      ↓
P5 ingest → P0–P4 → P6 evaluation cases
      ↓
~/.agent-wrapped/review-workspace.json
      ↓
P7 review protocol v2 + presentation locale
      ↓
agent-wrapped review
      ├─ Award keep / drop / skip
      ├─ optional 1–5 fun score
      ├─ blind A/B moment preference
      ├─ auto-skip language-unsafe A/B pairs
      └─ human-supplied missed moment
      ↓
checkpoint after every answer
      ↓
agent-wrapped calibration
      ↓
review coverage / decisive keep-rate / pairwise accuracy / skips / misses / per-award metrics
```

The workspace stores P6 evaluation cases and human judgments. It does **not** persist copies of the original full DSH transcripts.

## Review protocol v2

Every human review is bound to:

```text
reviewProtocolVersion
presentationLocale
session evaluation-case fingerprint
```

A label is reusable only when all three still match. This is stricter than fingerprinting candidates alone because changing the language/presentation shown to the reviewer can change a human judgment even when the underlying Moment is identical.

Legacy v1 workspaces are migrated safely: P6 cases and fingerprints are retained, but old unversioned human judgments and completion markers are discarded. Missing labels are better than mixing ratings collected under incompatible presentation semantics.

## Commands

Prepare the newest local DSH sessions:

```bash
agent-wrapped dsh --latest 30
```

Useful options:

```bash
agent-wrapped dsh \
  --latest 50 \
  --top-moments 8 \
  --pairs 12
```

Use `--root PATH` to override the DSH session root and `--store PATH` to override the P7 workspace path.

`--reasoning` remains explicit opt-in and should only be used when the source host surface actually exposed those reasoning blocks to the user.

A new review workspace defaults to `zh-CN`. Once a workspace exists, running `dsh` again without `--locale` preserves its existing locale. Switch intentionally with:

```bash
agent-wrapped dsh --latest 30 --locale en
```

Changing the workspace locale invalidates incompatible human labels rather than silently mixing Chinese- and English-presentation judgments.

Start or resume human review:

```bash
agent-wrapped review
```

`review --locale zh-CN|en` is a safety check, not an in-place locale switch. It must match the workspace. To switch, re-run `dsh --locale ...` explicitly.

Review one known session:

```bash
agent-wrapped review --session <session-id>
```

Continue through all incomplete sessions:

```bash
agent-wrapped review --all
```

Inspect progress:

```bash
agent-wrapped status
agent-wrapped status --json
```

Print calibration results:

```bash
agent-wrapped calibration
agent-wrapped calibration --json
```

Status/calibration output includes the active review protocol and presentation locale.

## Storage

Default workspace:

```text
$AGENT_WRAPPED_HOME/review-workspace.json
```

When `AGENT_WRAPPED_HOME` is unset:

```text
~/.agent-wrapped/review-workspace.json
```

Writes use a temporary file plus rename so an interrupted process does not intentionally overwrite the workspace with a partially serialized JSON document.

## Refresh safety

Running `agent-wrapped dsh` again refreshes the P6 cases from current local sessions.

Human reviews are preserved only when:

```text
case fingerprint unchanged
AND review protocol unchanged
AND presentation locale unchanged
```

If any of those change, the old review for that session is invalidated rather than silently attached to a different experiment condition.

This is important during rapid P0–P3.5 and presentation-layer iteration: stale labels are worse than missing labels.

## Review semantics

### Award review

For every selected P3.5 card:

```text
keep / drop / skip
optional fun score 1–5 for keep/drop
```

`skip` means “do not use this card as a preference judgment.” It is counted as an answered card for progress, but it is **not** counted as a drop and contributes no fun score. Calibration reports both decisive judgments and skips.

The reviewer sees the award kind and source wording, because the question is whether that final card belongs in the Wrapped.

### Chinese presentation and language coverage

`zh-CN` review never replaces the transcript evidence. Original source text remains visible. Known English agent-speak can receive a compact Chinese semantic hint, and structural Moments such as boomerangs/correction arcs can receive a structural hint.

The local presentation layer is intentionally conservative. If an English source line cannot be explained reliably by the current local rules, P7 labels it as incompletely localized instead of fabricating a translation.

For an Award, the reviewer can `skip` that card. When language coverage is incomplete, the prompt recommends skip (and Enter can accept the skip).

### Pairwise review

For P3 ranking tasks, the reviewer sees only candidate A and candidate B.

P7 intentionally hides:

```text
funScore
confidence
predicted winner
selected/rejected status
```

while asking the preference question. This reduces anchoring on the current algorithm.

For `zh-CN`, P7 first checks reader-language coverage for both candidates. If either candidate still contains English-dominant source information without a reliable Chinese cue, the pair is **automatically skipped** with reason `language-coverage`. The reviewer is not asked to choose A or B, and that pair is excluded from pairwise accuracy.

This prevents a metric that is supposed to test P3 ordering from turning into a test of how willing the reviewer is to read English.

A manual pairwise skip is tracked separately as `human-skip`.

### English presentation

An `en` workspace uses English Award labels and review prompts, not merely “Chinese UI with hints disabled.” Source text is still preserved exactly.

### Missed moments

At the end of a session, the reviewer can record a memorable line or before/after pair that the system failed to surface at all.

These are the most important signals for distinguishing:

```text
P0/P1 recall failure
vs
P2 composition failure
vs
P3 ranking failure
vs
P3.5 selection failure
```

## Calibration semantics

Award keep rate is:

```text
kept / (kept + dropped)
```

Skipped Awards are reported separately and do not enter the denominator. Average fun score likewise ignores skipped cards.

Pairwise accuracy uses only decisive A/B votes. Ties and skips are excluded; language-coverage skips are reported separately so a high skip rate can reveal that the local presentation layer still needs work.

## Resume behavior

P7 checkpoints after every accepted answer or automatic language-coverage skip.

If the reviewer quits midway, the next run skips already answered Awards/pairs and continues from the first unanswered item. A session is marked complete only after its Award review, pairwise tasks, and missed-moment step are finished.

Resume is permitted only inside the same review protocol and presentation locale. A protocol/locale mismatch starts with clean judgments instead of reusing incompatible answers.

## What P7 does not do

P7 does not automatically change weights, train a reranker, silently call a translation service, or rewrite original quotes.

It exists to produce trustworthy evidence first. Once enough real sessions have been reviewed, the failure distribution should decide whether the next change belongs in local rules, graph composition, ranking/selection calibration, another host adapter, or an optional semantic layer.
