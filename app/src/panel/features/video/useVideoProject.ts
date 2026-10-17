/**
 * One video from a source text: write the script (storyboard), save it as
 * a Studio project, then watch the project until the web Studio has
 * rendered it (the API has no server render — rendering runs in the
 * browser there). Every video flow in the panel goes through this.
 *
 * One project per target: a flow names its target (`reuseKey`), and running
 * it again for the same target updates the project it made last time
 * (state/video-project-ids) instead of forking a copy.
 */
import { useEffect, useState } from "preact/hooks";
import type { StudioPurpose } from "@shared/studio-purposes";
import type { StudioSubject } from "@shared/studio-subject";
import { ApiError } from "../../api/http";
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
import { studioProjectUrl, studioRenderUrl } from "../../platform/web-links";
import { rememberProjectId, rememberedProjectId } from "../../state/video-project-ids";
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
  /**
   * What this video is for (e.g. `promote:job:<page>`, `pitch:<profile>`):
   * a re-run for the same key updates the same project. Lazy when the key
   * needs something saved first (a candidate's talent-pool id); resolved
   * after `subjects`.
   */
  reuseKey: string | (() => Promise<string>);
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

/** How Studio opens: to edit, or rendering the video straight away. */
export type StudioOpen = { render?: boolean };

const POLL_MS = 6000;

/** What the person can pick before the script is written (only what the storyboard API takes). */
export type VideoOptions = { targetDuration: number; motion: VideoMotion };

/** The remembered project is gone or no longer this account's to write. */
const isStale = (err: unknown): boolean => err instanceof ApiError && (err.status === 404 || err.status === 403);

export function useVideoProject(spec: VideoSpec) {
  const [options, setOptions] = useState<VideoOptions>({ targetDuration: spec.targetDuration, motion: "moderate" });
  const [script, setScript] = useState<VideoScript | null>(null);
  const [source, setSource] = useState<VideoSource | null>(null);
  const [project, setProject] = useState<StudioProject | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  /** A reused project's render from before this script — not "the render". */
  const [staleRender, setStaleRender] = useState<string | null>(null);

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

  /** Save the script into this target's project — the one made last time, else a new one. */
  const save = async (current: VideoScript, src: VideoSource): Promise<StudioProject> => {
    const subjects = spec.subjects ? await spec.subjects() : undefined;
    const draft = {
      name: spec.name,
      resumeText: src.resumeText,
      script: current,
      purpose: spec.purpose,
      prompt: src.prompt,
      jobDescription: src.jobDescription,
      subjects,
    };
    const reuseKey = typeof spec.reuseKey === "string" ? spec.reuseKey : await spec.reuseKey();
    const known = await rememberedProjectId(reuseKey);
    let saved: StudioProject | null = null;
    if (known) {
      saved = await saveDraft({ ...draft, projectId: known, timelineSpec: null }).catch((err) => {
        if (isStale(err)) return null;
        throw err;
      });
    }
    saved ??= await saveDraft(draft);
    await rememberProjectId(reuseKey, saved.id);
    // Its existing render shows the old script; wait for a new one. A failed
    // read must stop here — guessing "no render" would take the old one as new.
    setStaleRender((await fetchProjectStatus(saved.id)).renderUrl ?? null);
    return saved;
  };

  const openInStudio = useAction(async (how: StudioOpen = {}) => {
    if (!script || !source) return;
    let current = project;
    if (!current) {
      current = await save(script, source);
      if (spec.unlisted) await setProjectVisibility(current.id, false);
      setProject(current);
    }
    openTab(how.render ? studioRenderUrl(current.id) : studioProjectUrl(current.id));
  });

  // Watch for the render to land (the Studio tab renders it).
  useEffect(() => {
    if (!project || videoUrl) return;
    let stopped = false;
    const tick = async () => {
      const status = await fetchProjectStatus(project.id).catch(() => null);
      if (!stopped && status?.renderUrl && status.renderUrl !== staleRender) setVideoUrl(status.renderUrl);
    };
    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [project, videoUrl, staleRender]);

  return { script, project, videoUrl, write, openInStudio, options, setOptions };
}
