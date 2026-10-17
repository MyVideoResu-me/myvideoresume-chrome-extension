/**
 * My content › Jobs: the pipeline. The job you're working on shows its
 * status, reminder and links; picking a row works on that job; each row
 * has the same links.
 */
import { useEffect, useState } from "preact/hooks";
import type { Job } from "../../api/jobs";
import { matchesQuery, newestFirst } from "../../domain/search";
import { jobsStore, loadSavedJobs } from "../../state/jobs";
import { pairStore, setPairJob } from "../../state/pair";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { publicJobUrl, webJobsUrl } from "../../platform/web-links";
import { Eyebrow, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { BarAction, EmptyState, IconAction, ItemList, ItemRow, SelectedItem } from "../../ui/items";
import { ListSearch } from "../../ui/ListSearch";
import { useAction } from "../../ui/useAction";
import type { ContentTabProps } from "../content/tab";
import { companyLine } from "../job/job-meta";
import { STATUS_LABEL, StatusSelect } from "../job/PipelineCard";
import { ReminderRow } from "../job/ReminderRow";

const byTracked = newestFirst((j: Job) => j.createdAt);
const meta = (j: Job) => [companyLine(j), t(STATUS_LABEL[j.pipelineStatus ?? "tracked"])].filter(Boolean).join(" · ");
const hasApply = (j: Job) => !!j.applyUrl && j.applyUrl !== j.sourceUrl;

export function JobsTab({ header }: ContentTabProps) {
  const { saved, loaded } = useStore(jobsStore, (s) => s);
  const pairJobId = useStore(pairStore, (s) => s.job?.id ?? null);
  const [query, setQuery] = useState("");
  const reload = useAction(() => loadSavedJobs(true));
  useEffect(() => {
    void loadSavedJobs().catch(() => undefined);
  }, []);

  const all = [...saved].sort(byTracked);
  const shown = all.filter((j) => matchesQuery(query, j.title, j.company, j.location));
  const selected = all.find((j) => j.id === pairJobId) ?? null;

  return (
    <>
      {header(
        <>
          <IconAction icon="refresh" label={t("common_refresh")} busy={reload.busy} onClick={() => void reload.run()} />
          <IconAction icon="external" label={t("pipeline_openSite")} onClick={() => openTab(webJobsUrl())} />
        </>,
      )}
      <div class="view-body">
        <ErrorNotice error={reload.error} />
        {!loaded ? <Spinner label={t("common_loading")} /> : null}
        {loaded && !all.length ? <EmptyState hint={t("pipeline_empty")} /> : null}
        {selected ? (
          <SelectedItem
            key={selected.id}
            eyebrow={t("pair_label")}
            icon="briefcase"
            tone="job"
            title={selected.title}
            meta={companyLine(selected)}
            actions={
              <>
                <BarAction icon="external" disabled={!selected.sourceUrl} onClick={() => openTab(selected.sourceUrl)} label={t("jobs_openListing")} />
                {hasApply(selected) ? (
                  <BarAction icon="send" onClick={() => openTab(selected.applyUrl)} label={t("apply_title")} />
                ) : null}
                <BarAction icon="briefcase" onClick={() => openTab(publicJobUrl(selected.id))} label={t("jobs_onHiredVideo")} />
              </>
            }
          >
            <StatusSelect job={selected} label={t("pipeline_status")} />
            <ReminderRow job={selected} />
          </SelectedItem>
        ) : null}
        {all.length ? (
          <section class="stack-sm">
            <Eyebrow>{t("pipeline_count", { count: all.length })}</Eyebrow>
            <ListSearch id="job-search" count={all.length} value={query} onInput={setQuery} />
            {!shown.length ? <p class="muted small">{t("content_noMatch")}</p> : null}
            <ItemList label={t("content_tab_jobs")}>
              {shown.map((j) => (
                <ItemRow
                  key={j.id}
                  icon="briefcase"
                  tone="job"
                  title={j.title}
                  meta={meta(j)}
                  selected={j.id === pairJobId}
                  selectLabel={t("jobs_workOn")}
                  onSelect={() => setPairJob(j)}
                  actions={
                    <>
                      <IconAction
                        icon="external"
                        label={t("pipeline_openJob", { job: j.title })}
                        disabled={!j.sourceUrl}
                        onClick={() => openTab(j.sourceUrl)}
                      />
                      <IconAction icon="briefcase" label={t("jobs_onHiredVideo")} onClick={() => openTab(publicJobUrl(j.id))} />
                    </>
                  }
                />
              ))}
            </ItemList>
          </section>
        ) : null}
      </div>
    </>
  );
}
