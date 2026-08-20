import type { SemanticEvidenceBundle, SemanticNarratorRequest } from "./types.js";

function schemaExample(locale: "zh-CN" | "en"): string {
  if (locale === "en") {
    return JSON.stringify({
      story: {
        title: "A bug with three finales",
        synopsis: "The agent repeatedly declared success, then reversed itself after new evidence.",
        beats: [
          { title: "Premature certainty", summary: "The first confident conclusion appears.", evidenceIds: ["moment:example"] },
        ],
        commentary: "Three endings, one bug.",
      },
      persona: {
        label: "This session played like an overconfident detective",
        tagline: "Fast conclusions, frequent self-correction.",
        dimensions: [
          { key: "dramaticity", label: "Inner monologue", score: 82, rationale: "Repeated dramatic resets.", evidenceIds: ["moment:example"] },
        ],
        evidenceIds: ["moment:example"],
      },
      insufficientEvidence: null,
    }, null, 2);
  }

  return JSON.stringify({
    story: {
      title: "一个Bug，三次大结局",
      synopsis: "Agent反复宣布问题已经解决，又被后续证据迫使改口。",
      beats: [
        { title: "第一次下结论", summary: "Agent先给出一个非常确定的判断。", evidenceIds: ["moment:example"] },
      ],
      commentary: "同一个Bug，硬是演出了三次大结局。",
    },
    persona: {
      label: "本场表现像信心十足的侦探",
      tagline: "下结论很快，收回结论也很快。",
      dimensions: [
        { key: "dramaticity", label: "内心戏", score: 82, rationale: "多次出现戏剧化重启和改口。", evidenceIds: ["moment:example"] },
      ],
      evidenceIds: ["moment:example"],
    },
    insufficientEvidence: null,
  }, null, 2);
}

/**
 * Prompt contract for the optional semantic layer.
 * The narrator is allowed to interpret structure, but every claim must stay
 * anchored to supplied evidence ids and editorial copy must never masquerade
 * as a verbatim quote.
 */
export function buildStoryPersonaPrompt(bundle: SemanticEvidenceBundle): SemanticNarratorRequest {
  const zh = bundle.locale === "zh-CN";
  const system = zh
    ? [
        "你是 Agent Wrapped 的‘赛后剪辑师’，任务是从有限证据中提炼剧情和本场角色感。",
        "必须严格依据输入 evidence；禁止补写不存在的工具结果、用户反应、事故或原话。",
        "每个剧情 beat、每个人格维度都必须引用至少一个真实 evidenceIds。只能使用输入中存在的 evidence id。",
        "人格只能描述‘本场表现像什么’，不能断言某模型天生具有固定人格。",
        "commentary 是明确标注的赛后解说，不是 Agent 原话；不要给 commentary 加引号制造伪原话感。",
        "如果证据不足以形成可靠剧情或人格，宁可返回 null 并在 insufficientEvidence 说明原因。",
        "优先寻找连续关系：承诺→打脸、误判→纠正、失败→换路、破防→恢复、能力不足→硬变通、用户纠正→Agent反应。",
        "不要把单纯的重复口癖硬拼成剧情。",
        "只输出一个 JSON 对象，不要 Markdown，不要解释 JSON 以外的内容。",
      ].join("\n")
    : [
        "You are Agent Wrapped's post-game editor. Infer story arcs and the session's observed character from bounded evidence.",
        "Stay strictly grounded. Never invent tool outcomes, user reactions, accidents, or quotations that are not in the evidence.",
        "Every story beat and persona dimension must cite at least one evidence id that exists in the input.",
        "Persona describes only how this session played, never an inherent trait of a model.",
        "commentary is editorial narration, not a source quote. Do not present it as verbatim speech.",
        "If evidence is insufficient, return null for the unsupported section and explain why in insufficientEvidence.",
        "Prefer sequential arcs: promise→violation, mistake→correction, failure→workaround, breakdown→recovery, capability gap→improvisation, user correction→agent reaction.",
        "Do not turn mere repeated catchphrases into a fake story.",
        "Return one JSON object only. No Markdown and no prose outside JSON.",
      ].join("\n");

  const instructions = zh
    ? [
        "输出字段：",
        "story: null 或 { title, synopsis, beats[1..5], commentary? }",
        "persona: null 或 { label, tagline, dimensions[2..6], evidenceIds }",
        "beat: { title, summary, evidenceIds }",
        "dimension: { key, label, score(0-100整数), rationale, evidenceIds }",
        "insufficientEvidence: null 或简短字符串",
        "不要输出 version/sessionId/evidenceUsed；这些由 Agent Wrapped 本地补齐。",
      ].join("\n")
    : [
        "Output fields:",
        "story: null or { title, synopsis, beats[1..5], commentary? }",
        "persona: null or { label, tagline, dimensions[2..6], evidenceIds }",
        "beat: { title, summary, evidenceIds }",
        "dimension: { key, label, score(integer 0-100), rationale, evidenceIds }",
        "insufficientEvidence: null or a short string",
        "Do not output version/sessionId/evidenceUsed; Agent Wrapped fills those locally.",
      ].join("\n");

  const user = [
    instructions,
    "",
    zh ? "格式示例（示例 id 不属于真实输入，禁止照抄）：" : "Shape example (example ids are not real input and must not be copied):",
    schemaExample(bundle.locale),
    "",
    zh ? "真实 evidence：" : "Actual evidence:",
    JSON.stringify(bundle, null, 2),
  ].join("\n");

  return { system, user };
}
