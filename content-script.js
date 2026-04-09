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

function detectJobOnPage() {
  // 1. JSON-LD JobPosting (gold standard)
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

  // 2. Known job-site DOM markers — only fire on hosts we recognize so we
  // don't spam the side panel from arbitrary pages.
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

  // Pull a likely title from the page.
  const heading =
    document.querySelector('h1[class*="job"]')?.textContent ||
    document.querySelector('h1')?.textContent ||
    document.title;
  const title = (heading || '').trim().slice(0, 250);
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

  return true;
});
