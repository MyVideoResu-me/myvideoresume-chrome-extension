/**
 * Write the script → open in Studio to render → share/post. Used by every
 * video flow (why-I-fit, résumé, candidate-for-job, prospect pitch, post
 * reply); each passes a VideoSpec.
 */
import { useEffect, useState } from "preact/hooks";
import { socialPlatformMeta } from "@shared/social-platforms";
import { copyText, openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioProjectUrl, videoWatchUrl } from "../../platform/web-links";
import { Button, Card, Spinner } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { STUDIO_ONLY_PLATFORMS, useSocialPublish } from "./useSocialPublish";
import { useVideoProject, type VideoSpec } from "./useVideoProject";

function sceneLine(scene: { title?: string; subtitle?: string; text?: string | string[]; items?: string[] }): string {
  const text = Array.isArray(scene.text) ? scene.text.join(" ") : scene.text;
  return [scene.title, scene.subtitle, text, scene.items?.join(", ")].filter(Boolean).join(" — ");
}

/**
 * `shareOnly` hides social posting (unlisted candidate videos).
 * `onShareUrl` hands the watch link to a message composer as soon as the
 * project exists (it plays once the Studio render lands).
 */
export function VideoBuilder({
  spec,
  shareOnly = false,
  onShareUrl,
}: {
  spec: VideoSpec;
  shareOnly?: boolean;
  onShareUrl?: (url: string) => void;
}) {
  const video = useVideoProject(spec);
  const social = useSocialPublish(video.project?.id ?? null, spec.name);
  const [copied, setCopied] = useState(false);
  const shareUrl = video.project ? videoWatchUrl(video.project.slug || video.project.id) : null;
  useEffect(() => {
    if (shareUrl) onShareUrl?.(shareUrl);
  }, [shareUrl]);

  if (!video.script) {
    return (
      <Card>
        <p class="small">{t("video_intro")}</p>
        <Button variant="promote" block icon="video" busy={video.write.busy} onClick={() => void video.write.run()}>
          {t("video_write")}
        </Button>
        {video.write.busy ? <Spinner label={t("video_writing")} /> : null}
        <ErrorNotice error={video.write.error} fallback="error_readPage" />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <div class="row between">
          <span class="strong">{t("video_script")}</span>
          <span class="muted small">{t("video_seconds", { seconds: Math.round(video.script.video.duration) })}</span>
        </div>
        <ol class="scenes">
          {video.script.scenes.map((s, i) => (
            <li key={s.id || i}>
              <span class="scene-n">{i + 1}</span>
              <span class="small">{sceneLine(s) || s.type}</span>
            </li>
          ))}
        </ol>
        <Button size="sm" busy={video.write.busy} onClick={() => void video.write.run()}>
          {t("video_rewrite")}
        </Button>
      </Card>

      {video.videoUrl ? (
        <Card>
          <InfoNotice>{t("video_ready")}</InfoNotice>
          {shareUrl ? (
            <Button block icon={copied ? "check" : "link"} onClick={() => void copyText(shareUrl).then(setCopied)}>
              {copied ? t("common_copied") : t("video_copyLink")}
            </Button>
          ) : null}
          {shareOnly ? null : (
            <div class="stack-sm">
              <div class="strong">{t("video_postTo")}</div>
              <div class="platforms">
                {social.platforms.map((p) => {
                  const state = social.stateOf(p);
                  const label = socialPlatformMeta(p).label;
                  if (STUDIO_ONLY_PLATFORMS.has(p))
                    return (
                      <Button key={p} size="sm" icon="external" onClick={() => openTab(studioProjectUrl(video.project!.id))}>
                        {label}
                      </Button>
                    );
                  if (state === "posted")
                    return (
                      <Button key={p} size="sm" icon="check" disabled>
                        {label}
                      </Button>
                    );
                  return state === "connected" ? (
                    <Button key={p} size="sm" variant="promote" icon="share" busy={social.post.busy} onClick={() => void social.post.run(p)}>
                      {label}
                    </Button>
                  ) : (
                    <Button key={p} size="sm" icon="link" onClick={() => void social.connect.run(p)}>
                      {t("video_connect", { platform: label })}
                    </Button>
                  );
                })}
              </div>
              <ErrorNotice error={social.post.error ?? social.connect.error} />
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <p class="small">{video.project ? t("video_waiting") : t("video_renderInStudio")}</p>
          <Button variant="promote" block icon="video" busy={video.openInStudio.busy} onClick={() => void video.openInStudio.run()}>
            {video.project ? t("video_openAgain") : t("video_openStudio")}
          </Button>
          {video.project ? (
            <div class="muted small row">
              <span class="spinner" aria-hidden="true" />
              {t("video_watching")}
            </div>
          ) : null}
          <ErrorNotice error={video.openInStudio.error} />
        </Card>
      )}
      {video.project ? (
        <p class="muted small row">
          <Icon name="clock" />
          {t("video_rendersInBrowser")}
        </p>
      ) : null}
    </>
  );
}
