/** Create: detect + track the job on this page, see the fit, set the status. */
import { navigate } from "../../state/nav";
import { t } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card, Chip, Eyebrow } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { useAction } from "../../ui/useAction";
import { FitCard } from "./FitCard";
import { PipelineCard } from "./PipelineCard";
import { trackJobOnPage } from "../../state/job-capture";
import { useJobContext } from "./useTrackedJob";

export function JobView() {
  const { detected, job } = useJobContext();
  const track = useAction(() => trackJobOnPage(detected));

  const title = job?.title || detected?.title || t("job_none");
  const meta = [job?.company || detected?.company, job?.location || detected?.location].filter(Boolean);

  return (
    <>
      <ViewHeader title={t("job_viewTitle")} />
      <div class="view-body">
        <Eyebrow>{t("home_onThisPage")}</Eyebrow>
        <Card>
          <div class="detected-row">
            <span class="entity-icon entity-job">
              <Icon name="briefcase" />
            </span>
            <div class="detected-text">
              <div class="detected-title">{title}</div>
              {meta.length ? <div class="muted small">{meta.join(" · ")}</div> : null}
            </div>
          </div>
          {job ? (
            <Chip tone="ok">
              <Icon name="check" size={12} />
              {t("job_inPipeline")}
            </Chip>
          ) : (
            <Button variant="primary" block icon="bookmark" busy={track.busy} disabled={!detected} onClick={() => void track.run()}>
              {t("job_track")}
            </Button>
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
              {t("action_apply")}
            </Button>
            <Button block accent="promote" onClick={() => navigate("promote")}>
              {t("common_video")}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
