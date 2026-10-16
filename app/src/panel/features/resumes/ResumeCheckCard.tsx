/** Strengthen without a job: score the résumé and list what to fix. */
import { useState } from "preact/hooks";
import { checkResume, type ResumeCheck } from "../../api/resume-tools";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioResumeUrl } from "../../platform/web-links";
import { Button, Card, Meter } from "../../ui/controls";
import { ErrorNotice, openUpgrade } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";

export function ResumeCheckCard({ resumeId, title }: { resumeId: string; title: string }) {
  const [result, setResult] = useState<ResumeCheck | null>(null);
  const check = useAction(async () => setResult(await checkResume(resumeId)));

  return (
    <Card>
      <div class="row between">
        <span class="strong">{t("check_title", { resume: title })}</span>
        {result ? (
          <span class="score">
            {result.overallScore}
            {result.grade ? ` · ${result.grade}` : ""}
          </span>
        ) : null}
      </div>
      {result ? (
        <>
          <Meter value={result.overallScore} label={t("check_meterLabel", { score: result.overallScore })} />
          <ul class="recs">
            {result.recommendations.map((r, i) => (
              <li key={i}>
                <b>{r.title}</b>
                {r.description ? <span class="muted small">{r.description}</span> : null}
              </li>
            ))}
          </ul>
          {result.locked ? (
            <Button size="sm" variant="primary" onClick={() => openUpgrade(result.upgradeUrl)}>
              {t("check_unlock")}
            </Button>
          ) : null}
          <Button size="sm" icon="external" onClick={() => openTab(studioResumeUrl(resumeId))}>
            {t("check_fixInStudio")}
          </Button>
        </>
      ) : (
        <>
          <p class="muted small">{t("check_intro")}</p>
          <Button size="sm" icon="target" busy={check.busy} onClick={() => void check.run()}>
            {t("check_run")}
          </Button>
        </>
      )}
      <ErrorNotice error={check.error} />
    </Card>
  );
}
