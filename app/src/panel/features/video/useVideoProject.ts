/**
 * One video from a source text: write the script (storyboard), save it as
 * a Studio project, then watch the project until the web Studio has
 * rendered it (the API has no server render — rendering runs in the
 * browser there). Every video flow in the panel goes through this.
 */
import { useEffect, useState } from "preact/hooks";
import type { StudioPurpose } from "@shared/studio-purposes";
import type { StudioSubject } from "@shared/studio-subject";
import {
  fetchProjectStatus,
  generateStoryboard,
  saveDraft,
  setProjectVisibility,
  type StudioProject,
  type VideoMotion,
  type VideoScript,
} from "../../api/studio";
import { openTab } from "../../platform/chrome";
import { studioProjectUrl } from "../../platform/web-links";
import { useAction } from "../../ui/useAction";

export type VideoSource = {
  resumeText: string;
  jobDescription?: string;
  prompt?: string;
  resumeId?: string;
};

export type VideoSpec = {
  purpose: StudioPurpose;
  /** Project name shown in Studio. */
  name: string;
  targetDuration: number;
  /** Unlisted from the start (candidate videos). */
  unlisted?: boolean;
  /** Built lazily — may track a job or read a résumé. */
  source: () => Promise<VideoSource>;
  /**
   * What the project is about, linked when it is created (never after), so
   * any server rule tied to a subject applies from the start. Resolved
   * lazily — it may save something first; a throw stops the creation.
   */
  subjects?: () => Promise<readonly StudioSubject[]>;
};

const POLL_MS = 6000;

/** What the person can pick before the script is written (only what the storyboard API takes). */
export type VideoOptions = { targetDuration: number; motion: VideoMotion };

export function useVideoProject(spec: VideoSpec) {
  const [options, setOptions] = useState<VideoOptions>({ targetDuration: spec.targetDuration, motion: "moderate" });
  const [script, setScript] = useState<VideoScript | null>(null);
  const [source, setSource] = useState<VideoSource | null>(null);
  const [project, setProject] = useState<StudioProject | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const write = useAction(async () => {
    const src = await spec.source();
    setSource(src);
    setScript(
      await generateStoryboard({
        resumeText: src.resumeText,
        jobDescription: src.jobDescription,
        prompt: src.prompt,
        resumeId: src.resumeId,
        purpose: spec.purpose,
        targetDuration: options.targetDuration,
        motion: options.motion,
      }),
    );
    setProject(null);
    setVideoUrl(null);
  });

  const openInStudio = useAction(async () => {
    if (!script || !source) return;
    let current = project;
    if (!current) {
      const subjects = spec.subjects ? await spec.subjects() : undefined;
      current = await saveDraft({
        name: spec.name,
        resumeText: source.resumeText,
        script,
        purpose: spec.purpose,
        prompt: source.prompt,
        jobDescription: source.jobDescription,
        subjects,
      });
      if (spec.unlisted) await setProjectVisibility(current.id, false);
      setProject(current);
    }
    openTab(studioProjectUrl(current.id));
  });

  // Watch for the render to land (the person renders in the Studio tab).
  useEffect(() => {
    if (!project || videoUrl) return;
    let stopped = false;
    const tick = async () => {
      const status = await fetchProjectStatus(project.id).catch(() => null);
      if (!stopped && status?.videoUrl) setVideoUrl(status.videoUrl);
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [project, videoUrl]);

  return { script, project, videoUrl, write, openInStudio, options, setOptions };
}
