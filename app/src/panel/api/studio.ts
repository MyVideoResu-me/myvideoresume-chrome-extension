/**
 * Studio: turn a résumé (+ a job, a prospect, or a post) into a video
 * script and save it as a Studio project. Rendering happens in the
 * browser in the web Studio — the API has no server-side render — so
 * the panel opens the project there and watches its status.
 */
import { request } from "./http";
import type { StudioPurpose } from "@shared/studio-purposes";
import type { StudioSubject } from "@shared/studio-subject";

export type VideoScene = {
  id: string;
  type: string;
  duration: number;
  title?: string;
  subtitle?: string;
  text?: string | string[];
  items?: string[];
  skills?: string[];
};

export type VideoScript = {
  video: { duration: number; aspect?: "16:9" | "9:16" | "1:1"; [k: string]: unknown };
  scenes: VideoScene[];
  [k: string]: unknown;
};

/** The storyboard's look (POST /api/studio/storyboard `motion`). */
export const VIDEO_MOTIONS = ["minimal", "moderate", "cinematic"] as const;
export type VideoMotion = (typeof VIDEO_MOTIONS)[number];

export type StoryboardInput = {
  resumeText: string;
  purpose: StudioPurpose;
  targetDuration: number;
  motion?: VideoMotion;
  prompt?: string;
  jobDescription?: string;
  resumeId?: string;
};

export function generateStoryboard(input: StoryboardInput): Promise<VideoScript> {
  return request<VideoScript>("/api/studio/storyboard", {
    method: "POST",
    body: {
      ...input,
      prompt: input.prompt?.slice(0, 500),
      jobDescription: input.jobDescription?.slice(0, 4000),
    },
  });
}

export type StudioProject = {
  id: string;
  title: string;
  status: string;
  videoUrl: string | null;
  slug: string | null;
};

export function saveDraft(input: {
  /** Update this project instead of creating one. */
  projectId?: string;
  /** null drops a timeline Studio saved earlier, so the new `script` is what
   *  the project shows (Studio prefers a saved timeline over the script). */
  timelineSpec?: null;
  name: string;
  resumeText: string;
  script: VideoScript;
  purpose: StudioPurpose;
  prompt?: string;
  jobDescription?: string;
  /** What the project is about, linked at creation (save-draft replaces the links when present). */
  subjects?: readonly StudioSubject[];
}): Promise<StudioProject> {
  return request<StudioProject>("/api/studio/save-draft", { method: "POST", body: input });
}

export type ProjectStatus = {
  id: string;
  /** Draft | Processing | Publishing | Completed | Failed (mapStudioStatus). */
  status: string;
  videoUrl: string | null;
  /** The hosted MP4 (null before the first render); new on every render. */
  renderUrl: string | null;
};

export function fetchProjectStatus(projectId: string): Promise<ProjectStatus> {
  return request<ProjectStatus>(`/api/studio/status/${encodeURIComponent(projectId)}`);
}

/** Link the project to what it is about (a résumé → it shows on that résumé's page). */
export function addProjectSubject(projectId: string, subject: StudioSubject): Promise<unknown> {
  return request(`/api/studio/projects/${encodeURIComponent(projectId)}/subjects`, {
    method: "POST",
    body: subject,
  });
}

/**
 * true = public: the watch link plays for everyone (the watch page serves
 * only public or published projects; no render needed). false = unlisted.
 * The server holds candidate videos until the candidate approves.
 */
export function setProjectVisibility(projectId: string, isPublic: boolean): Promise<unknown> {
  return request(`/api/studio/projects/${encodeURIComponent(projectId)}/visibility`, {
    method: "PATCH",
    body: { isPublic },
  });
}

/** A Studio project as a list shows it. */
export type StudioProjectItem = {
  id: string;
  title: string;
  /** Draft | Processing | Exported | Publishing | Completed | Published | Failed (mapStudioStatus). */
  status: string;
  mediaKind: string;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  slug: string | null;
  isPublic: boolean;
  updatedAt: string | null;
};

const LIST_FIELDS = "id,title,status,mediaKind,thumbnailUrl,videoUrl,slug,isPublic,updateDateTime";

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** The person's Studio projects (every workspace they can act in). */
export async function fetchStudioProjects(): Promise<StudioProjectItem[]> {
  const raw = await request<Array<Record<string, unknown>>>("/api/studio/projects", { query: { fields: LIST_FIELDS } });
  return (Array.isArray(raw) ? raw : []).map((p) => ({
    id: String(p.id ?? ""),
    title: strOrNull(p.title) ?? "",
    status: strOrNull(p.status) ?? "Draft",
    mediaKind: strOrNull(p.mediaKind) ?? "video",
    thumbnailUrl: strOrNull(p.thumbnailUrl),
    videoUrl: strOrNull(p.videoUrl),
    slug: strOrNull(p.slug),
    isPublic: p.isPublic === true,
    updatedAt: strOrNull(p.updateDateTime),
  })).filter((p) => p.id);
}
