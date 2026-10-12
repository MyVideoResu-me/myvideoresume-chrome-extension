/**
 * sidepanel-scraping-bundle.ts — bundles the shared scraping module so
 * sidepanel.js (which is a plain script, not an ES module) can call the
 * canonical `detectJobInPage` without re-implementing it.
 *
 * Bundled by scripts/build.js via esbuild into a plain IIFE. Loaded from
 * sidepanel-global.html BEFORE sidepanel.js. Exposes one entry point:
 *
 *   window.HiredVideoScraping.detectJobInPage(doc, currentUrl)
 *
 * This replaces what used to be a 75-line near-clone of detectJobInPage
 * living inside jobseeker/sidepanel.js — DRY rule, one source of truth
 * for site configs (LinkedIn, Indeed, amazon.jobs, …).
 */

import { detectJobInPage } from "../../hired.video/shared/scraping/index.js";

declare global {
  interface Window {
    HiredVideoScraping?: {
      detectJobInPage: typeof detectJobInPage;
    };
  }
}

window.HiredVideoScraping = { detectJobInPage };
