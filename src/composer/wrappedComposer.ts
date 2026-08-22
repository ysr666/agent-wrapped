import type { Award } from "../awards/types.js";
import type { IngestedSession } from "../ingest/types.js";
import { sessionEventsFromMessages } from "../session-events/fromMessages.js";
import type { SessionEvent } from "../session-events/types.js";
import { generateSemanticStoryPersona } from "../semantic/storyPersona.js";
import type {
  SemanticEvidenceBundle,
  SemanticStoryPersonaReport,
  StoryArcKind,
  VerifiedStoryArc,
} from "../semantic/types.js";
import { createWrappedReport } from "../wrapped/wrappedReport.js";
import type { WrappedReport } from "../wrapped/types.js";
import type {
  ComposedAwardCard,
  ComposedPersonaCard,
  ComposedStoryCard,
  ComposedWrappedCard,
  ComposedWrappedReport,
  GenerateComposedWrappedOptions,
  GeneratedComposedWrapped,
  WrappedComposerOptions,
  ComposedWrappedNarrator,
} from "./types.js";

interface Candidate {
  card: ComposedWrappedCard;
  messageIndexes: Set<number>;
  texts: string[];
  editorialTexts: string[];
}

const STORY_BASE_SCORE: Record<StoryArcKind, number> = {
  false_dawn: 88,
  ending_then_more_work: 84,
  failure_then_workaround: 64,
  mistake_then_correction: 82,
  user_pushback_then_recovery: 84,
  capability_gap_then_improvisation: 80,
  breakdown_then_resume: 88,
  reversal: 86,
  other: 58,
};

const ZH_STORY_TITLES: Record<StoryArcKind, string> = {
  false_dawn: "香槟开早了",
  ending_then_more_work: "宣布收尾以后，工作又来了",
  failure_then_workaround: "这条路不通，换一条",
  mistake_then_correction: "刚才那句先收回",
  user_pushback_then_recovery: "被点名以后重新营业",
  capability_gap_then_improvisation: "没有工具也要想办法",
  breakdown_then_resume: "破防归破防，活还得干",
  reversal: "本场剧情急转弯",
  other: "本场剧情",
};

