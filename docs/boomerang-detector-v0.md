# BoomerangDetector v0

`BoomerangDetector` finds the funniest **before → after reversals** in exposed assistant transcript text.

The canonical example is:

> 20:31 — `可以完全排除缓存。`
>
> 21:04 — `最终根因还是缓存。`

This is different from a one-line plot twist. The comedy comes from comparing two claims separated in the session.

## Local-first scope

v0 stays local and deterministic. It does **not** run an embedding model, NLI model, or remote LLM.

It works in four steps:

1. reuse the existing assistant sentence/candidate extraction;
2. extract explicit claims with a stance such as `exclude` or `blame`;
3. normalize the claim topic;
4. pair opposite stances about the same topic within a configurable message window.

The strongest v0 shape is:

```text
rule out X
   ↓
root cause is X
```

The reverse direction (`X is the cause` → `X can be ruled out`) is also eligible.

## Topic normalization

The detector has a small bilingual alias map for common coding/debugging topics such as:

- cache / caching / 缓存
- config / configuration / 配置
- provider
- model / 模型
- network / proxy / 网络 / 代理
- database / DB / 数据库
- auth / token / 鉴权 / 认证
- frontend / UI / 前端 / 界面
- backend / server / 服务端
- plugin / 插件
- dependency / 依赖
- permission / 权限
- concurrency / mutex / lock / 并发 / 锁
- schema / serialization / 序列化
- read path / 读路径
- write path / 写路径

It also supports conservative generic topics. For example:

> `We can rule out middleware.`
>
> `The root cause is middleware behavior.`

can still pair because light generic suffixes such as `behavior`, `layer`, and `path` are removed before comparison.

## Claim cues

Examples of `exclude` cues:

- `可以排除 X`
- `不是 X`
- `X 没问题`
- `rule out X`
- `X is not the issue`
- `not caused by X`

Examples of `blame` cues:

- `根因就是 X`
- `问题在于 X`
- `不是 A，而是 X`
- `X 导致了这个问题`
- `the root cause is X`
- `caused by X`
- `X caused the failure`

Claims in the same message are never paired with each other. That prevents a normal sentence such as `不是缓存，而是配置` from becoming a fake self-contradiction.

## Ranking

A pair scores higher when:

- both claims use strong explicit cues;
- the earlier statement is highly confident;
- the later statement explicitly retracts or corrects an earlier view;
- the shape is the classic `rule out → root cause` reversal;
- both sides have a high-confidence topic match.

Distance is only a small factor. A boomerang can still be good dozens of messages later.

## SessionAnalyzer integration

`SessionAnalyzer` now exposes a ninth award:

```text
🤡 Biggest boomerang
“可以完全排除缓存。”
→ “最终根因还是缓存。”
```

The award preserves:

- the earlier line;
- the later line;
- both message indexes;
- the normalized topic;
- the detector score;
- short reasons describing why the pair matched.

`SessionMetrics` also reports `boomerangMoments`.

The boomerang pair is allowed to reuse a line that also wins another category. A sentence can be a great one-off quote and still be even funnier as one half of a before/after contradiction.

## Boundaries

v0 is intentionally **not** a general semantic contradiction engine.

It is good at explicit debugging claims such as:

- ruled out vs root cause;
- not involved vs caused by;
- not A vs later A.

It will miss subtler cases such as:

> `这个请求根本没有走缓存层。`
>
> `旧缓存键让它一直读到旧数据。`

A human can see the relationship, but the wording does not contain a clean mirrored claim. That belongs to a later optional semantic layer using local embeddings, NLI, or an opt-in LLM reranker.

The v0 rule is: **high precision first; do not manufacture a boomerang just because two sentences share a noun.**

## Tests

Run:

```bash
npm run test:boomerang
```

The current regression cases cover:

- Chinese `排除缓存 → 根因缓存`;
- English `rule out caching → root cause cache layer`;
- a generic non-dictionary topic (`middleware`);
- `不是 A，而是 B` extraction without same-message false positives;
- different-topic false-positive protection;
- same-direction false-positive protection;
- configurable distance windows;
- assistant-only extraction;
- `SessionAnalyzer` 🤡 award integration.
