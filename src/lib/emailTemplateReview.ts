// Shared "needs review" logic for email/SMS templates.
// Stored reasons (review_reasons) come from the DJEP import (e.g. an unmappable
// send-timing anchor) and are cleared when the template is saved — opening and
// saving counts as acknowledging the review. The missing-subject reason is
// derived live so it disappears the moment a subject is added.

export type ReviewableTemplate = {
  is_sms?: boolean | null;
  subject?: string | null;
  review_reasons?: string[] | null;
};

export function templateReviewReasons(t: ReviewableTemplate): string[] {
  const reasons = [...(t.review_reasons ?? [])];
  if (!t.is_sms && !(t.subject ?? "").trim()) {
    reasons.push("Add a subject line before enabling.");
  }
  return reasons;
}
