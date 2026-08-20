import {
  buildSemanticEvidence,
  createOpenAICompatibleNarratorFromEnv,
  generateSemanticStoryPersona,
  loadDshSessions,
  renderSemanticStoryPersonaText,
} from "../dist/index.js";

const locale = process.env.AGENT_WRAPPED_LOCALE === "en" ? "en" : "zh-CN";
const includeVisibleReasoning = /^(?:1|true|yes)$/iu.test(process.env.AGENT_WRAPPED_INCLUDE_REASONING ?? "");
const topMoments = Number.isFinite(Number(process.env.AGENT_WRAPPED_TOP_MOMENTS))
  ? Math.max(0, Math.min(20, Number(process.env.AGENT_WRAPPED_TOP_MOMENTS)))
  : 6;

const sessions = await loadDshSessions({ maxSessions: 1, includeVisibleReasoning });
const session = sessions[0];
if (!session) throw new Error("No readable DSH session was found.");

const evidence = buildSemanticEvidence(session, { locale, topMoments });
if (evidence.events.length < 2 || evidence.windows.length === 0) {
  console.log("No bounded event windows were available for semantic story discovery.");
  process.exit(0);
}

const { narrator, config } = createOpenAICompatibleNarratorFromEnv();
console.log(`Session: ${session.title ?? session.id}`);
console.log(`Semantic endpoint: ${config.baseUrl}`);
console.log(`Model: ${config.model}`);
console.log(
  `Sending bounded, redacted evidence: ${evidence.events.length} events in ${evidence.windows.length} story windows` +
    ` + ${evidence.momentHints.length} secondary Moment hints; redactions=${evidence.redactionCount}` +
    `${evidence.truncated ? " (truncated to size/privacy limits)" : ""}.`,
);
console.log("P8 v2 may make two semantic calls: Story Miner first, then editorial Narrator after local validation.");
console.log("The full DSH transcript is not included in either semantic request.\n");

const result = await generateSemanticStoryPersona(session, narrator, { locale, topMoments });
console.log(renderSemanticStoryPersonaText(result.report, result.evidence));
