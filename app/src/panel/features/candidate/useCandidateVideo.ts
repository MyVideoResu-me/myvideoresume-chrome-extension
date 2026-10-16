/**
 * The candidate-for-job video: the candidate's résumé (built from their
 * profile, tailored when that's done, anonymized for a blind shortlist) as
 * an unlisted Studio project. Its watch link is offered to the intro
 * message. The project is created linked to the candidate's talent-pool
 * row (saved first when missing — never a candidate video without one), so
 * the server holds public posting until the candidate says yes.
 */
import { useEffect } from "preact/hooks";
import type { ResumeContent } from "@shared/resume";
import type { Job } from "../../api/jobs";
import type { CapturedCandidate } from "../../api/recruiter";
import { jobDescriptionText } from "../../domain/job-text";
import { anonymizeResume, profileToResume, resumeToText } from "../../domain/resume-docs";
import { t } from "../../platform/i18n";
import { videoWatchUrl } from "../../platform/web-links";
import { useVideoProject, type VideoSpec } from "../video/useVideoProject";
import { candidateWorkStore, pairKey } from "./candidate-store";
import { ensureCandidatePoolId } from "./useCandidate";

export type Audience = "named" | "anonymized";

export const CANDIDATE_VIDEO_SECONDS = 45;

export function useCandidateVideo(
  candidate: CapturedCandidate,
  job: Job,
  candidateResume: ResumeContent | null,
  audience: Audience,
) {
  const anonymous = audience === "anonymized";
  const spec: VideoSpec = {
    purpose: "resume",
    name: anonymous
      ? t("candidateVideo_nameAnon", { job: job.title })
      : t("candidateVideo_name", { name: candidate.profile.name, job: job.title }),
    targetDuration: CANDIDATE_VIDEO_SECONDS,
    unlisted: true,
    subjects: async () => [{ kind: "talent_pool_candidate", id: await ensureCandidatePoolId() }],
    source: async () => {
      const base = candidateResume ?? profileToResume(candidate.profile);
      const content = anonymous ? anonymizeResume(base, t("candidateVideo_anonName")) : base;
      return {
        resumeText: resumeToText(content),
        jobDescription: jobDescriptionText(job),
        prompt: t("candidateVideo_prompt", { job: job.title, company: job.company }),
      };
    },
  };
  const video = useVideoProject(spec);
  const projectId = video.project?.id ?? null;
  const shareUrl = video.project ? videoWatchUrl(video.project.slug || video.project.id) : null;

  useEffect(() => {
    if (shareUrl) candidateWorkStore.set({ videoLink: { key: pairKey(candidate, job.id), url: shareUrl } });
  }, [shareUrl]);

  return { spec, video, projectId, shareUrl };
}

export type CandidateVideo = ReturnType<typeof useCandidateVideo>;
