/** The person's videos as the panel lists them. Pure. */
import type { StudioProjectItem } from "../api/studio";
import type { MessageKey } from "../platform/i18n";
import { matchesQuery, newestFirst } from "./search";

export const VIDEO_STATUS_LABEL: Record<string, MessageKey> = {
  Draft: "videoStatus_draft",
  Processing: "videoStatus_rendering",
  Exported: "videoStatus_ready",
  Publishing: "videoStatus_rendering",
  Completed: "videoStatus_ready",
  Published: "videoStatus_published",
  Failed: "videoStatus_failed",
};

/** Its watch link plays — the watch page serves only published or public projects. */
export function isWatchable(project: Pick<StudioProjectItem, "status" | "isPublic">): boolean {
  return project.isPublic || project.status === "Published";
}

/** Video projects only (the Studio also makes podcasts, images, …), newest first. */
export function listVideos(projects: readonly StudioProjectItem[], query = ""): StudioProjectItem[] {
  return projects
    .filter((p) => p.mediaKind === "video" && matchesQuery(query, p.title))
    .sort(newestFirst((p: StudioProjectItem) => p.updatedAt));
}
