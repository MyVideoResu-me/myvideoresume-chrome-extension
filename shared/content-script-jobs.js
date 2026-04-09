// Function to get the HTML of the current page
function getPageHTML() {
  return document.documentElement.outerHTML;
}

// Function to wait for page content to be ready (handles SPAs)
function waitForContent(timeout = 3000) {
  return new Promise((resolve) => {
    // Common selectors that indicate job content is loaded
    const jobSelectors = [
      '.jobs-description__container',           // LinkedIn
      '#jobDescriptionText',                    // Indeed
      '.jobDescriptionContent',                 // Glassdoor
      '.job_description',                       // ZipRecruiter
      '[class*="job-description"]',             // Generic
      '[class*="jobDescription"]',              // Generic
      '[data-testid*="description"]',           // Various
      'script[type="application/ld+json"]'      // Structured data
    ];

    // Check if content is already there
    const checkContent = () => {
      for (const selector of jobSelectors) {
        const el = document.querySelector(selector);
        if (el && el.innerHTML && el.innerHTML.trim().length > 50) {
          return true;
        }
      }
      // Also check for JSON-LD with JobPosting
      const jsonLd = document.querySelector('script[type="application/ld+json"]');
      if (jsonLd && jsonLd.textContent.includes('JobPosting')) {
        return true;
      }
      return false;
    };

    if (checkContent()) {
      resolve(getPageHTML());
      return;
    }

    // Set up a MutationObserver to watch for changes
    let resolved = false;
    const observer = new MutationObserver(() => {
      if (!resolved && checkContent()) {
        resolved = true;
        observer.disconnect();
        // Small delay to ensure all content is rendered
        setTimeout(() => resolve(getPageHTML()), 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    // Timeout fallback
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve(getPageHTML());
      }
    }, timeout);
  });
}

// =====================================================================
// Job-page auto-detection
// =====================================================================
//
// Watches the active page for either a JSON-LD JobPosting block or a
// DOM container that matches one of the major job sites. When detected,
// pushes a `jobDetected` message with {title, company, location, sourceUrl}
// to the side panel so it can show the active-page banner with one-click
// Tailor & Save.
//
// Cheap on non-job pages: bails immediately when neither a JSON-LD nor
// a known site marker is present.

let lastDetectedKey = null;

/**
 * Per-host "focused pane" finders. Each entry returns the DOM container
 * that wraps a SINGLE job's details on that site — even when the rest
 * of the page is showing a job list / collection / search results.
 *
 * The order of selectors matters: most-specific (the right pane on a
 * collection page) before broadest (a single-job view). We deliberately
 * avoid `main`, `[role="main"]`, and `.scaffold-layout__detail` because
 * on LinkedIn collection URLs they include the LEFT rail (the job list).
 */
const FOCUSED_PANE_FINDERS = {
  'linkedin.com': () =>
    document.querySelector('.job-details-jobs-unified-top-card')?.closest('.jobs-search__job-details, .jobs-search__job-details--container, .jobs-details, .scaffold-layout__detail') ||
    document.querySelector('.jobs-search__job-details--container') ||
    document.querySelector('.jobs-search__job-details') ||
    document.querySelector('.job-view-layout') ||
    document.querySelector('.top-card-layout') ||
    null,
  'indeed.com': () =>
    document.querySelector('.jobsearch-JobComponent') ||
    document.querySelector('#viewJobSSRRoot') ||
    document.querySelector('.jobsearch-ViewJobLayout--embedded') ||
    document.querySelector('.jobsearch-RightPane') ||
    null,
  'glassdoor.com': () =>
    document.querySelector('[class*="JobDetails_jobDetails"]') ||
    document.querySelector('.JobDetails') ||
    document.querySelector('#JDCol') ||
    null,
  'ziprecruiter.com': () =>
    document.querySelector('.job_details') ||
    document.querySelector('#job_desc') ||
    null,
};

/**
 * Per-host title selectors to query INSIDE the focused pane. Skip
 * generic `h1` because on collection pages the page-level h1 is
 * the list name ("Jobs where you'd be a top applicant"), not the
 * focused job's title.
 */
const FOCUSED_TITLE_SELECTORS = {
  'linkedin.com': [
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    '.top-card-layout__title',
    'h1',
  ],
  'indeed.com': [
    '[data-testid="jobsearch-JobInfoHeader-title"]',
    '.jobsearch-JobInfoHeader-title',
    'h1',
  ],
  'glassdoor.com': [
    '[data-test="job-title"]',
    '.JobDetails_jobTitle__',
    'h1',
  ],
  'ziprecruiter.com': [
    '.job_title',
    '.t_job_title',
    'h1',
  ],
};

const FOCUSED_COMPANY_SELECTORS = {
  'linkedin.com': [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name a',
    '.topcard__org-name-link',
  ],
  'indeed.com': [
    '[data-testid="inlineHeader-companyName"]',
    '[data-testid="jobsearch-JobInfoHeader-companyName"]',
    '.jobsearch-CompanyInfoContainer a',
  ],
  'glassdoor.com': [
    '[data-test="employer-name"]',
    '.EmployerProfile_employerName__',
  ],
  'ziprecruiter.com': [
    '.hiring_company_text',
    '.t_org_link',
  ],
};

const FOCUSED_LOCATION_SELECTORS = {
  'linkedin.com': [
    '.job-details-jobs-unified-top-card__bullet',
    '.job-details-jobs-unified-top-card__primary-description-container',
    '.jobs-unified-top-card__bullet',
    '.topcard__flavor--bullet',
  ],
  'indeed.com': [
    '[data-testid="job-location"]',
    '[data-testid="inlineHeader-companyLocation"]',
  ],
  'glassdoor.com': ['[data-test="location"]'],
  'ziprecruiter.com': ['.hiring_location'],
};

function findFocusedPane() {
  const host = window.location.hostname.toLowerCase();
  for (const [pattern, finder] of Object.entries(FOCUSED_PANE_FINDERS)) {
    if (host.includes(pattern)) {
      try {
        const el = finder();
        if (el) return { el, host: pattern };
      } catch (e) {
        // ignore selector errors
      }
    }
  }
  return null;
}

function pickText(scope, selectors) {
  if (!scope || !selectors) return '';
  for (const sel of selectors) {
    try {
      const el = scope.querySelector(sel);
      if (el && el.textContent) {
        const txt = el.textContent.replace(/\s+/g, ' ').trim();
        if (txt) return txt;
      }
    } catch (e) {
      // bad selector
    }
  }
  return '';
}

function detectJobOnPage() {
  // 1. JSON-LD JobPosting (gold standard, host-agnostic)
  const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of ldScripts) {
    if (!script.textContent || !script.textContent.includes('JobPosting')) continue;
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : data?.['@graph'] || [data];
      for (const item of items) {
        if ((item?.['@type'] || '').toString().toLowerCase() !== 'jobposting') continue;
        const title = (item.title || '').toString().trim();
        const company =
          (item.hiringOrganization?.name || item.hiringOrganization?.legalName || '').toString().trim();
        const loc = item.jobLocation?.address;
        const location = loc
          ? [loc.addressLocality, loc.addressRegion, loc.addressCountry].filter(Boolean).join(', ')
          : '';
        if (title) {
          notifyJobDetected({ title, company, location, sourceUrl: window.location.href });
          return true;
        }
      }
    } catch (e) {
      // ignore malformed JSON-LD
    }
  }

  // 2. Focused-pane detection — find the SINGLE job container on the
  // current page and extract title/company/location from inside it.
  // Skips the page-level h1 / document.title which on collection pages
  // refer to the LIST, not the focused job.
  const focused = findFocusedPane();
  if (focused) {
    const title = pickText(focused.el, FOCUSED_TITLE_SELECTORS[focused.host]);
    if (title) {
      const company = pickText(focused.el, FOCUSED_COMPANY_SELECTORS[focused.host]);
      const location = pickText(focused.el, FOCUSED_LOCATION_SELECTORS[focused.host]);
      // Stash the focused pane outerHTML on the window so the side
      // panel can request it via getHTML and pass ONLY this slice to
      // /api/jobs/extract — preventing the AI from being confused by
      // the surrounding job-list rail.
      try {
        window.__hiredVideoFocusedPaneHtml = focused.el.outerHTML;
      } catch (e) {
        // Some pages restrict cross-origin access; ignore.
      }
      notifyJobDetected({
        title: title.slice(0, 250),
        company,
        location,
        sourceUrl: window.location.href,
        hasFocusedPane: true,
      });
      return true;
    }
  } else {
    // Reset the cached pane when there's no focused job (so a stale
    // pane from a prior page doesn't get sent on the next click).
    try {
      delete window.__hiredVideoFocusedPaneHtml;
    } catch (e) {}
  }

  // 3. Last-resort fallback for known job hosts where we couldn't find
  // a focused pane (e.g. brand-new LinkedIn classnames). Only fires on
  // an allowlist so we don't spam the side panel from arbitrary pages.
  const KNOWN_HOSTS = [
    'linkedin.com',
    'indeed.com',
    'glassdoor.com',
    'ziprecruiter.com',
    'monster.com',
    'careerbuilder.com',
    'dice.com',
    'simplyhired.com',
    'lever.co',
    'greenhouse.io',
    'myworkdayjobs.com',
    'theladders.com',
    'wellfound.com',
    'angel.co',
    'builtin.com',
  ];
  const host = window.location.hostname.toLowerCase();
  if (!KNOWN_HOSTS.some((h) => host.includes(h))) return false;

  // Try a job-specific h1 first; otherwise bail rather than echoing
  // the page title (which on a collection page is the list name).
  const jobLikeHeading =
    document.querySelector('h1[class*="job-title"]')?.textContent ||
    document.querySelector('h1[class*="JobTitle"]')?.textContent ||
    document.querySelector('h1[class*="top-card"]')?.textContent ||
    '';
  const title = jobLikeHeading.trim().slice(0, 250);
  if (!title) return false;

  notifyJobDetected({
    title,
    company: '',
    location: '',
    sourceUrl: window.location.href,
  });
  return true;
}

