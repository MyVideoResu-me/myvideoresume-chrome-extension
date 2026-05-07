/**
 * hired.video Chrome Extension - Profile Auto-Detection (Recruiter)
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

function detectProfileOnPage() {
  // Guard: only run on known profile hosts
  const host = window.location.hostname.toLowerCase();
  let siteName = null;
  let siteParser = null;

  if (typeof PROFILE_SITE_PARSERS === 'undefined') return false;

  for (const [name, config] of Object.entries(PROFILE_SITE_PARSERS)) {
    if (config.hostPatterns.some((p) => host.includes(p))) {
      // Check URL pattern too
      if (config.urlPatterns && config.urlPatterns.length > 0) {
        const url = window.location.pathname;
        if (!config.urlPatterns.some((pattern) => pattern.test(url))) continue;
      }
      siteName = name;
      siteParser = config;
      break;
    }
  }

  if (!siteParser) return false;

  // Try to find the profile pane
  const focused = findFocusedProfilePane();
  if (!focused) return false;

  const name = pickText(focused.el, siteParser.nameSelectors);
  if (!name) return false;

  const title = pickText(focused.el, siteParser.titleSelectors);
  const company = pickText(focused.el, siteParser.companySelectors);
  const location = pickText(focused.el, siteParser.locationSelectors);

  notifyProfileDetected({
    name: name.slice(0, 250),
    title,
    company,
    location,
    sourceUrl: window.location.href,
    hasFocusedPane: true,
  });
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
}

// ---- Lifecycle ----------------------------------------------------------

function scheduleProfileDetect() {
  setTimeout(detectProfileOnPage, 600);
  setTimeout(detectProfileOnPage, 1800);
  setTimeout(detectProfileOnPage, 3500);
}
scheduleProfileDetect();

const profileDetectObserver = new MutationObserver(() => {
  if (profileDetectObserver._pending) return;
  profileDetectObserver._pending = true;
  setTimeout(() => {
    profileDetectObserver._pending = false;
    detectProfileOnPage();
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
