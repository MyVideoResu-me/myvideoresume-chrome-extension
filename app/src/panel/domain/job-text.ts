/** The job as text for the AI: the extracted description, else its headline. */
import type { Job } from "../api/jobs";

export function jobDescriptionText(job: Job): string {
  return job.description || [job.title, job.company, job.location].filter(Boolean).join(" · ");
}
