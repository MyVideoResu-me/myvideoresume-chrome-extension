/**
 * sidepanel-scraping-bundle.ts — bundles the shared scraping module so
 * sidepanel.js (which is a plain script, not an ES module) can call the
 * canonical `detectJobInPage` without re-implementing it.
 *
 * Bundled by scripts/build.js via esbuild into a plain IIFE. Loaded from
 * sidepanel-global.html BEFORE sidepanel.js. Exposes one entry point:
 *
 *   window.HiredVideoScraping.detectJobInPage(doc, currentUrl)
 *   window.HiredVideoScraping.{normalizeJobUrlForMatch, matchTrackedJob}
 *   window.HiredVideoAutofill.{extractResumeBasics, pickAutofillValue}
 *
 * This replaces what used to be a 75-line near-clone of detectJobInPage
 * living inside jobseeker/sidepanel.js — DRY rule, one source of truth
 * for site configs (LinkedIn, Indeed, amazon.jobs, …).
 */

import { detectJobInPage } from "../../hired.video/shared/scraping/index.js";
import { extractResumeBasics, pickAutofillValue } from "./autofill-matcher";
import { matchTrackedJob, normalizeJobUrlForMatch } from "./job-url-match";

declare global {
  interface Window {
    HiredVideoScraping?: {
      detectJobInPage: typeof detectJobInPage;
      normalizeJobUrlForMatch: typeof normalizeJobUrlForMatch;
      matchTrackedJob: typeof matchTrackedJob;
    };
    HiredVideoAutofill?: {
      extractResumeBasics: typeof extractResumeBasics;
      pickAutofillValue: typeof pickAutofillValue;
    };
  }
}

window.HiredVideoScraping = { detectJobInPage, normalizeJobUrlForMatch, matchTrackedJob };
window.HiredVideoAutofill = { extractResumeBasics, pickAutofillValue };
