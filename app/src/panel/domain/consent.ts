/**
 * Candidate consent for a public candidate video: how each status reads and
 * what it allows. Only "approved" unlocks public visibility and social
 * posting — the server enforces the same rule (403 CONSENT_REQUIRED).
 */
import { CANDIDATE_CONSENT_REQUIRED_CODE } from "@shared/candidate-video-consent";
import type { Consent, ConsentStatus } from "../api/consent";
import type { MessageKey } from "../platform/i18n";

export const CONSENT_STATUS_VIEW: Record<ConsentStatus, { labelKey: MessageKey; tone: "neutral" | "ok" | "warn" }> = {
  pending: { labelKey: "consent_pending", tone: "neutral" },
  approved: { labelKey: "consent_approved", tone: "ok" },
  declined: { labelKey: "consent_declined", tone: "warn" },
  expired: { labelKey: "consent_expired", tone: "warn" },
  revoked: { labelKey: "consent_revoked", tone: "warn" },
};

/** Statuses where asking again (resend) is fair: no answer yet. A declined
 *  request stays answered — the panel never re-asks. */
const RESENDABLE: ReadonlySet<ConsentStatus> = new Set<ConsentStatus>(["pending", "expired"]);

/** The request that counts: the newest one (the API lists newest first). */
export function currentConsent(consents: readonly Consent[]): Consent | null {
  return consents[0] ?? null;
}

export function consentAllowsPublic(consent: Consent | null): boolean {
  return consent?.status === "approved";
}

export function canResend(consent: Consent | null): boolean {
  return !!consent && RESENDABLE.has(consent.status);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}

/**
 * Why the candidate has to be asked again: the server refused (403
 * CONSENT_REQUIRED) although the panel thought they had approved — the
 * video changed since (`details.reason: "content_changed"`), or the
 * approval no longer holds (withdrawn, superseded).
 */
export type AskAgainReason = "contentChanged" | "invalid";

export const ASK_AGAIN_MESSAGE: Record<AskAgainReason, MessageKey> = {
  contentChanged: "consent_askAgainChanged",
  invalid: "consent_askAgainInvalid",
};

/** The reason when `error` is the server's consent refusal (an ApiError), else null. */
export function consentRefusal(error: unknown): AskAgainReason | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { code?: unknown; details?: { reason?: unknown } | null };
  if (e.code !== CANDIDATE_CONSENT_REQUIRED_CODE) return null;
  return e.details?.reason === "content_changed" ? "contentChanged" : "invalid";
}

/** A refusal the server gave while `consentId` was the current request. */
export type ConsentRefused = { consentId: string | null; reason: AskAgainReason };

/**
 * Why the panel must ask again, or null. A refusal only counts while the
 * request it was about is still the current one (a new ask clears it); a
 * withdrawn current request always needs a new ask.
 */
export function askAgainReason(current: Consent | null, refused: ConsentRefused | null): AskAgainReason | null {
  if (refused && refused.consentId === (current?.id ?? null)) return refused.reason;
  return current?.status === "revoked" ? "invalid" : null;
}
