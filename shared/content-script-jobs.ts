/**
 * content-script-jobs.ts — Chrome extension content script for job
 * detection.
 *
 * DI-oriented split: all pure business logic (JSON-LD parsing, URL
 * canonicalization, apply-button scoring, site-specific selectors) now
 * lives in hired.video/shared/scraping/ and is imported from here. This
 * file handles ONLY the Chrome APIs + DOM lifecycle:
 *
 *   - Mutation observers for SPA navigation.
 *   - popstate / pushState / click interceptors on LinkedIn sidebar cards.
 *   - chrome.runtime.sendMessage for jobDetected / urlChanged.
 *   - chrome.runtime.onMessage for getHTML / detectJob / getFocusedPaneHTML.
 *
 * Everything else is delegated. That means when behaviour diverges
 * between the API (server-side HTML parse) and the extension (live DOM),
 * we fix it in ONE place and both are covered by the same test suite.
 *
 * Bundled by scripts/build.js via esbuild into plain IIFE JS — the
 * manifest content_scripts.js entry points at the bundled output.
 */

import {
  cleansePageHTML,
  canonicalizeJobUrl,
  detectJobInPage,
  scoreApplyCandidates,
  JOB_CONTENT_READY_SELECTORS,
  looksLikeJobUrl,
  type DetectedJob,
} from "../../hired.video/shared/scraping/index.js";

