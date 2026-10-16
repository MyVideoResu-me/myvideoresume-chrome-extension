/**
 * "Render & post to N": the person ticks where the video goes (their
 * connected accounts + their résumé page), presses once, Studio renders it
 * in their browser, and when the render lands we post it to each ticked
 * place. The press is the person's go-ahead for exactly those posts.
 * TikTok needs Studio's own publish sheet, so it is finished there.
 */
import { useEffect, useState } from "preact/hooks";
import type { SocialPlatform } from "@shared/social-platforms";
import { addProjectSubject, setProjectVisibility } from "../../api/studio";
import { useAction } from "../../ui/useAction";
import { STUDIO_ONLY_PLATFORMS, type useSocialPublish } from "../video/useSocialPublish";
import type { useVideoProject } from "../video/useVideoProject";

export const RESUME_PAGE = "resumePage";
export type Destination = SocialPlatform | typeof RESUME_PAGE;

type Video = ReturnType<typeof useVideoProject>;
type Social = ReturnType<typeof useSocialPublish>;

export function usePromotePost(video: Video, social: Social, resumeId: string | null) {
  const [checked, setChecked] = useState<ReadonlySet<Destination>>(new Set([RESUME_PAGE]));
  const [queued, setQueued] = useState<readonly Destination[] | null>(null);
  const [onResumePage, setOnResumePage] = useState(false);

  const toggle = (d: Destination) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });

  const postOne = async (d: Destination, projectId: string): Promise<void> => {
    if (d === RESUME_PAGE) {
      if (!resumeId) return;
      await addProjectSubject(projectId, { kind: "resume", id: resumeId });
      await setProjectVisibility(projectId, true);
      setOnResumePage(true);
    } else if (!STUDIO_ONLY_PLATFORMS.has(d) && social.stateOf(d) === "connected") {
      await social.publish(d);
    }
  };

  const postAll = useAction(async (targets: readonly Destination[]) => {
    const projectId = video.project?.id;
    if (!projectId) return;
    const failures: unknown[] = [];
    for (const d of targets) await postOne(d, projectId).catch((err) => failures.push(err));
    if (failures.length) throw failures[0];
  });

  /** Save + open Studio to render; the posts go out when the render lands. */
  const renderAndPost = useAction(async () => {
    setQueued([...checked]);
    await video.openInStudio.run();
  });

  useEffect(() => {
    if (!queued || !video.videoUrl || !video.project) return;
    const targets = queued;
    setQueued(null);
    void postAll.run(targets);
  }, [queued, video.videoUrl, video.project]);

  return {
    checked,
    toggle,
    count: checked.size,
    renderAndPost,
    postAll,
    /** Waiting for the render before posting. */
    waiting: !!queued,
    onResumePage,
    /** Ticked places that are finished in Studio (TikTok). */
    studioOnly: [...checked].filter((d): d is SocialPlatform => d !== RESUME_PAGE && STUDIO_ONLY_PLATFORMS.has(d)),
  };
}
