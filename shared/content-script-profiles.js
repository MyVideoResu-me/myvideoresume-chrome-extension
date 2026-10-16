/**
 * hired.video Chrome Extension - Profile Auto-Detection
 *
 * Shared by the recruiter extension and the unified app (recruiter +
 * sales lenses).
 *
 * Watches the active page for candidate profiles on LinkedIn, Indeed, etc.
 * When detected, sends a `profileDetected` message to the service worker
 * which forwards it to the side panel.
 *
 * Follows the same pattern as content-script-jobs.js — cheap on non-profile
 * pages, bails immediately when no selectors match.
 *
 * Selectors + focused-pane finders live in shared/profile-parsers.js
 * (PROFILE_SITE_PARSERS, FOCUSED_PROFILE_FINDERS, findFocusedProfilePane).
 * The recruiter manifest must load that file before this one.
 */

// ---- Profile detection --------------------------------------------------

let lastDetectedProfileKey = null;
let lastDetectedListCount = 0;

/** Read the profile in the focused pane, or null when the page has none. */
function readProfileOnPage() {
  // Guard: only run on known profile hosts
  const host = window.location.hostname.toLowerCase();
  let siteParser = null;

  if (typeof PROFILE_SITE_PARSERS === 'undefined') return null;

  for (const [name, config] of Object.entries(PROFILE_SITE_PARSERS)) {
    if (config.hostPatterns.some((p) => host.includes(p))) {
      // Check URL pattern too
      if (config.urlPatterns && config.urlPatterns.length > 0) {
        const url = window.location.pathname;
        if (!config.urlPatterns.some((pattern) => pattern.test(url))) continue;
      }
      siteParser = config;
      break;
    }
  }

  if (!siteParser) return null;

  // Try to find the profile pane
  const focused = findFocusedProfilePane();
  if (!focused) return null;

  const name = pickText(focused.el, siteParser.nameSelectors);
  if (!name) return null;

  return {
    name: name.slice(0, 250),
    title: pickText(focused.el, siteParser.titleSelectors),
    company: pickText(focused.el, siteParser.companySelectors),
    location: pickText(focused.el, siteParser.locationSelectors),
    sourceUrl: window.location.href,
    hasFocusedPane: true,
  };
}

function detectProfileOnPage() {
  const payload = readProfileOnPage();
  if (!payload) return false;
  notifyProfileDetected(payload);
  return true;
}

function notifyProfileDetected(payload) {
  const key = `${payload.name}|${payload.sourceUrl}`;
  if (key === lastDetectedProfileKey) return;
  lastDetectedProfileKey = key;
  chrome.runtime
    .sendMessage({ action: 'profileDetected', payload })
    .catch(() => {
      // Side panel may not be open — ignore.
    });
  // In-page pill (unified app only) — see shared/detection-bus.ts.
  if (typeof window.__hiredVideoDetected === 'function') window.__hiredVideoDetected('profile', payload);
}

// Detect search-result list views (LinkedIn / Indeed / GitHub) and tell
// the side panel how many candidate cards are visible — the bulk
// "Capture all" affordance reads this. Gap #1358.
function detectListViewOnPage() {
  if (typeof findListProfileCards !== 'function') return;
  const { host, cards } = findListProfileCards();
  if (!host || cards.length === 0) {
    if (lastDetectedListCount !== 0) {
      lastDetectedListCount = 0;
      chrome.runtime.sendMessage({ action: 'listViewCleared' }).catch(() => {});
    }
    return;
  }
  if (cards.length === lastDetectedListCount) return;
  lastDetectedListCount = cards.length;
  chrome.runtime
    .sendMessage({
      action: 'listViewDetected',
      payload: { host, count: cards.length, sourceUrl: window.location.href },
    })
    .catch(() => {});
}

// Side-panel request (via the service worker's forwardToActiveTab): the
// panel opened after the page loaded, so it asks for the current profile
// instead of waiting for the next change.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action !== 'detectProfile') return false;
  sendResponse({ payload: readProfileOnPage(), originUrl: window.location.href });
  return false;
});

// Service-worker request: return outerHTML for every list card on the
// page so the recruiter extension can batch-extract them.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action !== 'getListCardsHTML') return false;
  if (typeof findListProfileCards !== 'function') {
    sendResponse({ cards: [], originUrl: window.location.href });
    return false;
  }
  const { cards } = findListProfileCards();
  const limit = Math.max(1, Math.min(msg.limit || 25, 50));
  sendResponse({
    cards: cards.slice(0, limit).map((el) => el.outerHTML),
    originUrl: window.location.href,
  });
  return false;
});

// ---- Lifecycle ----------------------------------------------------------

function scheduleProfileDetect() {
  setTimeout(detectProfileOnPage, 600);
  setTimeout(detectProfileOnPage, 1800);
  setTimeout(detectProfileOnPage, 3500);
  setTimeout(detectListViewOnPage, 800);
  setTimeout(detectListViewOnPage, 2000);
  setTimeout(detectListViewOnPage, 4000);
}
scheduleProfileDetect();

const profileDetectObserver = new MutationObserver(() => {
  if (profileDetectObserver._pending) return;
  profileDetectObserver._pending = true;
  setTimeout(() => {
    profileDetectObserver._pending = false;
    detectProfileOnPage();
    detectListViewOnPage();
  }, 2000);
});
profileDetectObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

// Re-detect on URL change (SPAs). The job content script already
// monitors pushState/replaceState — we just need to re-trigger.
window.addEventListener('popstate', () => {
  lastDetectedProfileKey = null;
  scheduleProfileDetect();
});

// `getFocusedProfileHTML` is now handled by shared/content-script-self-profile.js,
// which both the recruiter side panel and the seeker /tools/vendor-sync flow use.
