/**
 * hired.video Chrome Extension - Company Auto-Detection (Recruiter)
 *
 * Watches the active page for company/business pages on LinkedIn,
 * Glassdoor, etc. When detected, sends a `companyDetected` message
 * to the service worker which forwards it to the side panel.
 *
 * Loaded AFTER constants.js and constants-recruiter.js so
 * COMPANY_SITE_PARSERS and related objects are available.
 */

// ---- Company detection --------------------------------------------------

let lastDetectedCompanyKey = null;

const FOCUSED_COMPANY_FINDERS = {
  'linkedin.com': () => {
    if (!/\/company\/[^/]+/.test(window.location.pathname)) return null;
    return (
      document.querySelector('.org-top-card') ||
      document.querySelector('.scaffold-layout__main') ||
      null
    );
  },
  'glassdoor.com': () => {
    if (!/\/Overview\//.test(window.location.pathname)) return null;
    return (
      document.querySelector('[data-test="employer-overview"]') ||
      document.querySelector('.employer-overview') ||
      null
    );
  },
};

function findFocusedCompanyPane() {
  const host = window.location.hostname.toLowerCase();
  for (const [pattern, finder] of Object.entries(FOCUSED_COMPANY_FINDERS)) {
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

function detectCompanyOnPage() {
  const host = window.location.hostname.toLowerCase();
  let siteName = null;
  let siteParser = null;

  if (typeof COMPANY_SITE_PARSERS === 'undefined') return false;

  for (const [name, config] of Object.entries(COMPANY_SITE_PARSERS)) {
    if (config.hostPatterns.some((p) => host.includes(p))) {
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

  const focused = findFocusedCompanyPane();
  if (!focused) return false;

  const name = pickText(focused.el, siteParser.nameSelectors);
  if (!name) return false;

  const industry = pickText(focused.el, siteParser.industrySelectors || []);
  const size = pickText(focused.el, siteParser.sizeSelectors || []);
  const location = pickText(focused.el, siteParser.locationSelectors || []);

  // Try to get website URL
  let website = '';
  for (const sel of (siteParser.websiteSelectors || [])) {
    try {
      const el = focused.el.querySelector(sel);
      if (el) {
        website = el.href || el.textContent?.trim() || '';
        if (website) break;
      }
    } catch (e) { /* ignore */ }
  }

  // Stash the company pane HTML for extraction
  try {
    window.__hiredVideoFocusedCompanyHtml = focused.el.outerHTML;
  } catch (e) {
    // cross-origin restriction
  }

  notifyCompanyDetected({
    name: name.slice(0, 250),
    industry,
    size,
    location,
    website,
    sourceUrl: window.location.href,
    hasFocusedPane: true,
  });
  return true;
}

function notifyCompanyDetected(payload) {
  const key = `${payload.name}|${payload.sourceUrl}`;
  if (key === lastDetectedCompanyKey) return;
  lastDetectedCompanyKey = key;
  chrome.runtime
    .sendMessage({ action: 'companyDetected', payload })
    .catch(() => {
      // Side panel may not be open — ignore.
    });
}

// ---- Lifecycle ----------------------------------------------------------

function scheduleCompanyDetect() {
  setTimeout(detectCompanyOnPage, 700);
  setTimeout(detectCompanyOnPage, 2000);
  setTimeout(detectCompanyOnPage, 4000);
}
scheduleCompanyDetect();

const companyDetectObserver = new MutationObserver(() => {
  if (companyDetectObserver._pending) return;
  companyDetectObserver._pending = true;
  setTimeout(() => {
    companyDetectObserver._pending = false;
    detectCompanyOnPage();
  }, 2000);
});
companyDetectObserver.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

window.addEventListener('popstate', () => {
  lastDetectedCompanyKey = null;
  scheduleCompanyDetect();
});

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getFocusedCompanyHTML') {
    detectCompanyOnPage();
    const html = window.__hiredVideoFocusedCompanyHtml || null;
    sendResponse({
      html,
      originUrl: window.location.href,
    });
    return true;
  }
  return false;
});
