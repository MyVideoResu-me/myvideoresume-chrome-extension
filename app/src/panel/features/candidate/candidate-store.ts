/**
 * What the recruiter flows learn about a candidate + job pair this panel
 * session: fit scores per job (so the picker never re-scores), the changes
 * the last tailoring made (the timeline's Diff), and the candidate video's
 * watch link (the intro message can attach it). Keyed per pair.
 */
import type { TailorChange } from "@shared/resume-tailor";
import type { CapturedCandidate } from "../../api/recruiter";
import { createStore } from "../../state/store";

export type CandidateWork = {
  /** pairKey → score, or null when scoring failed. */
  fits: Readonly<Record<string, number | null>>;
  tailorChanges: { key: string; changes: readonly TailorChange[] } | null;
  videoLink: { key: string; url: string } | null;
};

export const candidateWorkStore = createStore<CandidateWork>({ fits: {}, tailorChanges: null, videoLink: null });

export function candidateKey(candidate: CapturedCandidate): string {
  return candidate.talentPoolId ?? candidate.profile.name;
}

export function pairKey(candidate: CapturedCandidate, jobId: string): string {
  return `${candidateKey(candidate)}|${jobId}`;
}

/** The candidate's key changed (their talent-pool id arrived) — carry their pair work over. */
export function rekeyCandidateWork(from: string, to: string): void {
  if (from === to) return;
  const move = (key: string): string => (key.startsWith(`${from}|`) ? `${to}${key.slice(from.length)}` : key);
  candidateWorkStore.set((s) => ({
    fits: Object.fromEntries(Object.entries(s.fits).map(([k, v]) => [move(k), v])),
    tailorChanges: s.tailorChanges && { ...s.tailorChanges, key: move(s.tailorChanges.key) },
    videoLink: s.videoLink && { ...s.videoLink, key: move(s.videoLink.key) },
  }));
}
