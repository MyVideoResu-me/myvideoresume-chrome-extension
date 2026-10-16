/**
 * Promote (job seeker): a "why I fit" video for the job on this page, or a
 * résumé video when there is no job — written here, rendered in Studio,
 * then posted to the places the person ticks with one press.
 */
import { useState } from "preact/hooks";
import { socialPlatformMeta } from "@shared/social-platforms";
import { jobDescriptionText } from "../../domain/job-text";
import { resumeToText } from "../../domain/resume-docs";
import { videoTitle } from "../../domain/video-meta";
import { resumeContent } from "../../state/resumes";
import { copyText, openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioProjectUrl, videoWatchUrl } from "../../platform/web-links";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card, ProBadge, Spinner } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { RenderPreview, renderStageOf } from "../../ui/RenderPreview";
import { useJobContext } from "../job/useTrackedJob";
import { useWorkingResume } from "../job/useWorkingResume";
import { NeedsResume } from "../resumes/NeedsResume";
import { OptionTiles } from "../video/OptionTiles";
import { FIT_BEATS, ScriptCard } from "../video/ScriptCard";
import { useSocialPublish } from "../video/useSocialPublish";
import { useVideoProject, type VideoSpec } from "../video/useVideoProject";
import { Destinations } from "./Destinations";
import { usePromotePost } from "./usePromotePost";

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
  const video = useVideoProject(spec);
  const social = useSocialPublish(video.project?.id ?? null, spec.name);
  const post = usePromotePost(video, social, resume?.id ?? null);
  const [copied, setCopied] = useState(false);
  const shareUrl = video.project ? videoWatchUrl(video.project.slug || video.project.id) : null;

  return (
    <>
      <ViewHeader
        title={t("promote_title")}
        subtitle={hasJob ? t("promote_fitSubtitle", { job: jobTitle }) : t("promote_resumeSubtitle")}
      />
      <div class="view-body">
        <NeedsResume />
        {resume ? (
          <>
            <div class="preview-row">
              <RenderPreview
                shape="vertical"
                playInline
                title={videoTitle(video.script, "")}
                stage={renderStageOf(video)}
                videoUrl={video.videoUrl}
                seconds={video.script?.video.duration ?? video.options.targetDuration}
              />
              <OptionTiles
                template={hasJob ? t("promote_templateFit") : t("promote_templateResume")}
                options={video.options}
                onChange={video.setOptions}
              />
            </div>

            {video.script ? (
              <ScriptCard script={video.script} beats={hasJob ? FIT_BEATS : undefined} aside={hasJob ? t("promote_fromResumeJd") : undefined}>
                <Button size="sm" busy={video.write.busy} onClick={() => void video.write.run()}>
                  {t("video_rewrite")}
                </Button>
              </ScriptCard>
            ) : (
              <Card>
                <p class="small">{t("video_intro")}</p>
                <Button variant="promote" block icon="video" busy={video.write.busy} onClick={() => void video.write.run()}>
                  {t("video_write")}
                </Button>
                {video.write.busy ? <Spinner label={t("video_writing")} /> : null}
              </Card>
            )}
            <ErrorNotice error={video.write.error} fallback="error_readPage" />

            {video.script ? (
              <Destinations
                social={social}
                checked={post.checked}
                onToggle={post.toggle}
                onResumePage={post.onResumePage}
                hasResume={!!resume}
              />
            ) : null}

            {post.waiting ? <Spinner label={t("video_watching")} /> : null}
            {video.videoUrl ? (
              <Card>
                <InfoNotice>{t("video_ready")}</InfoNotice>
                {shareUrl ? (
                  <Button block icon={copied ? "check" : "link"} onClick={() => void copyText(shareUrl).then(setCopied)}>
                    {copied ? t("common_copied") : t("video_copyLink")}
                  </Button>
                ) : null}
                {post.studioOnly.map((p) => (
                  <Button key={p} icon="external" onClick={() => openTab(studioProjectUrl(video.project!.id))}>
                    {t("promote_finishInStudio", { platform: socialPlatformMeta(p).label })}
                  </Button>
                ))}
              </Card>
            ) : null}
            <ErrorNotice error={post.postAll.error ?? video.openInStudio.error} />
          </>
        ) : null}
      </div>

      {resume && video.script ? (
        <footer class="view-footer">
          <div class="row small muted">
            <span class="grow">{t("promote_footnote")}</span>
            <ProBadge />
          </div>
          <div class="row">
            <Button busy={video.openInStudio.busy && !post.renderAndPost.busy} onClick={() => void video.openInStudio.run()}>
              {t("common_openStudio")}
            </Button>
            <Button
              variant="promote"
              block
              icon="video"
              busy={post.renderAndPost.busy || post.postAll.busy}
              disabled={!post.count || post.waiting}
              onClick={() => void post.renderAndPost.run()}
            >
              {t("promote_renderPost", { count: post.count })}
            </Button>
          </div>
        </footer>
      ) : null}
    </>
  );
}
