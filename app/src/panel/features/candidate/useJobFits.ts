/**
 * Fit % of the candidate for each job the picker shows. Scored lazily, only
 * for the jobs on screen, at most CONCURRENCY at a time, and once per pair
 * per panel session (cached in candidateWorkStore).
 */
import { useEffect } from "preact/hooks";
import type { Job } from "../../api/jobs";
import { scoreFitByContent } from "../../api/match-content";
import type { CapturedCandidate } from "../../api/recruiter";
import { jobDescriptionText } from "../../domain/job-text";
import { profileToResume, resumeToText } from "../../domain/resume-docs";
import { useStore } from "../../state/store";
import { candidateWorkStore, pairKey } from "./candidate-store";

const CONCURRENCY = 2;

const inflight = new Set<string>();
const queue: Array<() => Promise<void>> = [];
let running = 0;

function pump(): void {
  while (running < CONCURRENCY && queue.length) {
    const task = queue.shift()!;
    running++;
    void task().finally(() => {
      running--;
      pump();
    });
  }
}

function setFit(key: string, score: number | null): void {
  candidateWorkStore.set((s) => ({ ...s, fits: { ...s.fits, [key]: score } }));
}

function requestFits(candidate: CapturedCandidate, jobs: readonly Job[]): void {
  let resumeText: string | null = null;
  for (const job of jobs) {
    const key = pairKey(candidate, job.id);
    if (key in candidateWorkStore.get().fits || inflight.has(key)) continue;
    resumeText ??= resumeToText(profileToResume(candidate.profile));
    const text = resumeText;
    inflight.add(key);
    queue.push(async () => {
      try {
        setFit(key, await scoreFitByContent(jobDescriptionText(job), text));
      } catch {
        setFit(key, null);
      } finally {
        inflight.delete(key);
      }
    });
  }
  pump();
}

/** Score per job id: a number, null (couldn't score), or undefined (scoring). */
export function useJobFits(candidate: CapturedCandidate | null, jobs: readonly Job[]): (jobId: string) => number | null | undefined {
  const fits = useStore(candidateWorkStore, (s) => s.fits);
  const ids = jobs.map((j) => j.id).join(",");
  useEffect(() => {
    if (candidate && jobs.length) requestFits(candidate, jobs);
  }, [candidate, ids]);
  return (jobId) => (candidate ? fits[pairKey(candidate, jobId)] : undefined);
}
