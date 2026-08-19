import type { SessionHumanReview } from "../evaluation/types.js";
import type { PresentationLocale } from "../presentation/localization.js";

/** Increment whenever the human-review presentation semantics materially change. */
export const CURRENT_REVIEW_PROTOCOL_VERSION = 2;
export const DEFAULT_REVIEW_LOCALE: PresentationLocale = "zh-CN";

export function isReviewProtocolCompatible(
  review: SessionHumanReview | undefined,
  locale: PresentationLocale,
): boolean {
  return Boolean(
    review &&
      review.protocolVersion === CURRENT_REVIEW_PROTOCOL_VERSION &&
      review.presentationLocale === locale,
  );
}

export function createReviewMetadata(locale: PresentationLocale): Pick<
  SessionHumanReview,
  "protocolVersion" | "presentationLocale"
> {
  return {
    protocolVersion: CURRENT_REVIEW_PROTOCOL_VERSION,
    presentationLocale: locale,
  };
}
