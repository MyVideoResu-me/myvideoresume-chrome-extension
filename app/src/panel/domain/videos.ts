/** The person's videos as the panel lists them. Pure. */
import type { StudioProjectItem } from "../api/studio";
import type { MessageKey } from "../platform/i18n";
import { matchesQuery, newestFirst } from "./search";

export const VIDEO_STATUS_LABEL: Record<string, MessageKey> = {
  Draft: "videoStatus_draft",
  Processing: "videoStatus_rendering",
  Publishing: "videoStatus_rendering",
  Completed: "videoStatus_ready",
  Failed: "videoStatus_failed",
};

/** Video projects only (the Studio also makes podcasts, images, …), newest first. */
export function listVideos(projects: readonly StudioProjectItem[], query = ""): StudioProjectItem[] {
  return projects
    .filter((p) => p.mediaKind === "video" && matchesQuery(query, p.title))
    .sort(newestFirst((p: StudioProjectItem) => p.updatedAt));
}

/** A finished video has somewhere to watch it. */
export const canWatch = (p: StudioProjectItem): boolean => p.status === "Completed" && !!p.videoUrl;
