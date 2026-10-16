/**
 * Read the relevant part of the active tab's HTML for the AI: the focused
 * job pane / profile pane when the content script can find it, otherwise
 * the cleaned full page (the service worker strips scripts + styles).
 */
import { sendToWorker } from "./chrome";

type HtmlReply = { html?: string | null; originUrl?: string } | undefined;

const FOCUSED_ACTION = { job: "getFocusedPaneHTML", profile: "getFocusedProfileHTML" } as const;

export async function capturePageHtml(kind: keyof typeof FOCUSED_ACTION): Promise<{ html: string; url: string } | null> {
  const focused = await sendToWorker<HtmlReply>({ action: FOCUSED_ACTION[kind] });
  if (focused?.html) return { html: focused.html, url: focused.originUrl ?? "" };
  const full = await sendToWorker<HtmlReply>({ action: "getHTML" });
  if (full?.html) return { html: full.html, url: full.originUrl ?? focused?.originUrl ?? "" };
  return null;
}