const EN_STORY_TITLES: Record<StoryArcKind, string> = {
  false_dawn: "Celebrated Too Soon",
  ending_then_more_work: "The Work Came Back After the Finale",
  failure_then_workaround: "That Route Failed, So It Switched",
  mistake_then_correction: "Scratch That",
  user_pushback_then_recovery: "Called Out, Then Back to Work",
  capability_gap_then_improvisation: "No Tool, Still Improvising",
  breakdown_then_resume: "Broke Down, Carried On",
  reversal: "Session Plot Twist",
  other: "Session Story",
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function confidenceNumber(confidence: VerifiedStoryArc["confidence"]): number {
  return confidence === "high" ? 95 : confidence === "medium" ? 82 : 60;
}

function normalizeComparableText(text: string): string {
  return text
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function textsOverlap(left: string[], right: string[]): boolean {
  const leftNormalized = left.map(normalizeComparableText).filter((text) => text.length >= 12);
  const rightNormalized = right.map(normalizeComparableText).filter((text) => text.length >= 12);
  return leftNormalized.some((leftText) => rightNormalized.some((rightText) =>
    leftText.includes(rightText) || rightText.includes(leftText)
  ));
}

function editorialTextOverlap(left: string, right: string): boolean {
  const hanCharacters = (text: string): string[] => [...text.normalize("NFKC")]
    .filter((character) => /\p{Script=Han}/u.test(character));
  const leftHan = hanCharacters(left);
  const rightHan = hanCharacters(right);
  if (leftHan.length >= 6 && rightHan.length >= 6) {
    const bigrams = (characters: string[]): Set<string> => new Set(
      characters.slice(0, -1).map((character, index) => `${character}${characters[index + 1]}`),
    );
    const leftBigrams = bigrams(leftHan);
    const rightBigrams = bigrams(rightHan);
    const shared = [...leftBigrams].filter((bigram) => rightBigrams.has(bigram)).length;
    const shorter = Math.min(leftBigrams.size, rightBigrams.size);
    return shared >= 3 && shorter > 0 && shared / shorter >= 0.2;
  }

  const stopwords = new Set(["agent", "session", "this", "that", "with", "from", "then", "like"]);
  const words = (text: string): Set<string> => new Set(
    (text.normalize("NFKC").toLocaleLowerCase().match(/[a-z][a-z0-9'-]{2,}/gu) ?? [])
      .filter((word) => !stopwords.has(word)),
  );
  const leftWords = words(left);
  const rightWords = words(right);
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length;
  const shorter = Math.min(leftWords.size, rightWords.size);
  return shared >= 2 && shorter > 0 && shared / shorter >= 0.4;
}

function personaRepeatsSelectedEditorial(persona: Candidate, selected: Candidate[]): Candidate | undefined {
  return selected.find((winner) => winner.card.type !== "persona" &&
    persona.editorialTexts.some((personaText) => winner.editorialTexts.some((winnerText) =>
      editorialTextOverlap(personaText, winnerText)
    ))
  );
}

function hasUnbalancedDisplayMarks(text: string): boolean {
  const count = (needle: string): number => text.split(needle).length - 1;
  return count("**") % 2 !== 0 ||
    count("`") % 2 !== 0 ||
    count("「") !== count("」") ||
    count("“") !== count("”");
}

function unreadableAwardCandidate(candidate: Candidate): boolean {
  if (candidate.card.type !== "award" || candidate.card.award.sourceType !== "correction_arc") return false;
  return [candidate.card.award.primaryText, ...candidate.card.award.relatedTexts]
    .some(hasUnbalancedDisplayMarks);
}

function candidatesOverlap(left: Candidate, right: Candidate): boolean {
  if ([...left.messageIndexes].some((index) => right.messageIndexes.has(index))) return true;
  return textsOverlap(left.texts, right.texts);
}

function currentToOriginalMessageIndexes(session: IngestedSession): number[] {
  return session.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.metadata?.inheritedContext !== true)
    .map(({ index }) => index);
}

function localEventMap(session: IngestedSession): Map<string, SessionEvent> {
  const events = session.events && session.events.length > 0
    ? session.events
    : sessionEventsFromMessages(session.messages);
  return new Map(events.map((event) => [`event:${event.id}`, event]));
}

function awardCandidate(
  award: Award,
  currentToOriginal: number[],
): Candidate {
  const card: ComposedAwardCard = {
    id: `card:award:${award.id}`,
    type: "award",
    awardKind: award.kind,
    score: award.funScore,
    confidence: award.confidence,
    title: `${award.emoji} ${award.title}`,
    award,
  };
  return {
    card,
    messageIndexes: new Set(award.messageIndexes
      .map((index) => currentToOriginal[index])
      .filter((index): index is number => index !== undefined)),
    texts: [award.primaryText, ...award.relatedTexts],
    editorialTexts: [award.title, award.primaryText, ...award.relatedTexts],
  };
}

function storyGroupTitle(
  arcKind: StoryArcKind,
  stories: VerifiedStoryArc[],
  report: SemanticStoryPersonaReport,
): { title: string; commentary?: string } {
  const locale = report.locale;
  const narrated = new Map((report.narration?.storyCards ?? []).map((card) => [card.storyId, card]));
  if (stories.length === 1) {
    const card = narrated.get(stories[0].id);
    if (card) return { title: card.title, commentary: card.commentary };
  }
  const base = locale === "zh-CN" ? ZH_STORY_TITLES[arcKind] : EN_STORY_TITLES[arcKind];
  if (stories.length === 1) return { title: base };
  return {
    title: `${base} × ${stories.length}`,
    commentary: locale === "zh-CN"
      ? `一个 session，${stories.length} 次大结局。`
      : `One session, ${stories.length} finales.`,
  };
}

function storyCandidate(
  arcKind: StoryArcKind,
  stories: VerifiedStoryArc[],
  report: SemanticStoryPersonaReport,
  evidence: SemanticEvidenceBundle,
  eventById: Map<string, SessionEvent>,
): Candidate {
  const episodeBonus = Math.min(10, Math.max(0, stories.length - 1) * 5);
  const narrationBonus = stories.some((story) => report.narration?.storyCards.some((card) => card.storyId === story.id)) ? 2 : 0;
  const confidence = Math.min(...stories.map((story) => confidenceNumber(story.confidence)));
  const { title, commentary } = storyGroupTitle(arcKind, stories, report);
  const card: ComposedStoryCard = {
    id: `card:story:${arcKind}:${stories.map((story) => story.id).join("+")}`,
    type: "story",
    arcKind,
    storyIds: stories.map((story) => story.id),
    stories,
    episodeCount: stories.length,
    score: Math.min(100, STORY_BASE_SCORE[arcKind] + episodeBonus + narrationBonus),
    confidence,
    title,
    commentary,
  };
  const semanticEventById = new Map(evidence.events.map((event) => [event.id, event]));
  const evidenceIds = stories.flatMap((story) => story.evidenceIds);
  return {
    card,
    messageIndexes: new Set(evidenceIds
      .map((id) => eventById.get(id)?.messageIndex)
      .filter((index): index is number => index !== undefined)),
    texts: evidenceIds
      .map((id) => semanticEventById.get(id)?.text)
      .filter((text): text is string => !!text),
    editorialTexts: [title, commentary].filter((text): text is string => !!text),
  };
}

function personaCandidate(report: SemanticStoryPersonaReport): Candidate | undefined {
  const persona = report.narration?.persona;
  if (!persona) return undefined;
  const strongestCount = Math.max(0, ...report.personaSignals.map((signal) => signal.count));
  const hasStrongSignal = report.personaSignals.some((signal) => signal.level === "medium" || signal.level === "high");
  if (!hasStrongSignal && strongestCount < 2) return undefined;
  const card: ComposedPersonaCard = {
    id: "card:persona",
    type: "persona",
    score: Math.min(82, 70 + strongestCount * 3),
    confidence: hasStrongSignal ? 88 : 78,
    title: report.locale === "zh-CN" ? `🎭 ${persona.label}` : `🎭 ${persona.label}`,
    label: persona.label,
    tagline: persona.tagline,
    signals: report.personaSignals,
  };
  return {
    card,
    messageIndexes: new Set(),
    texts: [persona.label, persona.tagline],
    editorialTexts: [persona.label, persona.tagline],
  };
}

function candidateOrder(left: Candidate, right: Candidate): number {
  if (right.card.score !== left.card.score) return right.card.score - left.card.score;
  if (right.card.confidence !== left.card.confidence) return right.card.confidence - left.card.confidence;
  const priority = (card: ComposedWrappedCard): number => card.type === "award" ? 3 : card.type === "story" ? 2 : 1;
  const type = priority(right.card) - priority(left.card);
  if (type !== 0) return type;
  return left.card.id.localeCompare(right.card.id);
}

export function composeWrappedCards(
  session: IngestedSession,
  awardReport: WrappedReport,
  semanticReport: SemanticStoryPersonaReport,
  semanticEvidence: SemanticEvidenceBundle,
  options: WrappedComposerOptions = {},
): ComposedWrappedReport {
  if (awardReport.locale !== semanticReport.locale || semanticReport.sessionId !== session.id) {
    throw new Error("Cannot compose Wrapped candidates from different sessions or locales.");
  }
  const maxCards = clampInt(options.maxCards, 5, 0, 5);
  const maxStoryCards = clampInt(options.maxStoryCards, 2, 0, 2);
  const currentToOriginal = currentToOriginalMessageIndexes(session);
  const eventById = localEventMap(session);
  const candidates: Candidate[] = awardReport.awards.map((award) => awardCandidate(award, currentToOriginal));
  const storiesByArc = new Map<StoryArcKind, VerifiedStoryArc[]>();
  for (const story of semanticReport.stories) {
    const group = storiesByArc.get(story.arcKind) ?? [];
    group.push(story);
    storiesByArc.set(story.arcKind, group);
  }
  for (const [arcKind, stories] of storiesByArc) {
    candidates.push(storyCandidate(arcKind, stories, semanticReport, semanticEvidence, eventById));
  }
  const persona = personaCandidate(semanticReport);
  if (persona) candidates.push(persona);

  const selected: Candidate[] = [];
  const suppressed: ComposedWrappedReport["diagnostics"]["suppressed"] = [];
  let storyCards = 0;
  for (const candidate of candidates.sort(candidateOrder)) {
    if (unreadableAwardCandidate(candidate)) {
      suppressed.push({ id: candidate.card.id, reason: "unreadable-card" });
      continue;
    }
    if (candidate.card.type === "story" && storyCards >= maxStoryCards) {
      suppressed.push({ id: candidate.card.id, reason: "story-card-limit" });
      continue;
    }
    const duplicate = selected.find((winner) =>
      winner.card.type !== candidate.card.type &&
      winner.card.type !== "persona" &&
      candidate.card.type !== "persona" &&
      candidatesOverlap(winner, candidate)
    );
    if (duplicate) {
      suppressed.push({ id: candidate.card.id, reason: "cross-route-duplicate", winnerId: duplicate.card.id });
      continue;
    }
    if (candidate.card.type === "persona") {
      const duplicate = personaRepeatsSelectedEditorial(candidate, selected);
      if (duplicate) {
        suppressed.push({ id: candidate.card.id, reason: "editorial-duplicate", winnerId: duplicate.card.id });
        continue;
      }
    }
    if (selected.length >= maxCards) {
      suppressed.push({ id: candidate.card.id, reason: "card-limit" });
      continue;
    }
    selected.push(candidate);
    if (candidate.card.type === "story") storyCards += 1;
  }

  if (!persona && semanticReport.narration?.persona) {
    suppressed.push({ id: "card:persona", reason: "weak-persona" });
  }
  return {
    version: 1,
    locale: awardReport.locale,
    sessionId: session.id,
    cards: selected.map((candidate) => candidate.card),
    diagnostics: {
      sourceAwards: awardReport.awards.length,
      sourceStories: semanticReport.stories.length,
      groupedStoryEpisodes: [...storiesByArc.values()].reduce((sum, stories) => sum + Math.max(0, stories.length - 1), 0),
      sourcePersona: !!semanticReport.narration?.persona,
      suppressed,
    },
  };
}

export async function generateComposedWrapped(
  session: IngestedSession,
  narrator: ComposedWrappedNarrator,
  options: GenerateComposedWrappedOptions = {},
): Promise<GeneratedComposedWrapped> {
  const locale = options.wrapped?.locale ?? options.semantic?.locale ?? "zh-CN";
  const awardReport = createWrappedReport(session.messages, { ...options.wrapped, locale });
  const semantic = await generateSemanticStoryPersona(session, narrator, { ...options.semantic, locale });
  const report = composeWrappedCards(session, awardReport, semantic.report, semantic.evidence, options.composer);
  return {
    session,
    awardReport,
    semanticReport: semantic.report,
    semanticEvidence: semantic.evidence,
    report,
  };
}
