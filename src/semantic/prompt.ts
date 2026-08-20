import type {
  SemanticEvidenceBundle,
  SemanticNarratorRequest,
  SemanticPersonaSignal,
  VerifiedStoryArc,
} from "./types.js";

export function buildStoryMinerPrompt(bundle: SemanticEvidenceBundle): SemanticNarratorRequest {
  const zh = bundle.locale === "zh-CN";
  const system = zh
    ? [
        "你是 Agent Wrapped 的 Story Miner。你的职责只有一个：从有限、已脱敏的会话事件里识别可验证的剧情结构。",
        "不要写标题、解说、人格、分数或任何娱乐文案。不要补写不存在的事实。",
        "每个 story 必须选择一个真实 windowId；该 story 的所有 beat 只能引用这个 window 内的 event:*，禁止把不同窗口、相隔很远的事件拼成一个故事。",
        "每个 beat 只能引用 event:* 证据；momentHints 只用于提示哪里可能有结构，不能作为 beat 的事实证据。",
        "beats 必须按真实时间顺序排列；attempt/workaround 应对应真实工具动作，correction/reversal 需要明确改口。success 只能引用 outcome=success 的工具事件；outcome=observation 或 unknown 绝不是 success，且工具动作成功不等于整个用户任务完成。",
        "如果证据不足，宁可不输出故事。",
        "优先识别：提前庆祝→失败、失败→换路、误判→纠正、用户打脸→恢复、能力不足→硬变通、破防→继续干、前后反转。",
        "只输出 JSON。",
      ].join("\n")
    : [
        "You are Agent Wrapped's Story Miner. Your only job is to identify verifiable story structure from bounded, redacted session events.",
        "Do not write titles, commentary, persona labels, scores, or invented facts.",
        "Every story must choose one real windowId, and every beat must cite event:* evidence from that same window. Never stitch distant or separate windows into one story.",
        "momentHints may guide attention but are not factual beat evidence.",
        "Beats must follow real chronology. attempt/workaround should map to real tool actions and correction/reversal needs explicit reversal evidence. success may only cite tool events with outcome=success; outcome=observation or unknown is never success, and a successful tool action is not proof that the whole user task succeeded.",
        "If evidence is weak, emit no story.",
        "Prefer arcs such as false dawn, failure→workaround, mistake→correction, user pushback→recovery, capability gap→improvisation, breakdown→resume, and reversal.",
        "Return JSON only.",
      ].join("\n");

  const allowedArcKinds = [
    "false_dawn",
    "failure_then_workaround",
    "mistake_then_correction",
    "user_pushback_then_recovery",
    "capability_gap_then_improvisation",
    "breakdown_then_resume",
    "reversal",
    "other",
  ];
  const allowedBeatKinds = [
    "setup",
    "claim",
    "attempt",
    "failure",
    "block",
    "user_pushback",
    "capability_gap",
    "breakdown",
    "correction",
    "workaround",
    "recovery",
    "success",
    "reversal",
  ];
  const instructions = {
    stories: [
      {
        windowId: "window:example",
        arcKind: "failure_then_workaround",
        beats: [
          { kind: "attempt", evidenceIds: ["event:example-1"] },
          { kind: "failure", evidenceIds: ["event:example-2"] },
          { kind: "workaround", evidenceIds: ["event:example-3"] },
        ],
        confidence: "high",
      },
    ],
    insufficientEvidence: null,
    allowedArcKinds,
    allowedBeatKinds,
  };

  return {
    system,
    user: [
      zh ? "输出格式示例（example id 不属于真实输入，禁止照抄）：" : "Output shape example (example ids are not real input):",
      JSON.stringify(instructions, null, 2),
      "",
      zh ? "真实 evidence：" : "Actual evidence:",
      JSON.stringify(bundle, null, 2),
    ].join("\n"),
  };
}

export function buildNarrationPrompt(
  bundle: SemanticEvidenceBundle,
  stories: VerifiedStoryArc[],
  personaSignals: SemanticPersonaSignal[],
): SemanticNarratorRequest {
  const zh = bundle.locale === "zh-CN";
  const system = zh
    ? [
        "你是 Agent Wrapped 的赛后解说。Story Miner 和本地验证器已经决定了事实结构；你只负责把已验证结构讲得有节目效果。",
        "不得新增事实、工具结果、用户反应或原话。不要改变 story 的结构。",
        "每个 story 只返回 title 和可选 commentary；commentary 是编辑部解说，不是 Agent 原话，不要用引号伪装成原话。",
        "persona 只能根据提供的、按底层剧情去重后的确定性行为信号起一个‘本场角色’外号和一句 tagline；禁止输出 0-100 分或把它说成模型天生人格。",
        "persona.label 必须明确是本场表现，例如以‘本场表现像’开头。",
        "只输出 JSON。",
      ].join("\n")
    : [
        "You are Agent Wrapped's post-game narrator. Story Miner plus local validation already determined the factual structure; you only make that verified structure entertaining.",
        "Do not add facts, tool outcomes, user reactions, or quotations. Do not alter story structure.",
        "For each story return only a title and optional editorial commentary. Commentary is not a source quote.",
        "Persona may only nickname this session from deterministic, episode-deduplicated behavior signals. Never output 0-100 scores or imply an inherent model personality.",
        "Make persona.label explicitly session-scoped.",
        "Return JSON only.",
      ].join("\n");

  const payload = {
    stories,
    personaSignals,
    evidence: {
      events: bundle.events,
      momentHints: bundle.momentHints,
    },
  };
  const shape = {
    storyCards: [{ storyId: "story:0", title: "一个 Bug，三次大结局", commentary: "大结局播完，测试说还有下一集。" }],
    persona: { label: "本场表现像收工很积极的侦探", tagline: "下结论快，返工也快。" },
  };
  return {
    system,
    user: [
      zh ? "只按这个字段形状输出：" : "Return only this field shape:",
      JSON.stringify(shape, null, 2),
      "",
      zh ? "已验证输入：" : "Verified input:",
      JSON.stringify(payload, null, 2),
    ].join("\n"),
  };
}
