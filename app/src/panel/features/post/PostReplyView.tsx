/**
 * Sales & social · Target + Promote: reply to the post on this page with a
 * short video made for it, and a reply that carries its link — one action
 * renders it and types the reply into the reply box for the person to post.
 */
import { useState } from "preact/hooks";
import { isSocialPlatform, socialPlatformMeta } from "@shared/social-platforms";
import type { DetectedPost } from "../../domain/entities";
import { initialsOf } from "../../domain/profile-owner";
import { resumeToText } from "../../domain/resume-docs";
import { videoMeta } from "../../domain/video-meta";
import { t, type MessageKey } from "../../platform/i18n";
import { videoWatchUrl } from "../../platform/web-links";
import { activeResume, resumeContent, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { Eyebrow } from "../../ui/controls";
import { RadioCards } from "../../ui/RadioCards";
import { VideoCard, videoMetaLine } from "../../ui/RenderPreview";
import { ComposerActions } from "../message/ComposerActions";
import { ComposerCard } from "../message/ComposerCard";
import { RenderAndFillButton } from "../message/RenderAndFillButton";
import { useMessageComposer } from "../message/useComposeMessage";
import { useRenderAndFill } from "../message/useRenderAndFill";
import { useStickyEntity } from "../message/useStickyEntity";
import { NeedsResume } from "../resumes/NeedsResume";
import { pageKey, textKey } from "../../domain/video-reuse";
import { useVideoProject, type VideoSpec } from "../video/useVideoProject";

/** Reply angles — data; the prompt text is localized with the label. */
const ANGLES = [
  { id: "show", labelKey: "reply_angleShow", hintKey: "reply_angleShow_hint" },
  { id: "flip", labelKey: "reply_angleFlip", hintKey: "reply_angleFlip_hint" },
  { id: "tip", labelKey: "reply_angleTip", hintKey: "reply_angleTip_hint" },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; hintKey: MessageKey }>;

type AngleId = (typeof ANGLES)[number]["id"];

const REPLY_SECONDS = 30;

function ReplyFlow({ post, angleId }: { post: DetectedPost; angleId: AngleId }) {
  const resume = useStore(resumesStore, activeResume);
  const author = post.author || t("post_unknownAuthor");
  const angle = ANGLES.find((a) => a.id === angleId) ?? ANGLES[0];
  const angleText = `${t(angle.labelKey)}: ${t(angle.hintKey)}`;
  const spec: VideoSpec = {
    purpose: "personal_brand",
    name: t("reply_videoName", { author }),
    // One reply video per post: its page plus its text (a picked selection
    // carries the feed's URL, shared by every post on it).
    reuseKey: `reply:${pageKey(post.sourceUrl)}:${textKey(post.text)}`,
    targetDuration: REPLY_SECONDS,
    source: async () => {
      if (!resume) throw new Error("no résumé");
      return {
        resumeText: resumeToText(await resumeContent(resume.id)),
        resumeId: resume.id,
        prompt: t("reply_prompt", { post: post.text.slice(0, 300), angle: angleText }),
      };
    },
  };
  const video = useVideoProject(spec);
  const link = video.project ? videoWatchUrl(video.project.slug || video.project.id) : null;
  const composer = useMessageComposer({
    channels: ["reply"],
    spec: {
      recipient: { name: author },
      tone: "friendly",
      link,
      context: t("reply_context", { post: post.text.slice(0, 1200), angle: angleText }),
    },
  });
  const chain = useRenderAndFill(video, composer, post.sourceUrl);
  const rendered = !!video.videoUrl;

  if (!resume) return null;
  return (
    <>
      <div class="view-body view-body-tail">
        <VideoCard square title={videoMetaLine(videoMeta(video.script, REPLY_SECONDS))} meta={t("reply_opensWith", { author })}>
          {video.project && !rendered ? (
            <button type="button" class="link-btn small" onClick={() => void video.openInStudio.run()}>
              {t("video_openAgain")}
            </button>
          ) : null}
        </VideoCard>
        <ComposerCard composer={composer} label={t("reply_text")} />
      </div>
      <ComposerActions
        composer={composer}
        note={t("reply_youSend")}
        primary={rendered && !chain.pending ? undefined : <RenderAndFillButton chain={chain} labelKey="reply_renderAndFill" />}
      />
    </>
  );
}

export function PostReplyView() {
  const post = useStickyEntity("post");
  const [angleId, setAngleId] = useState<AngleId>("show");

  if (!post) {
    return <EmptyView title={t("reply_title")}>{t("reply_needPost")}</EmptyView>;
  }

  const platform = isSocialPlatform(post.platform) ? socialPlatformMeta(post.platform).label : "";
  return (
    <>
      <ViewHeader title={t("reply_title")} subtitle={post.author || undefined} />
      <div class="view-body view-body-head">
        <NeedsResume />
        <Eyebrow>{t("reply_post")}</Eyebrow>
        <blockquote class="post-quote">
          <div class="row post-author">
            <span class="avatar-sm" aria-hidden="true">
              {initialsOf(post.author) || "·"}
            </span>
            <span class="strong small">{post.author || t("post_unknownAuthor")}</span>
            {platform ? <span class="muted small">· {platform}</span> : null}
          </div>
          <p>{post.text.slice(0, 600)}</p>
        </blockquote>

        <RadioCards
          name="reply-angle"
          legend={t("reply_angle")}
          value={angleId}
          options={ANGLES.map((a) => ({ value: a.id, label: t(a.labelKey), hint: t(a.hintKey) }))}
          onChange={setAngleId}
        />
      </div>
      {/* A new angle is a new video + reply. */}
      <ReplyFlow key={`${post.sourceUrl}|${angleId}`} post={post} angleId={angleId} />
    </>
  );
}
