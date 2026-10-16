/**
 * The person's tracked jobs (their pipeline) and "is the job on this page
 * already tracked?". One cached list per panel session; mutations update
 * it in place instead of re-fetching.
 */
import { matchTrackedJob } from "../../../../shared/job-url-match";
import { fetchSavedJobs, setJobStatus, type Job, type PipelineStatus } from "../api/jobs";
import { createStore } from "./store";

export type JobsState = { saved: Job[]; loaded: boolean; loading: boolean };

export const jobsStore = createStore<JobsState>({ saved: [], loaded: false, loading: false });

export async function loadSavedJobs(force = false): Promise<void> {
  const s = jobsStore.get();
  if (s.loading || (s.loaded && !force)) return;
  jobsStore.set({ loading: true });
  try {
    jobsStore.set({ saved: await fetchSavedJobs(), loaded: true });
  } finally {
    jobsStore.set({ loading: false });
  }
}

/** The tracked job for a page URL (listing or apply page). */
export function findTrackedJob(saved: readonly Job[], url: string): Job | null {
  return matchTrackedJob(saved, url)?.job ?? null;
}

export function upsertSavedJob(job: Job): void {
  jobsStore.set((s) => ({
    ...s,
    saved: [job, ...s.saved.filter((j) => j.id !== job.id)],
  }));
}

export async function changeJobStatus(jobId: string, status: PipelineStatus): Promise<void> {
  await setJobStatus(jobId, status);
  jobsStore.set((s) => ({
    ...s,
    saved: s.saved.map((j) => (j.id === jobId ? { ...j, pipelineStatus: status } : j)),
  }));
}
