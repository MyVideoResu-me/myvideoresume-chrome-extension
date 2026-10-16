/**
 * The profile on the active tab as résumé content: the visible text of the
 * profile pane → POST /api/resumes/parse (nothing is saved). Cached per
 * profile URL for the panel session — the prospect pitch and the profile
 * compare read the same page once.
 */
import type { ResumeContent } from "@shared/resume";
import { parseProfileText } from "../../api/profile-import";
import { capturePageHtml } from "../../platform/page-html";

export class NoProfileTextError extends Error {}

const MAX_TEXT = 30_000;
const NOISE = "script, style, noscript, svg, template, iframe, button, nav, footer";
const BLOCKS = "br, p, div, li, section, article, header, h1, h2, h3, h4, h5, h6, tr, dd, dt";

/** Visible text of an HTML fragment, one block per line. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(NOISE).forEach((el) => el.remove());
  doc.querySelectorAll(BLOCKS).forEach((el) => el.append("\n"));
  return (doc.body?.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_TEXT);
}

const cache = new Map<string, Promise<ResumeContent>>();

/** The profile on the active tab, parsed (key = the profile's URL). */
export function readProfileContent(sourceUrl: string): Promise<ResumeContent> {
  let hit = cache.get(sourceUrl);
  if (!hit) {
    hit = (async () => {
      const page = await capturePageHtml("profile");
      const text = page ? htmlToText(page.html) : "";
      if (!text) throw new NoProfileTextError();
      return parseProfileText(text);
    })();
    hit.catch(() => cache.delete(sourceUrl));
    cache.set(sourceUrl, hit);
  }
  return hit;
}
