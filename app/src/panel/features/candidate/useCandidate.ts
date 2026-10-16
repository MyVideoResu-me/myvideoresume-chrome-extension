/**
 * Recruiter: capture the candidate on this profile page (AI extraction →
 * talent pool), log the capture, and find an email when the page has none.
 */
import { enrichEmail, extractProfile, logInteraction } from "../../api/recruiter";
import type { DetectedProfile } from "../../domain/entities";
import { capturePageHtml } from "../../platform/page-html";
import { t } from "../../platform/i18n";
import { pairStore, setCandidateEmail, setPairCandidate } from "../../state/pair";
import { useStore } from "../../state/store";
import { useAction } from "../../ui/useAction";

export class NoProfileError extends Error {}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** The captured candidate when it is the person on this page. */
export function useCandidateFor(profile: DetectedProfile | null) {
  return useStore(pairStore, (s) =>
    s.candidate && (!profile || s.candidate.profile.name === profile.name) ? s.candidate : null,
  );
}

export function useCaptureCandidate() {
  const capture = useAction(async () => {
    const page = await capturePageHtml("profile");
    if (!page) throw new NoProfileError();
    const captured = await extractProfile(page.html, page.url);
    setPairCandidate(captured);
    if (captured.talentPoolId && !captured.duplicate) {
      void logInteraction({
        talentPoolId: captured.talentPoolId,
        type: "sourcing",
        subject: t("candidate_logCaptured", { host: hostOf(page.url) }),
      }).catch(() => undefined);
    }
    return captured;
  });

  const findEmail = useAction(async () => {
    const c = pairStore.get().candidate;
    if (!c) return null;
    const email = await enrichEmail(c.profile.name, c.profile.company);
    if (email) setCandidateEmail(email);
    return email;
  });

  return { capture, findEmail };
}
