/**
 * Candidate video consent: before a candidate's video goes public or onto
 * social, the candidate approves it from an email link. Requesting consent
 * with a talent-pool id also links the project to that candidate, and from
 * then on the server refuses public visibility / social posting
 * (403 CONSENT_REQUIRED) until they approve.
 */
import type {
  CandidateVideoConsent,
  CandidateVideoConsentStatus,
  RequestCandidateVideoConsentInput,
} from "@shared/candidate-video-consent";
import { request } from "./http";

export type Consent = CandidateVideoConsent;
export type ConsentStatus = CandidateVideoConsentStatus;
export type ConsentRequest = RequestCandidateVideoConsentInput;

const BASE = "/api/recruiter/candidate-video-consents";

export function requestConsent(input: ConsentRequest): Promise<Consent> {
  return request<Consent>(BASE, {
    method: "POST",
    body: { ...input, message: input.message?.trim().slice(0, 1000) || undefined },
  });
}

/** Every request for the project, newest first. */
export async function listConsents(projectId: string): Promise<Consent[]> {
  const out = await request<Consent[]>(BASE, { query: { projectId } });
  return Array.isArray(out) ? out : [];
}

/** 409 CONSENT_NOT_RESENDABLE unless the request is pending or expired. */
export function resendConsent(id: string): Promise<Consent> {
  return request<Consent>(`${BASE}/${encodeURIComponent(id)}/resend`, { method: "POST" });
}
