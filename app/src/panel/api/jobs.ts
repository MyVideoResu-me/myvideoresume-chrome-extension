/** Jobs: capture a posting from the page and move it through the pipeline. */
import { request } from "./http";

/** Server pipeline statuses (services/job/JobService.ts JOB_PIPELINE_STATUSES). */
export const PIPELINE_STATUSES = [
  "tracked",
  "applied",
  "interviewing",
  "offered",
  "accepted",
  "rejected",
  "cancelled",
  "withdrawn",
  "declined",
] as const;
export type PipelineStatus = (typeof PIPELINE_STATUSES)[number];

export type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  applyUrl: string;
  description: string;
  pipelineStatus: PipelineStatus | null;
  /** "Full-time", "Contract", … as the posting says (job_items.job_type). */
  employmentType: string;
  /** remote | hybrid | onsite, "" when unknown. */
  workSetting: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  /** When the job row was created — for a job tracked from a page, when it was tracked. */
  createdAt: string;
};

type RawJob = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const numOrNull = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

export function toJob(raw: RawJob): Job {
  const status = str(raw.pipelineStatus ?? raw.status);
  return {
    id: str(raw.id ?? raw.Id ?? raw.jobId),
    title: str(raw.title ?? raw.Title),
    company: str(raw.company ?? raw.companyName),
    location: str(raw.location),
    sourceUrl: str(raw.sourceUrl),
    applyUrl: str(raw.applyUrl ?? raw.sourceUrl),
    description: str(raw.description ?? raw.descriptionText),
    pipelineStatus: (PIPELINE_STATUSES as readonly string[]).includes(status) ? (status as PipelineStatus) : null,
    employmentType: str(raw.employmentType ?? raw.jobType),
    workSetting: str(raw.workSetting) || (raw.isRemote === true ? "remote" : ""),
    salaryMin: numOrNull(raw.salaryMin),
    salaryMax: numOrNull(raw.salaryMax),
    salaryCurrency: str(raw.salaryCurrency) || "USD",
    createdAt: str(raw.createdAt ?? raw.postedDate),
  };
}

export type JobDetails = { title: string; company: string; location: string };

/** Correct what the extractor read (PUT /api/jobs/:id — the person's own tracked job). */
export async function updateJobDetails(jobId: string, details: JobDetails): Promise<Job> {
  const raw = await request<RawJob>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "PUT",
    body: { title: details.title, company: details.company, location: details.location },
  });
  return toJob(raw);
}

export type ExtractInput = {
  html: string;
  sourceUrl: string;
  track: boolean;
  hints?: { title?: string; company?: string; location?: string };
};

export async function extractJob(input: ExtractInput): Promise<Job> {
  const raw = await request<RawJob>("/api/jobs/extract", {
    method: "POST",
    query: { track: input.track },
    body: {
      url: input.sourceUrl,
      sourceUrl: input.sourceUrl,
      html: input.html,
      track: input.track,
      ...(input.hints?.title ? { hintTitle: input.hints.title } : {}),
      ...(input.hints?.company ? { hintCompany: input.hints.company } : {}),
      ...(input.hints?.location ? { hintLocation: input.hints.location } : {}),
    },
  });
  const candidates = raw.duplicate_candidates as RawJob[] | undefined;
  // Ambiguous match: the closest existing row is the job we mean.
  return toJob(candidates?.length ? candidates[0] : raw);
}

export async function fetchSavedJobs(): Promise<Job[]> {
  const raw = await request<unknown>("/api/jobs/saved");
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { items?: RawJob[] })?.items ?? []);
  return (list as RawJob[]).map(toJob).filter((j) => j.id);
}

/** The recruiter's own open jobs. */
export async function fetchUserJobs(): Promise<Job[]> {
  const raw = await request<unknown>("/api/jobs/user-jobs");
  const list = Array.isArray(raw) ? raw : ((raw as { items?: RawJob[] })?.items ?? []);
  return (list as RawJob[]).map(toJob).filter((j) => j.id);
}

export function setJobStatus(jobId: string, status: PipelineStatus): Promise<{ status: PipelineStatus }> {
  return request(`/api/jobs/${encodeURIComponent(jobId)}/status`, { method: "PATCH", body: { status } });
}
