# P7 — Local Evaluation Runner

P7 turns the P5 ingestion and P6 evaluation APIs into a repeatable local experiment loop.

The goal is not a polished end-user UI yet. The goal is to make real-session calibration cheap enough that we can stop tuning the Moment Engine against synthetic examples.

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
agent-wrapped review
      ├─ Award keep / drop
      ├─ optional 1–5 fun score
      ├─ blind A/B moment preference
      └─ human-supplied missed moment
      ↓
checkpoint after every answer
      ↓
agent-wrapped calibration
      ↓
review coverage / keep-rate / pairwise accuracy / misses / per-award metrics
```

The workspace stores P6 evaluation cases and human judgments. It does **not** persist copies of the original full DSH transcripts.

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

Start or resume human review:

```bash
agent-wrapped review
```

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

Human reviews are preserved only when the evaluation case fingerprint is unchanged. If the engine changed the selected/ranked moments or pairwise tasks for a session, the old review for that session is invalidated rather than silently attached to a different candidate set.

This is important during rapid P0–P3.5 iteration: stale labels are worse than missing labels.

## Review semantics

### Award review

For every selected P3.5 card:

```text
keep / drop
optional fun score 1–5
```

The reviewer sees the award kind and source wording, because the question is whether that final card belongs in the Wrapped.

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

## Resume behavior

P7 checkpoints after every accepted answer.

If the reviewer quits midway, the next run skips already answered awards/pairs and continues from the first unanswered item. A session is marked complete only after its award review, pairwise tasks, and missed-moment step are finished.

## What P7 does not do

P7 does not automatically change weights or train a reranker.

It exists to produce trustworthy evidence first. Once enough real sessions have been reviewed, the failure distribution should decide whether the next change belongs in local rules, graph composition, ranking/selection calibration, or an optional semantic layer.
