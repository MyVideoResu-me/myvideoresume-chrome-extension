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
 * Loaded AFTER constants.js and constants-recruiter.js so
 * PROFILE_SITE_PARSERS and related objects are available.
 */

// ---- Profile detection --------------------------------------------------

let lastDetectedProfileKey = null;

/**
 * Per-host profile pane finders. Returns the DOM container wrapping
 * the candidate's profile on the current page.
 */
const FOCUSED_PROFILE_FINDERS = {
  'linkedin.com': () => {
    // Only on /in/ profile pages
    if (!/\/in\/[^/]+/.test(window.location.pathname)) return null;
    return (
      document.querySelector('.scaffold-layout__main') ||
      document.querySelector('.pv-top-card')?.closest('main') ||
      null
    );
  },
  'indeed.com': () => {
    if (!/\/resumes?\//.test(window.location.pathname)) return null;
    return (
      document.querySelector('.resume-body') ||
      document.querySelector('#resume-body') ||
      null
    );
  },
};

function findFocusedProfilePane() {
  const host = window.location.hostname.toLowerCase();
  for (const [pattern, finder] of Object.entries(FOCUSED_PROFILE_FINDERS)) {
    if (host.includes(pattern)) {
      try {
        const el = finder();
        if (el) return { el, host: pattern };
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
}

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

  // Stash the profile pane HTML for extraction
  try {
    window.__hiredVideoFocusedProfileHtml = focused.el.outerHTML;
  } catch (e) {
    // cross-origin restriction
  }

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

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getFocusedProfileHTML') {
    detectProfileOnPage();
    const html = window.__hiredVideoFocusedProfileHtml || null;
    sendResponse({
      html,
      originUrl: window.location.href,
    });
    return true;
  }
  return false;
});
