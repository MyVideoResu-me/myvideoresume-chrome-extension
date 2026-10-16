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
import type { PickerResult } from "../platform/picker";
import { recordEvent, saveLearnedSelectors } from "../platform/telemetry";
import { settingsStore } from "./settings";
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

/** The person corrected what the detector read ("Fix details" before tracking). */
export function correctDetectedJob(details: { title: string; company: string; location: string }): void {
  const entity = pageStore.get().entity;
  if (entity?.kind === "job") pageStore.set({ entity: { ...entity, ...details } });
}

/** Fallback for posts we can't detect: the text the person selected. */
export async function takeSelectionAsPost(): Promise<boolean> {
  const sel = await sendToWorker<{ ok: boolean; text?: string; url?: string }>({ action: "readSelection" });
  const entity = toDetectedPost(sel?.ok ? { text: sel.text, sourceUrl: sel.url, author: "", platform: "" } : null);
  if (!entity) return false;
  pageStore.set({ entity });
  return true;
}

/** A manual picker capture becomes the page's job / profile. */
function acceptPickerResult(result: PickerResult | undefined): void {
  if (!result?.fields) return;
  const f = (k: string) => result.fields[k]?.value ?? "";
  saveLearnedSelectors(result.host, result.mode, result.fields);
  recordEvent("picker_capture", result.sourceUrl, { mode: result.mode, fields: result.fields });
  if (result.mode === "job") {
    accept(
      toDetectedJob({
        title: f("title"),
        company: f("company"),
        location: f("location"),
        sourceUrl: result.sourceUrl,
        applyUrl: f("applyUrl") || result.sourceUrl,
      }),
    );
  } else if (result.mode === "profile") {
    accept(
      toDetectedProfile({
        name: f("name"),
        title: f("title"),
        company: f("company"),
        location: f("location"),
        sourceUrl: result.sourceUrl,
      }),
    );
  }
}

let started = false;

export function startPageWatch(): void {
  if (started) return;
  started = true;
  void scanPage();
  // Auto-detect off → only the panel's "Scan again" reads the page.
  const detecting = () => settingsStore.get().settings.autoDetect;
  const autoScan = () => {
    if (detecting()) void scanPage();
  };
  onTabActivated(autoScan);
  onRuntimeMessage((msg) => {
    const payload = msg.payload as Record<string, unknown> | undefined;
    switch (msg.action) {
      case "jobDetected":
        if (!detecting()) break;
        accept(toDetectedJob(payload));
        break;
      case "profileDetected":
        if (!detecting()) break;
        accept(toDetectedProfile(payload));
        break;
      case "postDetected":
        if (!detecting()) break;
        accept(toDetectedPost(payload));
        break;
      case "postCleared":
        if (pageStore.get().entity?.kind === "post") pageStore.set({ entity: null });
        break;
      case "urlChanged":
        autoScan();
        break;
      case "pickerResult":
        acceptPickerResult(msg.result as PickerResult | undefined);
        break;
    }
  });
}
