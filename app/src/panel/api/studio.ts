/**
 * Studio: turn a résumé (+ a job, a prospect, or a post) into a video
 * script and save it as a Studio project. Rendering happens in the
 * browser in the web Studio — the API has no server-side render — so
 * the panel opens the project there and watches its status.
 */
import { request } from "./http";
import type { StudioPurpose } from "@shared/studio-purposes";

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

export type StoryboardInput = {
  resumeText: string;
  purpose: StudioPurpose;
  targetDuration: number;
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
  name: string;
  resumeText: string;
  script: VideoScript;
  purpose: StudioPurpose;
  prompt?: string;
  jobDescription?: string;
}): Promise<StudioProject> {
  return request<StudioProject>("/api/studio/save-draft", { method: "POST", body: input });
}

export type ProjectStatus = {
  id: string;
  /** Draft | Processing | Publishing | Completed | Failed (mapStudioStatus). */
  status: string;
  videoUrl: string | null;
};

export function fetchProjectStatus(projectId: string): Promise<ProjectStatus> {
  return request<ProjectStatus>(`/api/studio/status/${encodeURIComponent(projectId)}`);
}

/** false = unlisted: only people with the link can watch. */
export function setProjectVisibility(projectId: string, isPublic: boolean): Promise<unknown> {
  return request(`/api/studio/projects/${encodeURIComponent(projectId)}/visibility`, {
    method: "PATCH",
    body: { isPublic },
  });
}
