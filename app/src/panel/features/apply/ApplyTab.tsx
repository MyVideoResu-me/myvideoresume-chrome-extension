/**
 * Target › Apply: what the form on this page needs (before filling), fill
 * it, and the job is marked Applied when the person submits it. We never
 * submit.
 */
import type { ComponentChildren } from "preact";
import { t } from "../../platform/i18n";
import { Button, Card, Spinner } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { useJobContext } from "../job/useTrackedJob";
import { useWorkingResume } from "../job/useWorkingResume";
import { ReadinessList } from "./ReadinessList";
import { NoFormError, useApplyForm } from "./useApplyForm";

export function ApplyTab({ tabs }: { tabs: ComponentChildren }) {
  const { job } = useJobContext();
  const resume = useWorkingResume(job?.id ?? null);
  const form = useApplyForm(resume, job?.id ?? null);
  const applied = job?.pipelineStatus === "applied";
  const error = form.fill.error ?? form.scan.error;

  return (
    <>
      <div class="view-body">
        {tabs}
        {resume ? (
          <Card>
            <div class="row">
              <span class="strong grow">{t("apply_form")}</span>
              {form.total ? <span class="small text-3">{t("apply_ready", { ready: form.ready, total: form.total })}</span> : null}
            </div>
            {form.scan.busy ? <Spinner label={t("apply_reading")} /> : null}
            {form.rows.length ? <ReadinessList rows={form.rows} resume={resume} onAnswer={form.answer} /> : null}
            {error instanceof NoFormError ? (
              <>
                <p class="muted small">{t("apply_noForm")}</p>
                <Button size="sm" icon="scan" busy={form.scan.busy} onClick={() => void form.scan.run()}>
                  {t("home_scanAgain")}
                </Button>
              </>
            ) : (
              <ErrorNotice error={error} />
            )}
          </Card>
        ) : null}
        {applied ? <InfoNotice>{t("apply_marked")}</InfoNotice> : null}
      </div>

      {resume ? (
        <footer class="view-footer">
          <Button variant="primary" block icon="clipboard" busy={form.fill.busy} onClick={() => void form.fill.run()}>
            {form.filled ? t("apply_fillAgain") : t("apply_fill")}
          </Button>
          <div class="muted small center">{t("apply_youSubmit")}</div>
        </footer>
      ) : null}
    </>
  );
}
