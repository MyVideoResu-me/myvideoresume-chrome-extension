/**
 * Sales & social · Target + Promote: a short "promote your skills" video
 * made for the person on this profile, and a message carrying its link —
 * one action renders it and types the message into LinkedIn's box for the
 * person to send. One person at a time, under a daily cap.
 */
import { useEffect, useState } from "preact/hooks";
import type { DetectedProfile } from "../../domain/entities";
import { PITCH_DAILY_CAP } from "../../domain/outreach";
import { initialsOf } from "../../domain/profile-owner";
import { resumeToText } from "../../domain/resume-docs";
import { videoMeta, videoTitle } from "../../domain/video-meta";
import { t } from "../../platform/i18n";
import { videoWatchUrl } from "../../platform/web-links";
import { activeResume, resumeContent, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { Card, Eyebrow, Spinner } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { VideoCard, videoMetaLine } from "../../ui/RenderPreview";
import { ComposerActions } from "../message/ComposerActions";
import { ComposerCard } from "../message/ComposerCard";
import { RenderAndFillButton } from "../message/RenderAndFillButton";
import { useMessageComposer } from "../message/useComposeMessage";
import { useDailyCount } from "../message/useDailyCount";
import { useRenderAndFill } from "../message/useRenderAndFill";
import { useStickyEntity } from "../message/useStickyEntity";
import { NeedsResume } from "../resumes/NeedsResume";
import { pageKey, textKey } from "../../domain/video-reuse";
import { useVideoProject, type VideoSpec } from "../video/useVideoProject";
import { SkillPicker, useResumeSkills } from "./SkillPicker";
import { useProfileSignals } from "./useProfileSignals";

const PITCH_SECONDS = 40;

function ProspectFlow({ prospect }: { prospect: DetectedProfile }) {
  const resume = useStore(resumesStore, activeResume);
  const skills = useResumeSkills(resume?.id ?? null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const { signals, loading } = useProfileSignals(prospect);
  const sent = useDailyCount("pitch", PITCH_DAILY_CAP);

  useEffect(() => setPicked(skills.slice(0, 3)), [skills]);

  const featured = picked.join(", ");
  const about = signals.join("; ") || [prospect.title, prospect.company].filter(Boolean).join(", ");
  const spec: VideoSpec = {
    purpose: "pitch",
    name: t("prospect_videoName", { name: prospect.name }),
    // One pitch video per person.
    reuseKey: `pitch:${pageKey(prospect.sourceUrl) || textKey(`${prospect.name}|${prospect.company}`)}`,
    targetDuration: PITCH_SECONDS,
    source: async () => {
      if (!resume) throw new Error("no résumé");
      return {
        resumeText: resumeToText(await resumeContent(resume.id)),
        resumeId: resume.id,
        prompt: t("prospect_prompt", {
          name: prospect.name,
          title: prospect.title,
          company: prospect.company,
          skills: featured,
          signals: about,
        }),
      };
    },
  };
  const video = useVideoProject(spec);
  const link = video.project ? videoWatchUrl(video.project.slug || video.project.id) : null;
  const composer = useMessageComposer({
    channels: ["linkedinMessage", "linkedinNote", "email"],
    onDelivered: sent.increment,
    blocked: sent.reached,
    spec: {
      recipient: { name: prospect.name, title: prospect.title, company: prospect.company },
      tone: "friendly",
      link,
      context: t("prospect_context", {
        skills: featured,
        title: prospect.title,
        company: prospect.company,
        signals: about,
      }),
    },
  });
  const chain = useRenderAndFill(video, composer, prospect.sourceUrl);
  const rendered = !!video.videoUrl;

  return (
    <>
      <div class="view-body">
        <NeedsResume />
        <Card>
          <div class="detected-row">
            <span class="avatar-lg avatar-promote" aria-hidden="true">
              {initialsOf(prospect.name)}
            </span>
            <div class="detected-text">
              <div class="detected-title">{prospect.name}</div>
              <div class="muted small">{[prospect.title, prospect.company].filter(Boolean).join(" · ")}</div>
            </div>
            <span class="muted small">{t("prospect_badge")}</span>
          </div>
          <div class="signals">
            <div class="muted small">{t("prospect_signals")}</div>
            {loading ? <Spinner label={t("prospect_reading")} /> : null}
            {signals.map((s) => (
              <div key={s} class="signal">
                {s}
              </div>
            ))}
          </div>
        </Card>
        {resume ? (
          <>
            <Eyebrow>{t("prospect_skills")}</Eyebrow>
            <SkillPicker skills={skills} picked={picked} onChange={setPicked} />
            <VideoCard
              title={videoTitle(video.script, spec.name)}
              meta={videoMetaLine(videoMeta(video.script, PITCH_SECONDS))}
            >
              {video.project && !rendered ? (
                <button type="button" class="link-btn small" onClick={() => void video.openInStudio.run()}>
                  {t("video_openAgain")}
                </button>
              ) : null}
            </VideoCard>
            <ComposerCard composer={composer} />
            <p class="muted small row">
              <Icon name="clock" />
              {t("prospect_sentOfCap", { count: sent.count, cap: PITCH_DAILY_CAP })}
            </p>
          </>
        ) : null}
      </div>
      {resume ? (
        <ComposerActions
          composer={composer}
          note={t("prospect_youSend")}
          primary={
            rendered && !chain.pending ? undefined : (
              <RenderAndFillButton chain={chain} labelKey="prospect_renderAndFill" disabled={sent.reached} />
            )
          }
        />
      ) : null}
    </>
  );
}

export function ProspectView() {
  const prospect = useStickyEntity("profile");
  if (!prospect) {
    return <EmptyView title={t("prospect_title")}>{t("prospect_needProfile")}</EmptyView>;
  }
  return (
    <>
      <ViewHeader title={t("prospect_title")} subtitle={t("prospect_for", { name: prospect.name })} />
      <ProspectFlow key={prospect.sourceUrl} prospect={prospect} />
    </>
  );
}
