/** Target: fill the application form on this page; the person submits. */
import { changeJobStatus } from "../../state/jobs";
import { navigate } from "../../state/nav";
import { pairStore } from "../../state/pair";
import { useStore } from "../../state/store";
import { t, type MessageKey } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { useAction } from "../../ui/useAction";
import { useJobContext } from "../job/useTrackedJob";
import { useWorkingResume } from "../job/useWorkingResume";
import { NeedsResume } from "../resumes/NeedsResume";
import { NoFormError, useAutofill, type FillRow } from "./useAutofill";

const ROW_TEXT: Record<FillRow["status"], MessageKey> = {
  filled: "apply_rowFilled",
  skipped: "apply_rowSkipped",
  unmatched: "apply_rowYours",
  error: "apply_rowError",
};

export function ApplyView() {
  const { job } = useJobContext();
  const resume = useWorkingResume(job?.id ?? null);
  const hasLetter = useStore(pairStore, (s) => !!job && s.coverLetter?.jobId === job.id);
  const autofill = useAutofill(resume?.id ?? null, job?.id ?? null);
  const markApplied = useAction(async () => {
    if (job) await changeJobStatus(job.id, "applied");
  });
  const rows = autofill.rows;
  const ready = rows?.filter((r) => r.status === "filled").length ?? 0;
  const applied = job?.pipelineStatus === "applied";

  return (
    <>
      <ViewHeader title={t("apply_title")} subtitle={resume ? t("cover_resume", { resume: resume.title }) : undefined} />
      <div class="view-body">
        <NeedsResume />
        {resume ? (
          <Card>
            <p class="small">{t("apply_intro")}</p>
            <ul class="checklist">
              <li>
                <Icon name="file" />
                {t("apply_usesResume", { resume: resume.title })}
              </li>
              <li>
                <Icon name="pen" />
                {hasLetter ? t("apply_usesLetter") : t("apply_noLetter")}
              </li>
            </ul>
            {!hasLetter && job ? (
              <Button size="sm" onClick={() => navigate("coverLetter")}>
                {t("action_coverLetter")}
              </Button>
            ) : null}
          </Card>
        ) : null}

        {rows ? (
          <Card>
            <div class="row between">
              <span class="strong">{t("apply_form")}</span>
              <span class="muted small">{t("apply_ready", { ready, total: rows.length })}</span>
            </div>
            <ul class="fill-list">
              {rows.map((r, i) => (
                <li key={i} class={`fill-${r.status}`}>
                  <span class="fill-dot" aria-hidden="true">
                    {r.status === "filled" ? <Icon name="check" size={11} /> : "!"}
                  </span>
                  <span class="fill-label">{r.label}</span>
                  <span class="muted small">{t(ROW_TEXT[r.status])}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
        {autofill.fill.error instanceof NoFormError ? (
          <InfoNotice>{t("apply_noForm")}</InfoNotice>
        ) : (
          <ErrorNotice error={autofill.fill.error} />
        )}
      </div>

      {resume ? (
        <footer class="view-footer">
          <Button variant="primary" block icon="clipboard" busy={autofill.fill.busy} onClick={() => void autofill.fill.run()}>
            {rows ? t("apply_fillAgain") : t("apply_fill")}
          </Button>
          <div class="muted small center">{t("apply_youSubmit")}</div>
          {job && rows ? (
            applied ? (
              <InfoNotice>{t("apply_marked")}</InfoNotice>
            ) : (
              <Button block busy={markApplied.busy} onClick={() => void markApplied.run()}>
                {t("apply_markApplied")}
              </Button>
            )
          ) : null}
          <ErrorNotice error={markApplied.error} />
        </footer>
      ) : null}
    </>
  );
}
