/** Social: the person's connected accounts and posting a finished video. */
import { request } from "./http";
import type { SocialPlatform } from "@shared/social-platforms";

export type SocialConnection = {
  platform: SocialPlatform;
  handle: string | null;
  status: string;
};

export async function fetchConnections(): Promise<SocialConnection[]> {
  const out = await request<{ connections?: SocialConnection[] }>("/api/social/connections", {
    query: { workspace: "personal" },
  });
  return out.connections ?? [];
}

export function generateCaption(
  projectId: string,
  platform: SocialPlatform,
): Promise<{ caption?: string; hook?: string; hashtags?: string[] }> {
  return request("/api/studio/social/generate-caption", {
    method: "POST",
    body: { projectId, platforms: [platform] },
  });
}

export function publishToPlatform(
  projectId: string,
  platform: SocialPlatform,
  input: { title: string; caption: string },
): Promise<{ publication: unknown }> {
  return request(
    `/api/studio/projects/${encodeURIComponent(projectId)}/publish/social/${platform}`,
    { method: "POST", body: { title: input.title.slice(0, 100), caption: input.caption.slice(0, 5000) } },
  );
}

/** OAuth start URL to connect a platform; we open it in a tab. */
export async function connectUrl(platform: SocialPlatform, redirectTo: string): Promise<string> {
  const out = await request<{ url: string }>(`/api/social/${platform}/auth-url`, { query: { redirectTo } });
  return out.url;
}
