/**
 * The pair the person is working on, besides "me": the job (tracked from
 * this page, or picked to pair with a candidate) and the candidate
 * captured from a profile. Kept in session storage so a panel reload
 * mid-flow doesn't lose it.
 */
import type { Job } from "../api/jobs";
import type { CapturedCandidate } from "../api/recruiter";
import type { ResumeContent } from "@shared/resume";
import { sessionGet, sessionSet } from "../platform/chrome";
import { createStore } from "./store";

const PAIR_KEY = "appPair";

/** The version of "my" résumé saved for `jobId` by the Strengthen step. */
export type TailoredVersion = { jobId: string; resumeId: string; title: string };

export type PairState = {
  job: Job | null;
  tailored: TailoredVersion | null;
  /** The cover letter written for `jobId` — the Apply step fills it in. */
  coverLetter: { jobId: string; text: string } | null;
  candidate: CapturedCandidate | null;
  /** The candidate's résumé after it was tailored to `job`. */
  candidateResume: ResumeContent | null;
};

export const pairStore = createStore<PairState>({
  job: null,
  tailored: null,
  coverLetter: null,
  candidate: null,
  candidateResume: null,
});

/** Whose pair this is — a saved pair is only restored for the same account. */
let owner: string | null = null;

pairStore.subscribe(() => {
  if (owner) void sessionSet({ [PAIR_KEY]: { owner, state: pairStore.get() } });
});

export async function restorePair(userId: string): Promise<void> {
  owner = userId;
  const saved = await sessionGet<{ owner: string; state: PairState }>(PAIR_KEY);
  if (saved?.owner === userId && saved.state) pairStore.set(saved.state);
}

export function setPairJob(job: Job | null): void {
  pairStore.set((s) => ({ ...s, job, candidateResume: job?.id === s.job?.id ? s.candidateResume : null }));
}

export function setPairCandidate(candidate: CapturedCandidate | null): void {
  pairStore.set({ candidate, candidateResume: null });
}

/** The candidate's talent-pool row arrived after capture (it was saved on demand). */
export function setCandidatePool(talentPoolId: string, poolEmail: string | null): void {
  pairStore.set((s) => (s.candidate ? { ...s, candidate: { ...s.candidate, talentPoolId, poolEmail } } : s));
}

export function setCandidateEmail(email: string): void {
  pairStore.set((s) =>
    s.candidate ? { ...s, candidate: { ...s.candidate, profile: { ...s.candidate.profile, email } } } : s,
  );
}

export function setCandidateResume(content: ResumeContent | null): void {
  pairStore.set({ candidateResume: content });
}

export function setCoverLetterText(jobId: string, text: string): void {
  pairStore.set({ coverLetter: { jobId, text } });
}

export function setTailoredVersion(version: TailoredVersion): void {
  pairStore.set({ tailored: version });
}

/**
 * The résumé to use for `jobId`: the version tailored to it when there is
 * one, else the person's active résumé.
 */
export function resumeIdForJob(state: PairState, jobId: string | null, activeResumeId: string | null): string | null {
  if (jobId && state.tailored?.jobId === jobId) return state.tailored.resumeId;
  return activeResumeId;
}
