/**
 * Post a rendered video to the person's own connected accounts. TikTok
 * needs its creator settings (privacy, duet, …) which only the Studio
 * publish sheet collects, so it routes to Studio instead.
 */
import { useEffect, useState } from "preact/hooks";
import { VIDEO_PUBLISH_PLATFORMS, type SocialPlatform } from "@shared/social-platforms";
import { connectUrl, fetchConnections, generateCaption, publishToPlatform, type SocialConnection } from "../../api/social";
import { openTab } from "../../platform/chrome";
import { useAction } from "../../ui/useAction";

export const STUDIO_ONLY_PLATFORMS: ReadonlySet<SocialPlatform> = new Set(["tiktok"]);

let connectionsCache: Promise<SocialConnection[]> | null = null;

function loadConnections(): Promise<SocialConnection[]> {
  if (!connectionsCache) {
    connectionsCache = fetchConnections();
    connectionsCache.catch(() => (connectionsCache = null));
  }
  return connectionsCache;
}

type PlatformState = "connected" | "notConnected" | "posted";

export function useSocialPublish(projectId: string | null, title: string) {
  const [connected, setConnected] = useState<ReadonlySet<SocialPlatform>>(new Set());
  const [posted, setPosted] = useState<ReadonlySet<SocialPlatform>>(new Set());

  useEffect(() => {
    const refresh = () =>
      void loadConnections()
        .then((list) => setConnected(new Set(list.filter((c) => c.status !== "revoked").map((c) => c.platform))))
        .catch(() => undefined);
    refresh();
    // Back in the panel after connecting an account in another tab → re-read.
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  const post = useAction(async (platform: SocialPlatform) => {
    if (!projectId) return;
    const cap = await generateCaption(projectId, platform).catch(() => null);
    const caption = [cap?.hook, cap?.caption, cap?.hashtags?.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ")]
      .filter(Boolean)
      .join("\n\n");
    await publishToPlatform(projectId, platform, { title, caption });
    setPosted((prev) => new Set(prev).add(platform));
  });

  const connect = useAction(async (platform: SocialPlatform) => {
    openTab(await connectUrl(platform, "/studio"));
    connectionsCache = null;
  });

  const stateOf = (p: SocialPlatform): PlatformState =>
    posted.has(p) ? "posted" : connected.has(p) ? "connected" : "notConnected";

  return { platforms: VIDEO_PUBLISH_PLATFORMS, stateOf, post, connect };
}
