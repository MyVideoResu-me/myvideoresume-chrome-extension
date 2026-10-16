/**
 * What a video flow is making, before and after Studio renders it:
 *   RenderPreview — a large preview with where the render is (script →
 *                   rendering in Studio → ready). Studio reports no render
 *                   percentage, so "rendering" is an indeterminate bar.
 *                   `playInline` plays a rendered file right in the panel
 *                   (the Promote 9:16 preview); `seconds` adds the length.
 *   VideoCard     — a compact thumbnail + title + "Square · 30s · captions on".
 */
import type { ComponentChildren } from "preact";
import type { VideoMeta } from "../domain/video-meta";
import { t, type MessageKey } from "../platform/i18n";
import { Icon } from "./Icon";

export type RenderStage = "none" | "script" | "rendering" | "ready";

const STAGE: Record<RenderStage, { labelKey: MessageKey; progress: number | null }> = {
  none: { labelKey: "render_none", progress: 0 },
  script: { labelKey: "render_script", progress: 33 },
  rendering: { labelKey: "render_rendering", progress: null },
  ready: { labelKey: "render_ready", progress: 100 },
};

export function renderStageOf(video: { script: unknown; project: unknown; videoUrl: string | null }): RenderStage {
  if (video.videoUrl) return "ready";
  if (video.project) return "rendering";
  return video.script ? "script" : "none";
}

export function videoMetaLine(meta: VideoMeta): string {
  return [
    meta.aspectKey ? t(meta.aspectKey) : null,
    t("videoMeta_seconds", { seconds: meta.seconds }),
    meta.captions ? t("videoMeta_captions") : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** YouTube and other watch pages can't play in a <video>; files can. */
const isFileUrl = (url: string): boolean => !/youtu\.?be/i.test(url);

function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function RenderPreview({
  title,
  stage,
  videoUrl,
  shape = "landscape",
  seconds,
  playInline = false,
}: {
  title: string;
  stage: RenderStage;
  videoUrl?: string | null;
  shape?: "landscape" | "square" | "vertical";
  /** The video's length, shown under the title. */
  seconds?: number;
  /** Play the rendered file in place instead of linking out. */
  playInline?: boolean;
}) {
  const s = STAGE[stage];
  const label = [title, t(s.labelKey)].filter(Boolean).join(" · ");
  if (playInline && stage === "ready" && videoUrl && isFileUrl(videoUrl)) {
    return (
      <video
        class={`render-preview render-video render-${shape}`}
        src={videoUrl}
        controls
        playsInline
        preload="metadata"
        aria-label={label}
      />
    );
  }
  return (
    <div class={`render-preview render-${shape}`} role="img" aria-label={label}>
      <span class="render-chip">{t(s.labelKey)}</span>
      {stage === "ready" && videoUrl ? (
        <a class="render-play" href={videoUrl} target="_blank" rel="noreferrer" aria-label={t("render_watch")}>
          <Icon name="play" size={18} />
        </a>
      ) : (
        <span class="render-play" aria-hidden="true">
          <Icon name="video" size={18} />
        </span>
      )}
      {title ? <span class="render-title">{title}</span> : null}
      {seconds != null ? <span class="render-time">{t("video_previewTime", { time: clock(seconds) })}</span> : null}
      <span class={`render-bar ${s.progress == null ? "render-bar-busy" : ""}`} aria-hidden="true">
        <span style={s.progress == null ? undefined : { width: `${s.progress}%` }} />
      </span>
    </div>
  );
}

export function VideoCard({
  title,
  meta,
  square = false,
  children,
}: {
  title: string;
  meta: string;
  square?: boolean;
  /** Extra line(s) under the meta. */
  children?: ComponentChildren;
}) {
  return (
    <div class="video-card">
      <span class={`video-thumb ${square ? "video-thumb-square" : ""}`} aria-hidden="true">
        <Icon name="play" size={16} />
      </span>
      <div class="video-card-text">
        <b>{title}</b>
        <span class="muted small">{meta}</span>
        {children}
      </div>
    </div>
  );
}
