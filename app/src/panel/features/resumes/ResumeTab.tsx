/** Target › Résumé: which résumé goes with this job, tailor it if not yet, download or edit it. */
import type { ComponentChildren } from "preact";
import { navigate, setTab } from "../../state/nav";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioResumeUrl } from "../../platform/web-links";
import { Button, Card, Chip } from "../../ui/controls";
import { useJobContext } from "../job/useTrackedJob";
import { useWorkingResume } from "../job/useWorkingResume";
import { DownloadButton } from "./DownloadButton";

export function ResumeTab({ tabs }: { tabs: ComponentChildren }) {
  const { job } = useJobContext();
  const resume = useWorkingResume(job?.id ?? null);

  return (
    <>
      <div class="view-body">
        {tabs}
        {resume ? (
          <Card>
            <div class="row">
              <span class="strong grow">{resume.title}</span>
              <Chip tone={resume.tailored ? "ok" : "neutral"}>
                {resume.tailored ? t("target_resumeTailored") : t("target_resumeNotTailored")}
              </Chip>
            </div>
            <p class="muted small">{resume.tailored ? t("target_resumeTailoredHint") : t("target_resumeNotTailoredHint")}</p>
            {resume.tailored ? null : (
              <Button variant="primary" block icon="target" onClick={() => navigate("strengthen")}>
                {t("action_strengthen")}
              </Button>
            )}
            <div class="row wrap">
              <DownloadButton resumeId={resume.id} title={resume.title} size="sm" />
              <Button size="sm" icon="external" onClick={() => openTab(studioResumeUrl(resume.id))}>
                {t("common_openStudio")}
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
      {resume ? (
        <footer class="view-footer">
          <Button variant="primary" block iconAfter="forward" onClick={() => setTab("cover")}>
            {t("target_nextLetter")}
          </Button>
        </footer>
      ) : null}
    </>
  );
}
