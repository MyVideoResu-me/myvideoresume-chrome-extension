/** Recruiter: pick which of your open jobs to pair with the candidate. */
import { useEffect, useState } from "preact/hooks";
import { fetchUserJobs, type Job } from "../../api/jobs";
import { pairStore, setPairJob } from "../../state/pair";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";

let jobsCache: Promise<Job[]> | null = null;

function loadUserJobs(): Promise<Job[]> {
  if (!jobsCache) {
    jobsCache = fetchUserJobs();
    jobsCache.catch(() => (jobsCache = null));
  }
  return jobsCache;
}

export function JobPicker() {
  const selected = useStore(pairStore, (s) => s.job?.id ?? null);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    loadUserJobs().then(setJobs, setError);
  }, []);

  if (error) return <ErrorNotice error={error} />;
  if (!jobs) return <Spinner label={t("common_loading")} />;
  if (!jobs.length) return <p class="muted small">{t("candidate_noJobs")}</p>;

  return (
    <div class="stack-sm" role="radiogroup" aria-label={t("candidate_pairJob")}>
      {jobs.map((job) => (
        <button
          type="button"
          key={job.id}
          role="radio"
          aria-checked={job.id === selected}
          class={`job-opt ${job.id === selected ? "on" : ""}`}
          onClick={() => setPairJob(job)}
        >
          <b>{job.title}</b>
          <small>{[job.company, job.location].filter(Boolean).join(" · ")}</small>
        </button>
      ))}
    </div>
  );
}
