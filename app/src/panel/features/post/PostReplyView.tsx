/**
 * Sales & social · Target + Promote: reply to the post on this page with a
 * short video made for it, and a reply that carries its link — typed into
 * the reply box for the person to post.
 */
import { useState } from "preact/hooks";
import { resumeToText } from "../../domain/resume-docs";
import { pageStore } from "../../state/page";
import { activeResume, resumeContent, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { t, type MessageKey } from "../../platform/i18n";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { Eyebrow } from "../../ui/controls";
import { MessageComposer } from "../message/MessageComposer";
import { NeedsResume } from "../resumes/NeedsResume";
import { VideoBuilder } from "../video/VideoBuilder";
import type { VideoSpec } from "../video/useVideoProject";

/** Reply angles — data; the prompt text is localized with the label. */
const ANGLES = [
  { id: "show", labelKey: "reply_angleShow", hintKey: "reply_angleShow_hint" },
  { id: "flip", labelKey: "reply_angleFlip", hintKey: "reply_angleFlip_hint" },
  { id: "tip", labelKey: "reply_angleTip", hintKey: "reply_angleTip_hint" },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; hintKey: MessageKey }>;

type AngleId = (typeof ANGLES)[number]["id"];

export function PostReplyView() {
  const post = useStore(pageStore, (s) => (s.entity?.kind === "post" ? s.entity : null));
  const resume = useStore(resumesStore, activeResume);
  const [angleId, setAngleId] = useState<AngleId>("show");
  const [link, setLink] = useState<string | null>(null);

  if (!post) {
    return <EmptyView title={t("reply_title")}>{t("reply_needPost")}</EmptyView>;
  }

  const angle = ANGLES.find((a) => a.id === angleId) ?? ANGLES[0];
  const angleText = `${t(angle.labelKey)}: ${t(angle.hintKey)}`;
  const spec: VideoSpec = {
    purpose: "personal_brand",
    name: t("reply_videoName", { author: post.author || t("post_unknownAuthor") }),
    targetDuration: 30,
    source: async () => {
      if (!resume) throw new Error("no résumé");
      return {
        resumeText: resumeToText(await resumeContent(resume.id)),
        resumeId: resume.id,
        prompt: t("reply_prompt", { post: post.text.slice(0, 300), angle: angleText }),
      };
    },
  };

  return (
    <>
      <ViewHeader title={t("reply_title")} subtitle={post.author || undefined} />
      <div class="view-body">
        <NeedsResume />
        <Eyebrow>{t("reply_post")}</Eyebrow>
        <blockquote class="post-quote">
          {post.author ? <div class="strong small">{post.author}</div> : null}
          <p>{post.text.slice(0, 600)}</p>
        </blockquote>

        <fieldset class="stack-sm">
          <legend class="strong">{t("reply_angle")}</legend>
          {ANGLES.map((a) => (
            <label key={a.id} class={`radio-card ${a.id === angleId ? "on" : ""}`}>
              <input type="radio" name="reply-angle" checked={a.id === angleId} onChange={() => setAngleId(a.id)} />
              <span>
                <b>{t(a.labelKey)}</b>
                <small>{t(a.hintKey)}</small>
              </span>
            </label>
          ))}
        </fieldset>

        {resume ? (
          <>
            <VideoBuilder key={angleId} spec={spec} onShareUrl={setLink} />
            <MessageComposer
              channels={["reply"]}
              spec={{
                recipient: { name: post.author || t("post_unknownAuthor") },
                tone: "friendly",
                link,
                context: t("reply_context", { post: post.text.slice(0, 1200), angle: angleText }),
              }}
            />
          </>
        ) : null}
      </div>
    </>
  );
}
