import type { Award, AwardKind, AwardLocale } from "../awards/types.js";
import type { IngestedSession } from "../ingest/types.js";
import type {
  SemanticEvidenceBundle,
  SemanticNarrator,
  SemanticPersonaSignal,
  SemanticStoryPersonaReport,
  StoryArcKind,
  VerifiedStoryArc,
} from "../semantic/types.js";
import type { GenerateSemanticStoryPersonaOptions } from "../semantic/storyPersona.js";
import type { CreateWrappedReportOptions, WrappedReport } from "../wrapped/types.js";

interface ComposedCardBase {
  id: string;
  score: number;
  confidence: number;
  title: string;
}

export interface ComposedAwardCard extends ComposedCardBase {
  type: "award";
  awardKind: AwardKind;
  award: Award;
}

export interface ComposedStoryCard extends ComposedCardBase {
  type: "story";
  arcKind: StoryArcKind;
  storyIds: string[];
  stories: VerifiedStoryArc[];
  episodeCount: number;
  commentary?: string;
}

export interface ComposedPersonaCard extends ComposedCardBase {
  type: "persona";
  label: string;
  tagline: string;
  signals: SemanticPersonaSignal[];
}

export type ComposedWrappedCard = ComposedAwardCard | ComposedStoryCard | ComposedPersonaCard;

export type ComposedCardSuppressionReason =
  | "cross-route-duplicate"
  | "editorial-duplicate"
  | "unreadable-card"
  | "story-card-limit"
  | "card-limit"
  | "weak-persona";

export interface ComposedWrappedReport {
  version: 1;
  locale: AwardLocale;
  sessionId: string;
  cards: ComposedWrappedCard[];
  diagnostics: {
    sourceAwards: number;
    sourceStories: number;
    groupedStoryEpisodes: number;
    sourcePersona: boolean;
    suppressed: Array<{
      id: string;
      reason: ComposedCardSuppressionReason;
      winnerId?: string;
    }>;
  };
}

export interface WrappedComposerOptions {
  /** Final share output is deliberately compact. Defaults to 5 and is capped at 5. */
  maxCards?: number;
  /** Stories are one route, not the whole product. Defaults to 2. */
  maxStoryCards?: number;
}

export interface ComposedWrappedRenderOptions {
  /** Scores stay hidden in share/review output unless explicitly requested. */
  includeScores?: boolean;
}

export interface GenerateComposedWrappedOptions {
  wrapped?: CreateWrappedReportOptions;
  semantic?: GenerateSemanticStoryPersonaOptions;
  composer?: WrappedComposerOptions;
}

export interface GeneratedComposedWrapped {
  session: IngestedSession;
  awardReport: WrappedReport;
  semanticReport: SemanticStoryPersonaReport;
  semanticEvidence: SemanticEvidenceBundle;
  report: ComposedWrappedReport;
}

export type ComposedWrappedNarrator = SemanticNarrator;
