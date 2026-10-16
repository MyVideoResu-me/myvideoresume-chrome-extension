/**
 * The candidate's consent to a public video of them: load the requests for
 * the project, ask (an email the candidate answers), resend, and re-read
 * when the panel regains focus (they may have answered meanwhile).
 *
 * When the server refuses to publish (403 CONSENT_REQUIRED) although the
 * panel saw an approval, `refused` re-reads the requests and marks the
 * current one as needing a new ask — until a newer request replaces it.
 */
import { useCallback, useEffect, useState } from "preact/hooks";
import { listConsents, requestConsent, resendConsent, type Consent } from "../../api/consent";
import type { CapturedCandidate } from "../../api/recruiter";
import {
  askAgainReason,
  consentAllowsPublic,
  currentConsent,
  type AskAgainReason,
  type ConsentRefused,
} from "../../domain/consent";
import { useAction } from "../../ui/useAction";

export function useConsent(projectId: string | null, candidate: CapturedCandidate) {
  const [consents, setConsents] = useState<Consent[] | null>(null);
  const [refusal, setRefusal] = useState<ConsentRefused | null>(null);

  const reload = useCallback(() => {
    if (!projectId) return;
    void listConsents(projectId)
      .then(setConsents)
      .catch(() => setConsents((prev) => prev ?? []));
  }, [projectId]);

  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, [reload]);

  const upsert = (c: Consent) => setConsents((prev) => [c, ...(prev ?? []).filter((x) => x.id !== c.id)]);

  const current = currentConsent(consents ?? []);
  const askAgain = askAgainReason(current, refusal);

  const ask = useAction(async (email: string, message: string) => {
    if (!projectId) return;
    upsert(
      await requestConsent({
        projectId,
        candidateName: candidate.profile.name,
        candidateEmail: email.trim() || undefined,
        talentPoolCandidateId: candidate.talentPoolId ?? undefined,
        message,
      }),
    );
  });

  const resend = useAction(async () => {
    if (current) upsert(await resendConsent(current.id));
  });

  /** The server refused to publish: re-read, and ask again about the request that was current. */
  const refused = (reason: AskAgainReason) => {
    setRefusal({ consentId: current?.id ?? null, reason });
    reload();
  };

  return {
    loaded: consents !== null,
    current,
    /** Approved, and the server hasn't refused it since. */
    approved: consentAllowsPublic(current) && !askAgain,
    askAgain,
    ask,
    resend,
    refused,
  };
}

export type ConsentState = ReturnType<typeof useConsent>;
