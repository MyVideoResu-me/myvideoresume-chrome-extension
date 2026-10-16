/**
 * One action for "Render the video & fill the message box": write the script
 * and the message, save the project and open Studio to render it, then —
 * once the render lands and the person is back on the page the flow started
 * on — type the message (with the watch link) into the page's box. Each step
 * runs from an effect on the latest state, so nothing reads a stale closure.
 * It fills; it never sends.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { samePage } from "../../domain/page-match";
import { activeTabUrl, onTabActivated } from "../../platform/chrome";
import type { useVideoProject } from "../video/useVideoProject";
import type { Composer } from "./useComposeMessage";

type VideoProject = ReturnType<typeof useVideoProject>;

export type ChainStage = "idle" | "writing" | "saving" | "rendering" | "backToPage" | "filling";

export function useRenderAndFill(video: VideoProject, composer: Composer, pageUrl: string | null) {
  const [pending, setPending] = useState(false);
  const [onPage, setOnPage] = useState<boolean | null>(null);
  const tried = useRef({ script: false, message: false, studio: false, fill: false });

  const stop = () => setPending(false);

  const start = () => {
    tried.current = { script: false, message: false, studio: false, fill: false };
    setOnPage(null);
    setPending(true);
  };

  // Steps 1–3: script + message (in parallel), then save + open Studio.
  useEffect(() => {
    if (!pending) return;
    const t = tried.current;
    if (!video.script && !video.write.busy) {
      if (t.script) return stop();
      t.script = true;
      void video.write.run();
    }
    if (!composer.body && !composer.write.busy) {
      if (t.message) return stop();
      t.message = true;
      void composer.write.run();
    }
    if (!video.script || !composer.body || video.project || video.openInStudio.busy) return;
    if (t.studio) return stop();
    t.studio = true;
    void video.openInStudio.run();
  }, [pending, video.script, video.write.busy, composer.body, composer.write.busy, video.project, video.openInStudio.busy]);

  // Step 4: the render landed → fill, but only on the page the flow is for.
  const ready = pending && !!video.videoUrl;
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const check = async () => {
      const here = samePage(await activeTabUrl(), pageUrl);
      if (!live) return;
      setOnPage(here);
      if (!here || tried.current.fill) return;
      tried.current.fill = true;
      // deliver is the one hand-over gate: it refuses past the daily cap or
      // the channel's character limit, and the footer shows why.
      await composer.deliver.run();
      if (live) stop();
    };
    void check();
    const off = onTabActivated(() => void check());
    window.addEventListener("focus", check);
    return () => {
      live = false;
      off();
      window.removeEventListener("focus", check);
    };
  }, [ready, pageUrl]);

  let stage: ChainStage = "idle";
  if (pending) {
    if (!video.script || !composer.body) stage = "writing";
    else if (!video.project) stage = "saving";
    else if (!video.videoUrl) stage = "rendering";
    else stage = onPage === false ? "backToPage" : "filling";
  }

  return { start, stop, pending, stage };
}

export type RenderAndFill = ReturnType<typeof useRenderAndFill>;
