/** Deep links into the hired.video web app (one place for every route the panel opens). */
import { publicVideoPath } from "@shared/public-paths";
import { webUrl } from "./config";

export const studioResumeUrl = (resumeId: string): string => webUrl(`/studio/resume/${encodeURIComponent(resumeId)}`);

export const studioProjectUrl = (projectId: string): string => webUrl(`/studio/${encodeURIComponent(projectId)}`);

/** The public watch page for a video (works once it has rendered). */
export const videoWatchUrl = (slugOrId: string): string => webUrl(publicVideoPath(slugOrId));
