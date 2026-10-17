/**
 * The person's tracked jobs (their pipeline) and "is the job on this page
 * already tracked?". One cached list per panel session; mutations update
 * it in place instead of re-fetching.
 */
import { matchTrackedJob, normalizeJobUrlForMatch } from "../../../../shared/job-url-match";
import { storageGet, storageSet } from "../platform/chrome";
import { fetchSavedJobs, setJobStatus, updateJobDetails, type Job, type JobDetails, type PipelineStatus } from "../api/jobs";
import { pairStore, setPairJob } from "./pair";
import { createStore } from "./store";

/**
 * `links`: page URL → the job id Track returned for it. Track can answer
 * with an existing job listed under another URL (the same posting seen on
 * another board), so the page alone can't find it in `saved`.
 */
export type JobsState = { saved: Job[]; links: Readonly<Record<string, string>>; loaded: boolean; loading: boolean };

const LINKS_KEY = "trackedPageLinks";
const MAX_LINKS = 300;

export const jobsStore = createStore<JobsState>({ saved: [], links: {}, loaded: false, loading: false });

export async function loadSavedJobs(force = false): Promise<void> {
  const s = jobsStore.get();
  if (s.loading || (s.loaded && !force)) return;
  jobsStore.set({ loading: true });
  try {
    const [saved, links] = await Promise.all([fetchSavedJobs(), storageGet<Record<string, string>>(LINKS_KEY)]);
    jobsStore.set({ saved, links: { ...(links ?? {}), ...jobsStore.get().links }, loaded: true });
  } finally {
    jobsStore.set({ loading: false });
  }
}

/** The tracked job for a page URL (listing or apply page, or the job Track returned for it). */
export function findTrackedJob(saved: readonly Job[], url: string, links: JobsState["links"] = {}): Job | null {
  const matched = matchTrackedJob(saved, url)?.job;
  if (matched) return matched;
  const linkedId = links[normalizeJobUrlForMatch(url)];
  return linkedId ? (saved.find((j) => j.id === linkedId) ?? null) : null;
}

/** Remember that `pageUrl` is `job`, so the page shows as tracked. */
export function linkPageToJob(pageUrl: string, job: Job): void {
  const key = normalizeJobUrlForMatch(pageUrl);
  if (!key || matchTrackedJob([job], pageUrl)) return;
  const entries = Object.entries({ ...jobsStore.get().links, [key]: job.id }).slice(-MAX_LINKS);
  const links = Object.fromEntries(entries);
  jobsStore.set({ links });
  void storageSet({ [LINKS_KEY]: links });
}

export function upsertSavedJob(job: Job): void {
  jobsStore.set((s) => ({
    ...s,
    saved: [job, ...s.saved.filter((j) => j.id !== job.id)],
  }));
}

/** "Fix details" on a tracked job: save the corrected title / company / location. */
export async function correctJobDetails(job: Job, details: JobDetails): Promise<void> {
  const saved = await updateJobDetails(job.id, details);
  // Keep the pipeline fields (the PUT answers with the job row only).
  const next: Job = {
    ...job,
    title: saved.title || details.title,
    company: saved.company || details.company,
    location: saved.location || details.location,
  };
  upsertSavedJob(next);
  if (pairStore.get().job?.id === job.id) setPairJob(next);
}

export async function changeJobStatus(jobId: string, status: PipelineStatus): Promise<void> {
  await setJobStatus(jobId, status);
  jobsStore.set((s) => ({
    ...s,
    saved: s.saved.map((j) => (j.id === jobId ? { ...j, pipelineStatus: status } : j)),
  }));
}
