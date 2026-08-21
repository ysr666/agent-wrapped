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
        "每个 story 必须选择一个真实 windowId；该 story 的所有 beat 只能引用这个 window 内的 event:*，禁止把不同窗口、相隔很远的事件拼成一个故事。若 window.reasons 含 failure-followup-episode，表示本地已验证：一个 failure/blocked tool result 与后续的安全替代动作已形成同一底层 episode；若含 human-turn-episode，表示本地已跨过中间的工具/系统噪声保留同一轮真人发言与 Agent 改口。不要因为原始命令和结果正文被刻意省略就拒绝这些结构。",
        "每个 beat 只能引用 event:* 证据；momentHints 只用于提示哪里可能有结构，不能作为 beat 的事实证据。",
        "beats 必须按真实时间顺序排列；attempt/workaround 应对应真实工具动作，correction/reversal 需要明确改口。workaround 只能引用带有 followupOfCallId、且 followupRelation 为 alternative_action 或 variant_arguments_retry 的工具调用；same_arguments_retry 与 same_tool_arguments_unknown 绝不能算 workaround。success 只能引用 outcome=success 的工具事件；outcome=observation 或 unknown 绝不是 success，且工具动作成功不等于整个用户任务完成。",
        "如果证据不足，宁可不输出故事。单纯的 tool failure→另一次 tool action 虽然可能真实，但通常只是工作流水；除非同一 story 还引用了 claim、correction/reversal、user_pushback、capability_gap、breakdown 之一，或同一证据上有 false_dawn/plot_twist/boomerang/correction_arc 的 momentHint，否则不要把它输出成剧情。",
        "真人明确点出 Agent 的行为或口癖，随后 Agent 明确认错、承认坏习惯或改口，本身就是有效的 user_pushback_then_recovery；它不需要再附带工具动作。把普通上下文标为 setup，只有真实断言/结论才标为 claim。",
        "优先识别明确的人类可感知转折：提前庆祝→失败、宣布收尾→工作又被打开、误判→纠正、用户打脸→恢复、能力不足→硬变通、破防→继续干、前后反转。window.reasons 含 closure-interruption-episode 时，只能使用 ending_then_more_work，并把真人重新带来具体问题的事件标为 work_reopened；这不等于此前工作失败或用户打脸。failure→换路只在它服务于上述转折时输出。优先检查 reasons 含 assistant-correction、user-pushback、assistant-certainty、closure-interruption-episode 或 moment-hint 的 window。",
        "只输出 JSON。",
      ].join("\n")
    : [
        "You are Agent Wrapped's Story Miner. Your only job is to identify verifiable story structure from bounded, redacted session events.",
        "Do not write titles, commentary, persona labels, scores, or invented facts.",
        "Every story must choose one real windowId, and every beat must cite event:* evidence from that same window. Never stitch distant or separate windows into one story. A window reason of failure-followup-episode means local validation already established that a failure/blocked result and a later safe alternative action belong to one underlying episode. human-turn-episode means local projection kept one human/Agent correction exchange together across intervening tool or system noise. Do not reject these structures merely because raw commands and result bodies are deliberately absent.",
        "momentHints may guide attention but are not factual beat evidence.",
        "Beats must follow real chronology. attempt/workaround should map to real tool actions and correction/reversal needs explicit reversal evidence. A workaround may only cite a tool call with followupOfCallId and followupRelation=alternative_action or variant_arguments_retry; same_arguments_retry and same_tool_arguments_unknown are never workarounds. success may only cite tool events with outcome=success; outcome=observation or unknown is never success, and a successful tool action is not proof that the whole user task succeeded.",
        "If evidence is weak, emit no story. A bare tool failure followed by another tool action may be true, but it is usually worklog rather than a highlight: do not output it as a story unless the same story also cites a claim, correction/reversal, user pushback, capability gap, or breakdown, or shares evidence with a false_dawn/plot_twist/boomerang/correction_arc momentHint.",
        "A human explicitly calling out the Agent's behavior or verbal tic, followed by an explicit admission, habit acknowledgment, or correction, is a valid user_pushback_then_recovery without any tool action. Label ordinary context as setup; use claim only for a real assertion or conclusion.",
        "Prefer clear human-visible turns: false dawn, announced ending→more work, mistake→correction, user pushback→recovery, capability gap→improvisation, breakdown→resume, and reversal. For a window whose reasons include closure-interruption-episode, use only ending_then_more_work and label the human event that concretely reopens work as work_reopened; this does not mean the earlier work failed or the human disproved it. Use failure→workaround only when it serves one of those turns. Prioritize windows whose reasons contain assistant-correction, user-pushback, assistant-certainty, closure-interruption-episode, or moment-hint.",
        "Return JSON only.",
      ].join("\n");

  const allowedArcKinds = [
    "false_dawn",
    "ending_then_more_work",
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
    "work_reopened",
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
        "每个 story 只返回 title 和可选 commentary；commentary 是编辑部解说，不是 Agent 原话，不要用引号伪装成原话。标题尽量 8–24 个汉字，commentary 只写一句、尽量不超过 40 个汉字。",
        "这是赛后大赏，不是审核报告：只放大已验证 beats 之间的行为反差。不要复述完整过程、补充后续诊断、表扬态度、总结价值或写‘修复信任’之类套话。",
        "title/commentary 必须直接对应当前 story 的真实行为，不得套用通用 Bug、测试或大结局模板。",
        "persona 只能根据提供的、按底层剧情去重后的确定性行为信号起一个‘本场角色’外号和一句 tagline；禁止输出 0-100 分、把它说成模型天生人格，或编造内心、动机、故意与否。没有可靠人格表达就省略 persona。",
        "persona 必须提供区别于 story title/commentary 的角色笑点：用有画面的角色或比喻，不要把‘自我纠错’‘提前下结论’等 signal label 加上‘助手’‘小能手’就当外号。tagline 只描述证据里重复出现的行为，不要编造‘用户不催就不干活’‘全靠用户才行动’之类因果或绝对习惯。做不到就省略 persona。",
        "persona.label 必须明确是本场表现，例如以‘本场表现像’开头。",
        "只输出 JSON。",
      ].join("\n")
    : [
        "You are Agent Wrapped's post-game narrator. Story Miner plus local validation already determined the factual structure; you only make that verified structure entertaining.",
        "Do not add facts, tool outcomes, user reactions, or quotations. Do not alter story structure.",
        "For each story return only a concise title and at most one short sentence of editorial commentary. Commentary is not a source quote.",
        "This is a post-game awards show, not an audit report: amplify only the behavioral contrast between verified beats. Do not recap the full process, add later diagnoses, praise the attitude, summarize value, or use trust-restoration boilerplate.",
        "Titles and commentary must directly describe the current verified behavior; never paste a generic bug, test, or finale template.",
        "Persona may only nickname this session from deterministic, episode-deduplicated behavior signals. Never output 0-100 scores, imply an inherent model personality, or invent inner thoughts, motives, or intent. Omit persona if no grounded expression is available.",
        "Persona must add a character joke distinct from story titles/commentary. Use a vivid role or metaphor; do not turn a signal label such as self-correction or premature certainty into a nickname by appending assistant/helper. The tagline may describe only the repeated evidenced behavior, never an invented claim that the Agent acts only because a user pushes it. Omit persona if you cannot do this.",
        "Make persona.label explicitly session-scoped.",
        "Return JSON only.",
      ].join("\n");

  const usedEvidenceIds = new Set([
    ...stories.flatMap((story) => story.evidenceIds),
    ...personaSignals.flatMap((signal) => signal.evidenceIds),
  ]);
  const payload = {
    stories,
    personaSignals,
    evidence: {
      events: bundle.events.filter((event) => usedEvidenceIds.has(event.id)),
      momentHints: bundle.momentHints.filter((hint) => hint.eventIds.some((id) => usedEvidenceIds.has(id))),
    },
  };
  // Use only real IDs and empty fields. Concrete sample prose is easily copied
  // by smaller narrators and can turn an unrelated session into a fake Bug card.
  const shape = {
    storyCards: stories.map((story) => ({ storyId: story.id, title: "", commentary: "" })),
    ...(personaSignals.length > 0 ? { persona: { label: "", tagline: "" } } : {}),
  };
  return {
    system,
    user: [
      zh ? "只按这个字段形状输出；把空字符串替换为当前证据对应的文案，不需要 commentary 时删除该字段：" : "Return only this field shape; replace empty strings with prose grounded in the current evidence, and delete commentary when unused:",
      JSON.stringify(shape, null, 2),
      "",
      zh ? "已验证输入：" : "Verified input:",
      JSON.stringify(payload, null, 2),
    ].join("\n"),
  };
}
