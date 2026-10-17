/** Hooks for "the job on this page" as a tracked hired.video job. */
import { useEffect } from "preact/hooks";
import type { Job } from "../../api/jobs";
import type { DetectedJob } from "../../domain/entities";
import { ensureTrackedJob } from "../../state/job-capture";
import { findTrackedJob, jobsStore, loadSavedJobs } from "../../state/jobs";
import { pageStore } from "../../state/page";
import { pairStore } from "../../state/pair";
import { useStore } from "../../state/store";

export function useTrackedJobFor(url: string | null | undefined): Job | null {
  const saved = useStore(jobsStore, (s) => s.saved);
  const links = useStore(jobsStore, (s) => s.links);
  useEffect(() => {
    void loadSavedJobs().catch(() => undefined);
  }, []);
  return url ? findTrackedJob(saved, url, links) : null;
}

/** The detected job on the page, if the page shows one. */
export function useDetectedJob(): DetectedJob | null {
  return useStore(pageStore, (s) => (s.entity?.kind === "job" ? s.entity : null));
}

/**
 * The job a job screen works on right now (tracked job for this page, or
 * the pair's job when the page shows none) + how to make sure it exists.
 */
export function useJobContext(): { detected: DetectedJob | null; job: Job | null; ensure: () => Promise<Job> } {
  const detected = useDetectedJob();
  const tracked = useTrackedJobFor(detected?.sourceUrl);
  const pairJob = useStore(pairStore, (s) => s.job);
  const job = tracked ?? (detected ? null : pairJob);
  return { detected, job, ensure: () => ensureTrackedJob(detected) };
}
