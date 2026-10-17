/** "Using now": the résumé every panel flow works with, with its own actions. */
import type { ResumeSummary } from "../../api/resumes";
import { t } from "../../platform/i18n";
import { Card, Eyebrow } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { DownloadButton } from "./DownloadButton";
import { ResumeCheckCard } from "./ResumeCheckCard";

export function ActiveResumeCard({ resume }: { resume: ResumeSummary }) {
  return (
    <section class="stack-sm">
      <Eyebrow>{t("resumes_usingNow")}</Eyebrow>
      <Card class="active-resume">
        <div class="row">
          <span class="active-resume-icon" aria-hidden="true">
            <Icon name="file" />
          </span>
          <div class="active-resume-text">
            <b>{resume.title}</b>
            <small class="muted">{resume.isMaster ? t("resumes_master") : t("resumes_version")}</small>
          </div>
        </div>
        <DownloadButton key={`dl-${resume.id}`} resumeId={resume.id} title={resume.title} size="sm" />
      </Card>
      <ResumeCheckCard key={resume.id} resumeId={resume.id} title={resume.title} />
    </section>
  );
}
