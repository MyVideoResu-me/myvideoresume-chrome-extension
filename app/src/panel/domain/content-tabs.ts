/**
 * "My content" tabs as data: what each is called, its icon, and which
 * lenses see it. A new kind of content = a new entry here + its screen in
 * features/content/ContentView.
 */
import type { MessageKey } from "../platform/i18n";
import type { IconName } from "../ui/Icon";
import type { LensId } from "./lenses";
import { CONTENT_TABS, type ContentTab } from "./routes";

export type ContentTabDef = { labelKey: MessageKey; icon: IconName; lenses?: readonly LensId[] };

export const CONTENT_TAB: Record<ContentTab, ContentTabDef> = {
  resumes: { labelKey: "content_tab_resumes", icon: "file" },
  letters: { labelKey: "content_tab_letters", icon: "message" },
  videos: { labelKey: "content_tab_videos", icon: "video" },
  jobs: { labelKey: "content_tab_jobs", icon: "briefcase" },
  candidates: { labelKey: "content_tab_candidates", icon: "users", lenses: ["recruiter"] },
};

/** The tabs a lens shows, in order. */
export function contentTabsFor(lens: LensId): ContentTab[] {
  return CONTENT_TABS.filter((id) => !CONTENT_TAB[id].lenses || CONTENT_TAB[id].lenses!.includes(lens));
}

/** Where "My content" opens for a lens. */
export function defaultContentTab(lens: LensId): ContentTab {
  return lens === "recruiter" ? "candidates" : "resumes";
}
