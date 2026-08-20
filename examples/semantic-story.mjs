import {
  buildSemanticEvidence,
  buildStoryPersonaPrompt,
  createOpenAICompatibleNarratorFromEnv,
  loadDshSessions,
  parseSemanticStoryPersona,
  renderSemanticStoryPersonaText,
} from "../dist/index.js";

const locale = process.env.AGENT_WRAPPED_LOCALE === "en" ? "en" : "zh-CN";
const includeVisibleReasoning = /^(?:1|true|yes)$/iu.test(process.env.AGENT_WRAPPED_INCLUDE_REASONING ?? "");
const topMoments = Number.isFinite(Number(process.env.AGENT_WRAPPED_TOP_MOMENTS))
  ? Math.max(1, Math.min(20, Number(process.env.AGENT_WRAPPED_TOP_MOMENTS)))
  : 8;

const sessions = await loadDshSessions({
  maxSessions: 1,
  includeVisibleReasoning,
});
const session = sessions[0];
if (!session) throw new Error("No readable DSH session was found.");

const evidence = buildSemanticEvidence(session, { locale, topMoments });
if (evidence.moments.length === 0) {
  console.log("No Moment candidates were available for semantic story/persona generation.");
  process.exit(0);
}

const { narrator, config } = createOpenAICompatibleNarratorFromEnv();
console.log(`Session: ${session.title ?? session.id}`);
console.log(`Semantic endpoint: ${config.baseUrl}`);
console.log(`Model: ${config.model}`);
console.log(
  `Sending bounded evidence only: ${evidence.moments.length} moments + ${evidence.messages.length} nearby messages` +
    `${evidence.truncated ? " (truncated to privacy/size limits)" : ""}.`,
);
console.log("The full DSH transcript is not included in the semantic request.\n");

const prompt = buildStoryPersonaPrompt(evidence);
const raw = await narrator.generate(prompt);
const report = parseSemanticStoryPersona(raw, evidence);
console.log(renderSemanticStoryPersonaText(report));
