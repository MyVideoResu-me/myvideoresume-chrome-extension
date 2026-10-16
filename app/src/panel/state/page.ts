/**
 * What's on the active tab. Content scripts push detections
 * (jobDetected / profileDetected / postDetected); when the panel opens,
 * the tab changes, or the URL changes, we ask the tab directly.
 */
import { activeTabUrl, onRuntimeMessage, onTabActivated, sendToWorker } from "../platform/chrome";
import {
  isOwnSite,
  toDetectedJob,
  toDetectedPost,
  toDetectedProfile,
  type PageEntity,
} from "../domain/entities";
import { createStore } from "./store";

export type PageState = { entity: PageEntity | null; url: string | null; scanning: boolean };

export const pageStore = createStore<PageState>({ entity: null, url: null, scanning: false });

type DetectReply = { payload?: Record<string, unknown> | null } | undefined;

function accept(entity: PageEntity | null): void {
  if (entity && isOwnSite(entity.sourceUrl)) return;
  if (entity) pageStore.set({ entity });
}

/** Ask the active tab what it shows. Job beats profile beats post. */
export async function scanPage(): Promise<void> {
  const url = await activeTabUrl();
  pageStore.set({ url, entity: null, scanning: true });
  if (!url || isOwnSite(url) || url.startsWith("chrome")) {
    pageStore.set({ scanning: false });
    return;
  }
  const [job, profile, post] = await Promise.all([
    sendToWorker<DetectReply>({ action: "detectJob" }),
    sendToWorker<DetectReply>({ action: "detectProfile" }),
    sendToWorker<DetectReply>({ action: "detectPost" }),
  ]);
  const entity =
    toDetectedJob(job?.payload) ?? toDetectedProfile(profile?.payload) ?? toDetectedPost(post?.payload);
  pageStore.set({ scanning: false });
  accept(entity);
}

/** Fallback for posts we can't detect: the text the person selected. */
export async function takeSelectionAsPost(): Promise<boolean> {
  const sel = await sendToWorker<{ ok: boolean; text?: string; url?: string }>({ action: "readSelection" });
  const entity = toDetectedPost(sel?.ok ? { text: sel.text, sourceUrl: sel.url, author: "", platform: "" } : null);
  if (!entity) return false;
  pageStore.set({ entity });
  return true;
}

let started = false;

export function startPageWatch(): void {
  if (started) return;
  started = true;
  void scanPage();
  onTabActivated(() => void scanPage());
  onRuntimeMessage((msg) => {
    const payload = msg.payload as Record<string, unknown> | undefined;
    switch (msg.action) {
      case "jobDetected":
        accept(toDetectedJob(payload));
        break;
      case "profileDetected":
        accept(toDetectedProfile(payload));
        break;
      case "postDetected":
        accept(toDetectedPost(payload));
        break;
      case "postCleared":
        if (pageStore.get().entity?.kind === "post") pageStore.set({ entity: null });
        break;
      case "urlChanged":
        void scanPage();
        break;
    }
  });
}
