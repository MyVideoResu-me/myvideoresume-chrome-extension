/**
 * Promote (job seeker): a "why I fit" video for the job on this page, or a
 * résumé video when there is no job — then share it / post it.
 */
import { jobDescriptionText } from "../../domain/job-text";
import { resumeToText } from "../../domain/resume-docs";
import { resumeContent } from "../../state/resumes";
import { t } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { useJobContext } from "../job/useTrackedJob";
import { useWorkingResume } from "../job/useWorkingResume";
import { NeedsResume } from "../resumes/NeedsResume";
import { VideoBuilder } from "../video/VideoBuilder";
import type { VideoSpec } from "../video/useVideoProject";

export function PromoteView() {
  const { detected, job, ensure } = useJobContext();
  const hasJob = !!(job || detected);
  const resume = useWorkingResume(job?.id ?? null);
  const jobTitle = job?.title || detected?.title || "";

  const spec: VideoSpec = {
    purpose: "resume",
    name: hasJob ? t("promote_fitName", { job: jobTitle }) : t("promote_resumeName", { resume: resume?.title ?? "" }),
    targetDuration: 30,
    source: async () => {
      if (!resume) throw new Error("no résumé");
      const target = hasJob ? await ensure() : null;
      const content = await resumeContent(resume.id);
      return {
        resumeText: resumeToText(content),
        resumeId: resume.id,
        jobDescription: target ? jobDescriptionText(target) : undefined,
        prompt: target ? t("promote_fitPrompt", { job: target.title, company: target.company }) : undefined,
      };
    },
  };

  return (
    <>
      <ViewHeader
        title={t("promote_title")}
        subtitle={hasJob ? t("promote_fitSubtitle", { job: jobTitle }) : t("promote_resumeSubtitle")}
      />
      <div class="view-body">
        <NeedsResume />
        {resume ? <VideoBuilder spec={spec} /> : null}
      </div>
    </>
  );
}
