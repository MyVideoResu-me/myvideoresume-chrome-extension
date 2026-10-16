/**
 * "Fix details": correct what the page reader got wrong. Before tracking
 * it corrects the detected job (Track then sends the fixed fields as
 * hints); after, it saves them on the tracked job.
 */
import { useState } from "preact/hooks";
import type { Job, JobDetails } from "../../api/jobs";
import type { DetectedJob } from "../../domain/entities";
import { correctJobDetails } from "../../state/jobs";
import { correctDetectedJob } from "../../state/page";
import { t } from "../../platform/i18n";
import { Button, TextField } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";

const FIELDS: ReadonlyArray<{ key: keyof JobDetails; labelKey: "job_fieldTitle" | "job_fieldCompany" | "job_fieldLocation" }> = [
  { key: "title", labelKey: "job_fieldTitle" },
  { key: "company", labelKey: "job_fieldCompany" },
  { key: "location", labelKey: "job_fieldLocation" },
];

export function JobDetailsForm({
  job,
  detected,
  onDone,
}: {
  job: Job | null;
  detected: DetectedJob | null;
  onDone: () => void;
}) {
  const source = job ?? detected;
  const [draft, setDraft] = useState<JobDetails>({
    title: source?.title ?? "",
    company: source?.company ?? "",
    location: source?.location ?? "",
  });
  const save = useAction(async () => {
    const details = { title: draft.title.trim(), company: draft.company.trim(), location: draft.location.trim() };
    if (job) await correctJobDetails(job, details);
    else correctDetectedJob(details);
    onDone();
  });

  return (
    <form
      class="stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      {FIELDS.map((f) => (
        <TextField
          key={f.key}
          id={`job-${f.key}`}
          label={t(f.labelKey)}
          value={draft[f.key]}
          onInput={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
        />
      ))}
      <div class="row">
        <Button onClick={onDone}>{t("common_cancel")}</Button>
        <Button variant="primary" block type="submit" busy={save.busy} disabled={!draft.title.trim()}>
          {t("common_save")}
        </Button>
      </div>
      <ErrorNotice error={save.error} />
    </form>
  );
}
