/** Where a job is in the person's pipeline; changing it saves right away. */
import { PIPELINE_STATUSES, type Job, type PipelineStatus } from "../../api/jobs";
import { changeJobStatus } from "../../state/jobs";
import { t, type MessageKey } from "../../platform/i18n";
import { Card, Chip, Segmented } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";

const ACTIVE: readonly PipelineStatus[] = ["tracked", "applied", "interviewing", "offered"];
const CLOSED = PIPELINE_STATUSES.filter((s) => !ACTIVE.includes(s));

const STATUS_LABEL: Record<PipelineStatus, MessageKey> = {
  tracked: "status_tracked",
  applied: "status_applied",
  interviewing: "status_interviewing",
  offered: "status_offered",
  accepted: "status_accepted",
  rejected: "status_rejected",
  cancelled: "status_cancelled",
  withdrawn: "status_withdrawn",
  declined: "status_declined",
};

function useStatusChange(job: Job) {
  return useAction((s: PipelineStatus) => changeJobStatus(job.id, s));
}

/** A status dropdown over `statuses` (all by default). */
export function StatusSelect({
  job,
  statuses = PIPELINE_STATUSES,
  label,
}: {
  job: Job;
  statuses?: readonly PipelineStatus[];
  label: string;
}) {
  const save = useStatusChange(job);
  const status = job.pipelineStatus ?? "tracked";
  const listed = statuses.includes(status);
  return (
    <>
      <label class="row small muted">
        <span>{label}</span>
        <select
          class="select"
          value={listed ? status : ""}
          disabled={save.busy}
          onChange={(e) => {
            const v = e.currentTarget.value as PipelineStatus;
            if (v) void save.run(v);
          }}
        >
          {listed ? null : <option value="">—</option>}
          {statuses.map((s) => (
            <option key={s} value={s}>
              {t(STATUS_LABEL[s])}
            </option>
          ))}
        </select>
      </label>
      <ErrorNotice error={save.error} />
    </>
  );
}

export function PipelineCard({ job }: { job: Job }) {
  const save = useStatusChange(job);
  const status = job.pipelineStatus ?? "tracked";
  return (
    <Card>
      <div class="row between">
        <span class="strong">{t("pipeline_title")}</span>
        <Chip tone="ok">{t("job_tracked")}</Chip>
      </div>
      <Segmented
        label={t("pipeline_status")}
        value={ACTIVE.includes(status) ? status : null}
        options={ACTIVE.map((s) => ({ value: s, label: t(STATUS_LABEL[s]) }))}
        onChange={(s) => void save.run(s)}
      />
      <ErrorNotice error={save.error} />
      <StatusSelect job={job} statuses={CLOSED} label={t("pipeline_closed")} />
    </Card>
  );
}
