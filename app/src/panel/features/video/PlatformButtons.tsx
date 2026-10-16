/**
 * "Post to" — one button per social platform: post when connected, connect
 * when not, done when posted, finish in Studio for Studio-only platforms.
 * Used by the candidate video's public step.
 */
import { socialPlatformMeta } from "@shared/social-platforms";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioProjectUrl } from "../../platform/web-links";
import { Button } from "../../ui/controls";
import { STUDIO_ONLY_PLATFORMS, type useSocialPublish } from "./useSocialPublish";

export function PlatformButtons({ social, projectId }: { social: ReturnType<typeof useSocialPublish>; projectId: string }) {
  return (
    <div class="platforms">
      {social.platforms.map((p) => {
        const label = socialPlatformMeta(p).label;
        const state = social.stateOf(p);
        if (STUDIO_ONLY_PLATFORMS.has(p))
          return (
            <Button key={p} size="sm" icon="external" onClick={() => openTab(studioProjectUrl(projectId))}>
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
  );
}
