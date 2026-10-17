/** The résumé every panel flow works with, and everything you can do with it. */
import type { ResumeSummary } from "../../api/resumes";
import { openTab } from "../../platform/chrome";
import { shortDate, t } from "../../platform/i18n";
import { studioResumeUrl } from "../../platform/web-links";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { BarAction, SelectedItem } from "../../ui/items";
import { useAction } from "../../ui/useAction";
import { ResumeCheckResult, useResumeCheck } from "./ResumeCheck";
import { downloadResume, useDownloadFormat } from "./useDownload";

export function resumeMeta(r: ResumeSummary): string {
  return [r.isMaster ? t("resumes_master") : t("resumes_version"), shortDate(r.updatedAt)].filter(Boolean).join(" · ");
}

export function SelectedResume({ resume }: { resume: ResumeSummary }) {
  const format = useDownloadFormat();
  const download = useAction(() => downloadResume(resume.id, resume.title, format));
  const { result, check } = useResumeCheck(resume.id);

  return (
    <SelectedItem
      eyebrow={t("resumes_usingNow")}
      icon="file"
      tone="doc"
      title={resume.title}
      meta={resumeMeta(resume)}
      actions={
        <>
          <BarAction icon="download" busy={download.busy} onClick={() => void download.run()} label={t("resumes_download", { format: format.toUpperCase() })} />
          <BarAction icon="target" busy={check.busy} onClick={() => void check.run()} label={t("action_check")} />
          <BarAction icon="pen" onClick={() => openTab(studioResumeUrl(resume.id))} label={t("action_edit")} />
        </>
      }
    >
      <ErrorNotice error={download.error} />
      <ErrorNotice error={check.error} />
      {result ? <ResumeCheckResult result={result} /> : null}
    </SelectedItem>
  );
}
