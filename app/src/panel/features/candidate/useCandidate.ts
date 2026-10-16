/**
 * Recruiter: capture the candidate on this profile page (AI extraction →
 * talent pool), log the capture, find an email when the page has none, and
 * tailor the candidate's résumé to the paired job. A candidate video is
 * always linked to the candidate's talent-pool row, so
 * ensureCandidatePoolId saves them first when that row is missing.
 */
import { previewTailorContent } from "../../api/match";
import { enrichEmail, extractProfile, logInteraction, type CapturedCandidate } from "../../api/recruiter";
import type { DetectedProfile } from "../../domain/entities";
import { profileToResume } from "../../domain/resume-docs";
import { capturePageHtml } from "../../platform/page-html";
import { t } from "../../platform/i18n";
import { pageStore } from "../../state/page";
import { pairStore, setCandidateEmail, setCandidatePool, setCandidateResume, setPairCandidate } from "../../state/pair";
import { useStore } from "../../state/store";
import { useAction } from "../../ui/useAction";
import { candidateKey, candidateWorkStore, pairKey, rekeyCandidateWork } from "./candidate-store";

export class NoProfileError extends Error {}
/** The candidate has no talent-pool row and isn't the person on this page, so they can't be saved now. */
export class CandidateNotSavedError extends Error {}

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

/**
 * Extract the person on this page into the talent pool. A page captured
 * before whose pool row is gone comes back as a duplicate with no row —
 * capture it again past the dedup so there is always a row.
 */
async function captureToPool(): Promise<{ captured: CapturedCandidate; url: string }> {
  const page = await capturePageHtml("profile");
  if (!page) throw new NoProfileError();
  let captured = await extractProfile(page.html, page.url);
  if (!captured.talentPoolId) captured = await extractProfile(page.html, page.url, true);
  return { captured, url: page.url };
}

/**
 * The paired candidate's talent-pool id, saving them first when they have
 * none. Only the person on this page can be saved — never someone else
 * under the candidate's name.
 */
export async function ensureCandidatePoolId(): Promise<string> {
  const candidate = pairStore.get().candidate;
  if (!candidate) throw new CandidateNotSavedError();
  if (candidate.talentPoolId) return candidate.talentPoolId;
  const onPage = pageStore.get().entity;
  if (onPage?.kind !== "profile" || onPage.name !== candidate.profile.name) throw new CandidateNotSavedError();
  const { captured } = await captureToPool();
  if (!captured.talentPoolId) throw new CandidateNotSavedError();
  const before = candidateKey(candidate);
  setCandidatePool(captured.talentPoolId, captured.poolEmail ?? null);
  const after = pairStore.get().candidate;
  if (after) rekeyCandidateWork(before, candidateKey(after));
  return captured.talentPoolId;
}

export function useCaptureCandidate() {
  const capture = useAction(async () => {
    const { captured, url } = await captureToPool();
    setPairCandidate(captured);
    if (captured.talentPoolId && !captured.duplicate) {
      void logInteraction({
        talentPoolId: captured.talentPoolId,
        type: "sourcing",
        subject: t("candidate_logCaptured", { host: hostOf(url) }),
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

/** Tailor the candidate's résumé (built from their profile) to the paired job. Nothing is saved. */
export function useTailorCandidate() {
  return useAction(async () => {
    const { candidate, job } = pairStore.get();
    if (!candidate || !job) return;
    const out = await previewTailorContent({ jobId: job.id }, profileToResume(candidate.profile));
    setCandidateResume(out.tailoredResume);
    candidateWorkStore.set({ tailorChanges: { key: pairKey(candidate, job.id), changes: out.changes } });
  });
}
