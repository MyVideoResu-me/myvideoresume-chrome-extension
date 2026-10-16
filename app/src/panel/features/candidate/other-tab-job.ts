/**
 * "Use job from another tab": ask the person's other open tabs whether they
 * show a job posting (the job content script answers `detectJob` with its
 * detection), then capture the first one into their jobs. Tabs without the
 * content script simply don't answer.
 */
import { extractJob, type Job } from "../../api/jobs";
import { isOwnSite, toDetectedJob, type DetectedJob } from "../../domain/entities";

export class NoJobInTabsError extends Error {}

const MAX_HTML = 400_000;

function tabMessage<T>(tabId: number, message: Record<string, unknown>): Promise<T | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) resolve(undefined);
        else resolve(response as T);
      });
    } catch {
      resolve(undefined);
    }
  });
}

async function findJobInOtherTabs(): Promise<{ tabId: number; job: DetectedJob } | null> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  const candidates = tabs.filter(
    (tab): tab is chrome.tabs.Tab & { id: number; url: string } =>
      tab.id !== undefined && !tab.active && !!tab.url && /^https?:/.test(tab.url) && !isOwnSite(tab.url),
  );
  const found = await Promise.all(
    candidates.map(async (tab) => {
      const payload = await tabMessage<Record<string, unknown> | null>(tab.id, { action: "detectJob" });
      return { tabId: tab.id, job: toDetectedJob(payload) };
    }),
  );
  const hit = found.find((f): f is { tabId: number; job: DetectedJob } => !!f.job);
  return hit ?? null;
}

type HtmlReply = { html?: string | null } | undefined;

export async function captureJobFromOtherTab(): Promise<Job> {
  const found = await findJobInOtherTabs();
  if (!found) throw new NoJobInTabsError();
  const focused = await tabMessage<HtmlReply>(found.tabId, { action: "getFocusedPaneHTML" });
  const html = focused?.html || (await tabMessage<HtmlReply>(found.tabId, { action: "getHTML" }))?.html;
  if (!html) throw new NoJobInTabsError();
  const { job } = found;
  return extractJob({
    html: html.slice(0, MAX_HTML),
    sourceUrl: job.sourceUrl,
    track: true,
    hints: { title: job.title, company: job.company, location: job.location },
  });
}