function notifyJobDetected(payload) {
  const key = `${payload.title}|${payload.sourceUrl}`;
  if (key === lastDetectedKey) return;
  lastDetectedKey = key;
  chrome.runtime
    .sendMessage({ action: 'jobDetected', payload })
    .catch(() => {
      // Side panel may not be open — ignore.
    });
}

// Run once on initial load, then debounce-watch the DOM so SPA navigations
// (LinkedIn especially) trigger a re-check.
function scheduleDetect() {
  // Wait a tick so React/Vue can hydrate.
  setTimeout(detectJobOnPage, 500);
  setTimeout(detectJobOnPage, 1500);
  setTimeout(detectJobOnPage, 3000);
}
scheduleDetect();

const detectObserver = new MutationObserver(() => {
  // Cheap throttle — only re-detect at most once every 1.5s.
  if (detectObserver._pending) return;
  detectObserver._pending = true;
  setTimeout(() => {
    detectObserver._pending = false;
    detectJobOnPage();
  }, 1500);
});
detectObserver.observe(document.documentElement, { childList: true, subtree: true });

// Track URL changes for SPA navigation detection
let lastUrl = window.location.href;

// Notify sidepanel of URL changes (for SPAs like LinkedIn)
function notifyUrlChange() {
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    lastUrl = currentUrl;
    // Reset the dedupe key so the next detect on the new URL fires.
    lastDetectedKey = null;
    // Notify the extension that the URL changed
    chrome.runtime.sendMessage({
      action: "urlChanged",
      url: currentUrl
    }).catch(() => {
      // Extension context might not be available, ignore
    });
    // Re-run job detection on the new URL.
    scheduleDetect();
  }
}

// Monitor for URL changes (SPAs use pushState/replaceState)
const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;

history.pushState = function(...args) {
  originalPushState.apply(this, args);
  notifyUrlChange();
};

history.replaceState = function(...args) {
  originalReplaceState.apply(this, args);
  notifyUrlChange();
};

window.addEventListener('popstate', notifyUrlChange);

// Also check periodically for URL changes (fallback for edge cases)
setInterval(notifyUrlChange, 1000);

// Send the HTML back to the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getHTML") {
    // Wait for content to be ready before responding
    waitForContent(request.timeout || 3000).then((html) => {
      sendResponse({
        html: html,
        originUrl: window.location.href
      });
    });
    return true; // Keep the message channel open for async response
  }

  if (request.action === "ping") {
    // Simple ping to check if content script is loaded
    sendResponse({ status: "ready", url: window.location.href });
    return true;
  }

  if (request.action === "getFocusedPaneHTML") {
    // Re-detect right now in case the user has since clicked a
    // different job in the left rail without a URL change firing.
    detectJobOnPage();
    const html = window.__hiredVideoFocusedPaneHtml || null;
    sendResponse({
      html,
      originUrl: window.location.href,
    });
    return true;
  }

  return true;
});
