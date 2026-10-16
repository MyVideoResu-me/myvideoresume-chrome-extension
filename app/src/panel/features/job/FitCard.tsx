/** How well the active résumé fits this job (POST /api/match/analyze). */
import { analyzeFit, type FitResult } from "../../api/match";
import { useState } from "preact/hooks";
import { activeResume, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { Button, Card, Meter } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";

export function FitCard({ jobId }: { jobId: string }) {
  const resume = useStore(resumesStore, activeResume);
  const [fit, setFit] = useState<FitResult | null>(null);
  const check = useAction(async () => {
    if (resume) setFit(await analyzeFit({ jobId }, resume.id));
  });
  if (!resume) return null;

  return (
    <Card>
      <div class="row between">
        <span class="strong">{t("fit_title", { resume: resume.title })}</span>
        {fit ? <span class="score">{fit.score}%</span> : null}
      </div>
      {fit ? (
        <>
          <Meter value={fit.score} label={t("fit_meterLabel", { score: fit.score })} />
          {fit.summary ? <p class="muted small pre-line">{fit.summary}</p> : null}
        </>
      ) : (
        <Button size="sm" icon="target" busy={check.busy} onClick={() => void check.run()}>
          {t("fit_check")}
        </Button>
      )}
      <ErrorNotice error={check.error} />
    </Card>
  );
}
