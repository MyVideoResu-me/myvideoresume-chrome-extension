/** Every tracked job with its status; open one to work on it. */
import { useEffect } from "preact/hooks";
import { jobsStore, loadSavedJobs } from "../../state/jobs";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";
import { webJobsUrl } from "../../platform/web-links";
import { t } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { useAction } from "../../ui/useAction";
import { StatusSelect } from "../job/PipelineCard";

export function PipelineView() {
  const { saved, loaded } = useStore(jobsStore, (s) => s);
  const reload = useAction(() => loadSavedJobs(true));
  useEffect(() => {
    void loadSavedJobs().catch(() => undefined);
  }, []);

  return (
    <>
      <ViewHeader title={t("pipeline_viewTitle")} subtitle={t("pipeline_count", { count: saved.length })} />
      <div class="view-body">
        <div class="row">
          <Button size="sm" icon="scan" busy={reload.busy} onClick={() => void reload.run()}>
            {t("common_refresh")}
          </Button>
          <Button size="sm" icon="external" onClick={() => openTab(webJobsUrl())}>
            {t("pipeline_openSite")}
          </Button>
        </div>
        <ErrorNotice error={reload.error} />
        {!loaded ? <Spinner label={t("common_loading")} /> : null}
        {loaded && !saved.length ? <p class="muted small">{t("pipeline_empty")}</p> : null}
        {saved.map((job) => (
          <Card key={job.id}>
            <div class="detected-row">
              <span class="entity-icon entity-job">
                <Icon name="briefcase" />
              </span>
              <div class="detected-text">
                <div class="detected-title">{job.title}</div>
                <div class="muted small">{[job.company, job.location].filter(Boolean).join(" · ")}</div>
              </div>
              {job.sourceUrl ? (
                <button
                  type="button"
                  class="icon-btn"
                  aria-label={t("pipeline_openJob", { job: job.title })}
                  onClick={() => openTab(job.sourceUrl)}
                >
                  <Icon name="external" />
                </button>
              ) : null}
            </div>
            <StatusSelect job={job} label={t("pipeline_status")} />
          </Card>
        ))}
      </div>
    </>
  );
}