// Idempotency guard — see original .js file for rationale (manifest
// injection + service-worker programmatic injection can race).
(function hiredVideoJobsContentScript() {
  const SENTINEL = "__HIRED_VIDEO_JOBS_CS_LOADED__";
  const w = window as unknown as Record<string, unknown>;
  if (w[SENTINEL]) return;
  w[SENTINEL] = true;

  // -------------------------------------------------------------------------
  // Skip-host guard — never run detection on hired.video itself (the tools
  // page has cards called "Resume Optimizer" etc that the generic extractor
  // would surface as fake job titles).
  // -------------------------------------------------------------------------
  const JOBSEEKER_SKIP_HOSTS = new Set([
    "hired.video",
    "www.hired.video",
    "localhost",
    "127.0.0.1",
  ]);
  const SKIP_DETECTION = JOBSEEKER_SKIP_HOSTS.has(window.location.hostname);

  // -------------------------------------------------------------------------
  // Page HTML capture — cleanses scripts/styles/noise before upload.
  // -------------------------------------------------------------------------
  function getPageHTML(): string {
    return cleansePageHTML(document.documentElement.outerHTML);
  }

  // -------------------------------------------------------------------------
  // Wait for job content to load on SPAs before capturing HTML.
  // -------------------------------------------------------------------------
  function waitForContent(timeout = 3000): Promise<string> {
    return new Promise((resolve) => {
      const checkContent = () => {
        for (const selector of JOB_CONTENT_READY_SELECTORS) {
          const el = document.querySelector(selector);
          if (el && (el.innerHTML || "").trim().length > 50) return true;
        }
        const jsonLd = document.querySelector('script[type="application/ld+json"]');
        if (jsonLd && (jsonLd.textContent || "").includes("JobPosting")) return true;
        return false;
      };

      if (checkContent()) {
        resolve(getPageHTML());
        return;
      }

      let resolved = false;
      const observer = new MutationObserver(() => {
        if (!resolved && checkContent()) {
          resolved = true;
          observer.disconnect();
          setTimeout(() => resolve(getPageHTML()), 100);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve(getPageHTML());
        }
      }, timeout);
    });
  }

  // -------------------------------------------------------------------------
  // Detection loop — run the shared detector, push to side panel when
  // the result changes.
  // -------------------------------------------------------------------------

  let lastDetectedKey: string | null = null;
  let lastDetectedPayload: DetectedJob | null = null;

  function notifyJobDetected(payload: DetectedJob) {
    const key = `${payload.title}|${payload.sourceUrl}`;
    if (key === lastDetectedKey) return;
    lastDetectedKey = key;
    lastDetectedPayload = payload;
    try {
      (window as any).__hiredVideoFocusedPaneHtml = payload.focusedPaneHtml || null;
    } catch {
      // cross-origin restriction — ignore
    }
    const msg = {
      action: "jobDetected",
      payload: {
        title: payload.title,
        company: payload.company,
        location: payload.location,
        sourceUrl: payload.sourceUrl,
        applyUrl: payload.applyUrl,
        hasFocusedPane: !!payload.focusedPaneHtml,
      },
    };
    try {
      // chrome.runtime.sendMessage returns a promise that rejects when
      // no listener is attached (sidepanel closed). Swallow.
      (chrome.runtime.sendMessage(msg) as any)?.catch?.(() => {});
    } catch {
      /* ignore */
    }
  }

  function detectJobOnPage(): boolean {
    if (SKIP_DETECTION) return false;
    // Cheap pre-check — skip work entirely on pages that obviously aren't
    // job listings (LinkedIn feed, profile, messaging, etc).
    if (!looksLikeJobUrl(window.location.href)) {
      // Exception: employer career pages with a generic domain. Fall
      // through to the detector, which will return null if nothing found.
    }
    const detected = detectJobInPage(document as any, window.location.href);
    if (!detected) {
      try {
        delete (window as any).__hiredVideoFocusedPaneHtml;
      } catch {
        /* ignore */
      }
      return false;
    }
    notifyJobDetected(detected);
    return true;
  }

  function scheduleDetect() {
    setTimeout(detectJobOnPage, 500);
    setTimeout(detectJobOnPage, 1500);
    setTimeout(detectJobOnPage, 3000);
  }

  if (!SKIP_DETECTION) {
    scheduleDetect();

    // Throttle: re-detect at most once every 1.5s on DOM mutations.
    let pending = false;
    const observer = new MutationObserver(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => {
        pending = false;
        detectJobOnPage();
      }, 1500);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // -------------------------------------------------------------------------
  // URL-change detection for SPA navigation (LinkedIn, Indeed, etc).
  // -------------------------------------------------------------------------

  let lastUrl = window.location.href;

  function notifyUrlChange() {
    const currentUrl = window.location.href;
    if (currentUrl === lastUrl) return;
    lastUrl = currentUrl;
    lastDetectedKey = null;
    try {
      (chrome.runtime.sendMessage({ action: "urlChanged", url: currentUrl }) as any)?.catch?.(() => {});
    } catch {
      /* ignore */
    }
    scheduleDetect();
  }

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args: Parameters<typeof history.pushState>) {
    origPushState.apply(this, args);
    notifyUrlChange();
  };
  history.replaceState = function (...args: Parameters<typeof history.replaceState>) {
    origReplaceState.apply(this, args);
    notifyUrlChange();
  };
  window.addEventListener("popstate", notifyUrlChange);
  setInterval(notifyUrlChange, 1000);

  // LinkedIn-specific: clicking a card in the left rail swaps the right
  // pane in place without a URL change. Catch those clicks and kick a
  // re-detect.
  document.addEventListener(
    "click",
    (e) => {
      const host = window.location.hostname.toLowerCase();
      if (!host.includes("linkedin.com")) return;
      const target = e.target as Element | null;
      if (!target || !target.closest) return;
      const card = target.closest(
        ".job-card-container--clickable, .job-card-list__entity-lockup, .job-card-job-posting-card-wrapper, [data-job-id]",
      );
      if (!card) return;
      lastDetectedKey = null;
      lastDetectedPayload = null;
      setTimeout(detectJobOnPage, 300);
      setTimeout(detectJobOnPage, 900);
      setTimeout(detectJobOnPage, 2000);
    },
    true,
  );

  // -------------------------------------------------------------------------
  // Message handler — side panel ↔ content script contract.
  // -------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "getHTML") {
      waitForContent(request.timeout || 3000).then((html) => {
        sendResponse({ html, originUrl: canonicalizeJobUrl(window.location.href) });
      });
      return true;
    }

    if (request.action === "ping") {
      sendResponse({ status: "ready", url: canonicalizeJobUrl(window.location.href) });
      return true;
    }

    if (request.action === "detectJob") {
      if (SKIP_DETECTION) {
        sendResponse(null);
        return true;
      }
      lastDetectedKey = null;
      lastDetectedPayload = null;
      detectJobOnPage();
      sendResponse(lastDetectedPayload);
      return true;
    }

    if (request.action === "getFocusedPaneHTML") {
      if (SKIP_DETECTION) {
        sendResponse({ html: null, originUrl: canonicalizeJobUrl(window.location.href) });
        return true;
      }
      try {
        delete (window as any).__hiredVideoFocusedPaneHtml;
      } catch {
        /* ignore */
      }
      detectJobOnPage();
      const html = (window as any).__hiredVideoFocusedPaneHtml || null;
      sendResponse({ html, originUrl: canonicalizeJobUrl(window.location.href) });
      return true;
    }

    // Debug-only: expose the apply-URL scorer so QA can see WHY the
    // extension picked a given apply link on any page. Used by the side
    // panel's "Why this apply URL?" debugging panel.
    if (request.action === "debugApplyCandidates") {
      const ranked = scoreApplyCandidates(document.documentElement.outerHTML, window.location.href);
      sendResponse({ candidates: ranked });
      return true;
    }

    return true;
  });
})();
