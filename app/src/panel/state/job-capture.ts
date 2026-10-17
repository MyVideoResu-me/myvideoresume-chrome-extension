/**
 * Capture the job on this page into the person's pipeline. Every flow
 * that needs a jobId (fit, tailor, cover letter, video) goes through
 * `ensureTrackedJob`; the pill's "Track" goes through `trackJobOnPage`.
 */
import { extractJob, type Job } from "../api/jobs";
import type { DetectedJob } from "../domain/entities";
import { capturePageHtml } from "../platform/page-html";
import { recordEvent } from "../platform/telemetry";
import { findTrackedJob, jobsStore, linkPageToJob, loadSavedJobs, upsertSavedJob } from "./jobs";
import { pairStore, setPairJob } from "./pair";

export class NotAJobPageError extends Error {}

export async function trackJobOnPage(detected: DetectedJob | null): Promise<Job> {
  const page = await capturePageHtml("job");
  if (!page) throw new NotAJobPageError();
  const pageUrl = detected?.sourceUrl || page.url;
  const job = await extractJob({
    html: page.html,
    sourceUrl: pageUrl,
    track: true,
    hints: detected ? { title: detected.title, company: detected.company, location: detected.location } : undefined,
  });
  upsertSavedJob(job);
  linkPageToJob(pageUrl, job);
  setPairJob(job);
  recordEvent("track", job.sourceUrl, { jobId: job.id, title: job.title, company: job.company });
  return job;
}

/** The tracked job for this page, else the pair's job, else track the page now. */
export async function ensureTrackedJob(detected: DetectedJob | null): Promise<Job> {
  await loadSavedJobs().catch(() => undefined);
  if (detected) {
    const { saved, links } = jobsStore.get();
    const existing = findTrackedJob(saved, detected.sourceUrl, links);
    if (existing) {
      setPairJob(existing);
      return existing;
    }
  }
  const pairJob = pairStore.get().job;
  if (!detected && pairJob) return pairJob;
  return trackJobOnPage(detected);
}
