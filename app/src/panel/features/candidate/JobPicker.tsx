/**
 * Recruiter: pick which of your open jobs to pair with the candidate — each
 * with the candidate's fit % — or take the job open in another tab.
 */
import { useEffect, useState } from "preact/hooks";
import { fetchUserJobs, type Job } from "../../api/jobs";
import { pairStore, setPairJob } from "../../state/pair";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { Button, Eyebrow, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";
import { NoJobInTabsError, captureJobFromOtherTab } from "./other-tab-job";
import { useJobFits } from "./useJobFits";
import { companyLine } from "../job/job-meta";

/** Jobs scored + shown at a time; "Show more" adds another page. */
const PAGE = 6;
/** At or above this the score reads as a strong fit. */
const STRONG_FIT = 75;

let jobsCache: Promise<Job[]> | null = null;

function loadUserJobs(): Promise<Job[]> {
  if (!jobsCache) {
    jobsCache = fetchUserJobs();
    jobsCache.catch(() => (jobsCache = null));
  }
  return jobsCache;
}

function FitScore({ score }: { score: number | null | undefined }) {
  if (score === undefined) return <span class="spinner fit-pending" aria-label={t("candidate_scoring")} />;
  if (score === null) return null;
  return (
    <span class={`fit-score ${score >= STRONG_FIT ? "fit-strong" : ""}`} aria-label={t("candidate_fitLabel", { score })}>
      {score}%
    </span>
  );
}

function OtherTabButton() {
  const take = useAction(async () => setPairJob(await captureJobFromOtherTab()));
  return (
    <>
      <Button variant="ghost" size="sm" busy={take.busy} onClick={() => void take.run()}>
        {t("candidate_otherTab")}
      </Button>
      {take.error instanceof NoJobInTabsError ? (
        <p class="muted small picker-note" role="status">
          {t("candidate_otherTabNone")}
        </p>
      ) : (
        <ErrorNotice error={take.error} fallback="error_readPage" />
      )}
    </>
  );
}

export function JobPicker() {
  const { candidate, job: paired } = useStore(pairStore, (s) => s);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [shown, setShown] = useState(PAGE);

  useEffect(() => {
    loadUserJobs().then(setJobs, setError);
  }, []);

  // The paired job (e.g. taken from another tab) is always in the list.
  const all = jobs ? (paired && !jobs.some((j) => j.id === paired.id) ? [paired, ...jobs] : jobs) : [];
  const visible = all.slice(0, shown);
  const fitOf = useJobFits(candidate, visible);

  return (
    <div class="stack-sm">
      <div class="row between wrap picker-head">
        <Eyebrow>{t("candidate_pairJob")}</Eyebrow>
        <OtherTabButton />
      </div>
      {error ? <ErrorNotice error={error} /> : null}
      {!jobs && !error ? <Spinner label={t("common_loading")} /> : null}
      {jobs && !all.length ? <p class="muted small">{t("candidate_noJobs")}</p> : null}
      {visible.length ? (
        <div class="stack-sm" role="radiogroup" aria-label={t("candidate_pairJob")}>
          {visible.map((job) => (
            <button
              type="button"
              key={job.id}
              role="radio"
              aria-checked={job.id === paired?.id}
              class={`job-opt job-opt-fit ${job.id === paired?.id ? "on" : ""}`}
              onClick={() => setPairJob(job)}
            >
              <span class="job-opt-text">
                <b>{job.title}</b>
                <small>{companyLine(job)}</small>
              </span>
              <FitScore score={fitOf(job.id)} />
            </button>
          ))}
        </div>
      ) : null}
      {all.length > shown ? (
        <Button size="sm" onClick={() => setShown((n) => n + PAGE)}>
          {t("candidate_moreJobs", { count: all.length - shown })}
        </Button>
      ) : null}
    </div>
  );
}
