/** Create: detect + track the job on this page, see the fit, set the status. */
import { useState } from "preact/hooks";
import { navigate } from "../../state/nav";
import { t } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card, Chip, Eyebrow } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";
import { FitCard } from "./FitCard";
import { JobDetailsForm } from "./JobDetailsForm";
import { PipelineCard } from "./PipelineCard";
import { companyInitial, jobMetaChips } from "./job-meta";
import { trackJobOnPage } from "../../state/job-capture";
import { useJobContext } from "./useTrackedJob";

export function JobView() {
  const { detected, job } = useJobContext();
  const track = useAction(() => trackJobOnPage(detected));
  const [fixing, setFixing] = useState(false);

  const title = job?.title || detected?.title || t("job_none");
  const company = job?.company || detected?.company || "";
  const chips = job ? jobMetaChips(job) : detected ? jobMetaChips(detected) : [];

  return (
    <>
      <ViewHeader title={t("job_viewTitle")} />
      <div class="view-body">
        <Eyebrow>{t("job_detected")}</Eyebrow>
        <Card>
          <div class="detected-row align-start">
            <span class="company-tile" aria-hidden="true">
              {companyInitial(company) || "?"}
            </span>
            <div class="detected-text">
              <div class="detected-title detected-title-lg">{title}</div>
              {company ? <div class="small text-3">{company}</div> : null}
            </div>
          </div>
          {chips.length ? (
            <div class="row wrap gap-6">
              {chips.map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
            </div>
          ) : null}
          {fixing ? (
            <JobDetailsForm job={job} detected={detected} onDone={() => setFixing(false)} />
          ) : (
            <div class="row">
              {job ? (
                <Button variant="primary" block icon="check" disabled>
                  {t("job_tracked")}
                </Button>
              ) : (
                <Button variant="primary" block icon="bookmark" busy={track.busy} disabled={!detected} onClick={() => void track.run()}>
                  {t("job_track")}
                </Button>
              )}
              {job || detected ? (
                <Button icon="pen" onClick={() => setFixing(true)}>
                  {t("job_fixDetails")}
                </Button>
              ) : null}
            </div>
          )}
          <ErrorNotice error={track.error} fallback="error_readPage" />
        </Card>

        {job ? (
          <>
            <FitCard jobId={job.id} />
            <PipelineCard job={job} />
          </>
        ) : null}

        <div class="view-actions">
          <Button variant="primary" block iconAfter="forward" disabled={!job && !detected} onClick={() => navigate("strengthen")}>
            {t("job_next")}
          </Button>
          <div class="row">
            <Button block onClick={() => navigate("coverLetter")}>
              {t("action_coverLetter")}
            </Button>
            <Button block onClick={() => navigate("apply")}>
              {t("apply_title")}
            </Button>
            <Button block onClick={() => navigate("promote")}>
              {t("common_video")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
