/** How well the active résumé fits this job (POST /api/match/analyze). */
import { analyzeFit, type FitResult } from "../../api/match";
import { useState } from "preact/hooks";
import { activeResume, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { Button, Card, Chip, Meter } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";
import { useAutoRun } from "../../ui/useAutoRun";
import { settingsStore } from "../../state/settings";

/** "You show 8 of 11 required skills. Missing: …" — only when the API names the skills. */
function SkillsLine({ fit }: { fit: FitResult }) {
  const matched = fit.matchedSkills;
  const missing = fit.missingSkills;
  const total = matched.length + missing.length;
  if (!total) return null;
  return (
    <>
      <p class="small text-3">
        {t("fit_skills", { matched: matched.length, total })}
        {missing.length ? ` ${t("fit_missing")}` : ""}
      </p>
      {missing.length ? (
        <div class="row wrap gap-6">
          {missing.map((skill) => (
            <Chip key={skill} tone="warn">
              {skill}
            </Chip>
          ))}
        </div>
      ) : null}
    </>
  );
}

export function FitCard({ jobId }: { jobId: string }) {
  const resume = useStore(resumesStore, activeResume);
  const [fit, setFit] = useState<FitResult | null>(null);
  const check = useAction(async () => {
    if (resume) setFit(await analyzeFit({ jobId }, resume.id));
  });
  const autoScore = useStore(settingsStore, (s) => s.settings.autoScore);
  useAutoRun(autoScore && !!resume, check.run);
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
          <SkillsLine fit={fit} />
          {fit.summary && !fit.missingSkills.length ? <p class="muted small pre-line">{fit.summary}</p> : null}
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
