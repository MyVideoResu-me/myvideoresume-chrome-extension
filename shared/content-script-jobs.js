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
// Skip-host guard
// =====================================================================
//
// Never run job detection on hired.video's own pages. The extension
// tracks jobs from OTHER job boards into hired.video — running it on
// hired.video/tools, /home, /dashboard, etc. generates false positives
// (the tools page surfaces cards like "Resume Optimizer" / "Job-Resume
// Match" that the generic detector reads as a job title).
const JOBSEEKER_SKIP_HOSTS = new Set([
  'hired.video',
  'www.hired.video',
  'localhost',       // local hired.video frontend (:3000)
  '127.0.0.1',
]);
const JOBSEEKER_SKIP_DETECTION = JOBSEEKER_SKIP_HOSTS.has(window.location.hostname);

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
let lastDetectedPayload = null;

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
  'linkedin.com': () => {
    // ---- Strategy 1: #job-details (stable id, most reliable) ----
    // This id wraps the job description section and is NOT obfuscated.
    // Prefer the nearest known right-pane wrapper so the pane NEVER
    // includes the left rail — otherwise left-rail selectors like
    // .job-card-list__title would match the top sidebar item instead
    // of the currently-selected job.
    const jobDetails = document.getElementById('job-details');
    if (jobDetails) {
      const rightPane = jobDetails.closest(
        '.jobs-search__job-details, .jobs-details, .scaffold-layout__detail'
      );
      if (rightPane) return rightPane;

      // Fallback walk-up — bail out if we ever encounter a sidebar marker,
      // since that means we've walked past the right-pane boundary.
      let container = jobDetails;
      for (let i = 0; i < 6 && container; i++) {
        if (container === document.body) break;
        container = container.parentElement;
        if (!container) break;
        if (container.querySelector('.job-card-container, .jobs-search-results-list, .scaffold-layout__list')) {
          break;
        }
        if (container.innerHTML.length > 3000 && container.innerHTML.length < 200000) {
          return container;
        }
      }
      return jobDetails.parentElement || jobDetails;
    }

    // ---- Strategy 2: Legacy semantic class names ----
    const legacy =
      document.querySelector('.jobs-search__job-details--container') ||
      document.querySelector('.jobs-search__job-details') ||
      document.querySelector('.job-view-layout') ||
      document.querySelector('.top-card-layout');
    if (legacy) return legacy;

    // ---- Strategy 3: "About the job" heading anchor ----
    const allHeadings = document.querySelectorAll('h1, h2, h3, h4');
    for (const h of allHeadings) {
      const text = (h.textContent || '').trim().toLowerCase();
      if (text === 'about the job' || text === 'about this role') {
        let container = h.parentElement;
        for (let i = 0; i < 10 && container; i++) {
          if (container === document.body) break;
          const len = container.innerHTML.length;
          if (len > 3000 && len < 200000) return container;
          container = container.parentElement;
        }
      }
    }

    return null;
  },
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
  'google.com': () => {
    // Google Jobs renders a detail flyout when a job card is clicked in
    // search results. Class names are obfuscated and change frequently,
    // so we anchor on characteristic semantic content instead.

    // Strategy 1: "Job highlights" or "Full job description" heading
    for (const h of document.querySelectorAll('h2, h3')) {
      const txt = (h.textContent || '').trim().toLowerCase();
      if (txt === 'job highlights' || txt === 'full job description') {
        let el = h;
        for (let i = 0; i < 12 && el; i++) {
          if (el === document.body) break;
          el = el.parentElement;
          if (el && el.innerHTML.length > 3000 && el.innerHTML.length < 300000) return el;
        }
      }
    }

    // Strategy 2: "Apply on …" link cluster (unique to the job detail panel)
    for (const a of document.querySelectorAll('a')) {
      if (/^Apply\s+(on|at|in)\s+/i.test((a.textContent || '').trim())) {
        let el = a;
        for (let i = 0; i < 12 && el; i++) {
          if (el === document.body) break;
          el = el.parentElement;
          if (el && el.innerHTML.length > 3000 && el.innerHTML.length < 300000) return el;
        }
      }
    }

    return null;
  },
};

/**
 * Per-host title selectors to query INSIDE the focused pane. Skip
 * generic `h1` because on collection pages the page-level h1 is
 * the list name ("Jobs where you'd be a top applicant"), not the
 * focused job's title.
 */
const FOCUSED_TITLE_SELECTORS = {
  'linkedin.com': [
    // Right-pane detail-card selectors only. `.job-card-list__title` is
    // intentionally EXCLUDED here — it matches the LEFT RAIL sidebar
    // items, and when scoped against a wide paneEl it returns the TOP
    // sidebar job instead of the currently-selected one.
    '.job-details-jobs-unified-top-card__job-title h1',
    '.job-details-jobs-unified-top-card__job-title',
    '.jobs-unified-top-card__job-title',
    '.top-card-layout__title',
    // Generic headings handled by linkedInPickTitle() below — NOT listed
    // here because pickText can't filter out "About the job" etc.
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

/**
 * Build the canonical job URL. On LinkedIn collections/search pages the
 * URL is e.g. /jobs/collections/recommended/?currentJobId=12345 — we
 * rewrite it to /jobs/view/12345/ so dedup and re-opening work properly.
 */
function getCanonicalJobUrl() {
  const url = new URL(window.location.href);
  const host = url.hostname.toLowerCase();

  if (host.includes('linkedin.com')) {
    // LinkedIn: extract currentJobId from query string
    const jobId = url.searchParams.get('currentJobId');
    if (jobId) {
      return `https://www.linkedin.com/jobs/view/${jobId}/`;
    }
    // Already on /jobs/view/ — use as-is
    const viewMatch = url.pathname.match(/\/jobs\/view\/(\d+)/);
    if (viewMatch) {
      return `https://www.linkedin.com/jobs/view/${viewMatch[1]}/`;
    }
  }

  return window.location.href;
}

function detectJobOnPage() {
  // Skip hired.video's own pages — tools/dashboards/etc. aren't jobs.
  if (JOBSEEKER_SKIP_DETECTION) return false;

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
        // Apply URL: prefer directApply (explicit apply link) over url
        // (canonical job page), then try DOM apply buttons, then fall back
        // to the sourceUrl (the page the user is on).
        const directApply = typeof item.directApply === 'string' ? item.directApply.trim() : '';
        const itemUrl = typeof item.url === 'string' ? item.url.trim() : '';
        const sourceUrl = getCanonicalJobUrl();
        const applyUrl = directApply || itemUrl || extractApplyUrl() || sourceUrl;
        if (title) {
          notifyJobDetected({ title, company, location, sourceUrl, applyUrl });
          return true;
        }
      }
    } catch (e) {
      // ignore malformed JSON-LD
    }
  }

  // 2. Focused-pane detection — find the SINGLE job container on the
  // current page and extract title/company/location from inside it.
  const focused = findFocusedPane();
  if (focused) {
    // LinkedIn and Google need custom title extraction that filters noise headings
    const title = focused.host === 'linkedin.com'
      ? linkedInPickTitle(focused.el)
      : focused.host === 'google.com'
      ? googlePickTitle(focused.el)
      : pickText(focused.el, FOCUSED_TITLE_SELECTORS[focused.host]);
    if (title) {
      let company, location;
      if (focused.host === 'google.com') {
        const meta = googlePickCompanyLocation(focused.el);
        company = meta.company;
        location = meta.location;
      } else {
        company = pickText(focused.el, FOCUSED_COMPANY_SELECTORS[focused.host]);
        location = pickText(focused.el, FOCUSED_LOCATION_SELECTORS[focused.host]);
      }
      // Stash the focused pane outerHTML so the side panel can request
      // ONLY this slice via getFocusedPaneHTML.
      try {
        window.__hiredVideoFocusedPaneHtml = focused.el.outerHTML;
      } catch (e) { /* cross-origin restriction */ }
      const focusedSourceUrl = getCanonicalJobUrl();
      notifyJobDetected({
        title: title.slice(0, 250),
        company,
        location,
        sourceUrl: focusedSourceUrl,
        applyUrl: extractApplyUrl() || focusedSourceUrl,
        hasFocusedPane: true,
      });
      return true;
    }
  }

  // 3. Fallback: search for "About the job" section even if
  // findFocusedPane didn't match. This handles cases where the pane
  // finder's size thresholds don't fit but the content IS there.
  const host = window.location.hostname.toLowerCase();
  if (host.includes('linkedin.com')) {
    const aboutSection = findLinkedInJobSection();
    if (aboutSection) {
      const { title, company, location, paneEl } = aboutSection;
      if (title) {
        try {
          window.__hiredVideoFocusedPaneHtml = paneEl.outerHTML;
        } catch (e) { /* cross-origin */ }
        const aboutSourceUrl = getCanonicalJobUrl();
        notifyJobDetected({
          title: title.slice(0, 250),
          company,
          location,
          sourceUrl: aboutSourceUrl,
          applyUrl: extractApplyUrl() || aboutSourceUrl,
          hasFocusedPane: true,
        });
        return true;
      }
    }
  }

  // Reset the cached pane when there's no focused job
  try { delete window.__hiredVideoFocusedPaneHtml; } catch (e) {}
  return false;
}

/** Headings that are NOT job titles — used to filter noise on LinkedIn. */
const LINKEDIN_NOISE_HEADINGS = new Set([
  'about the job', 'about this role', 'how your profile and resume fit this job',
  'people also viewed', 'people you can reach out to', 'similar jobs',
  'benefits found in job post', 'skills', 'responsibilities',
  'qualifications', 'job description', 'about spoton', 'about the company',
]);

/**
 * LinkedIn-specific title picker. Tries multiple strategies to find the
 * actual job title, filtering out section headings like "About the job".
 */
function linkedInPickTitle(paneEl) {
  if (!paneEl) return '';

  // Strategy 1: BEM selectors (stable when present)
  const bemSelectors = FOCUSED_TITLE_SELECTORS['linkedin.com'] || [];
  for (const sel of bemSelectors) {
    try {
      const el = paneEl.querySelector(sel);
      if (el) {
        const txt = el.textContent.replace(/\s+/g, ' ').trim();
        if (txt && txt.length > 3 && !LINKEDIN_NOISE_HEADINGS.has(txt.toLowerCase())) return txt;
      }
    } catch (e) { /* bad selector */ }
  }

  // Strategy 2: The selected job card in the left rail has the title
  // highlighted — grab it from the active card's title element.
  const activeCard =
    document.querySelector('.job-card-container--clickable.job-card-list--is-current-job') ||
    document.querySelector('.jobs-search-results__list-item--active') ||
    document.querySelector('[class*="job-card"][class*="current"]');
  if (activeCard) {
    const cardTitle = activeCard.querySelector('.job-card-list__title, [class*="job-card"] strong, a[class*="title"]');
    if (cardTitle) {
      const txt = cardTitle.textContent.replace(/\s+/g, ' ').trim();
      if (txt && txt.length > 3) return txt;
    }
  }

  // Strategy 3: Dismiss button aria-label — "Dismiss {title} job"
  const dismissBtns = document.querySelectorAll('button[aria-label*="job"]');
  for (const btn of dismissBtns) {
    const label = btn.getAttribute('aria-label') || '';
    const match = label.match(/^Dismiss\s+(.+?)\s+job$/i);
    if (match && match[1] && match[1].length > 3) return match[1];
  }

  // Strategy 4: All h1/h2 inside the pane, filtering noise
  const headings = paneEl.querySelectorAll('h1, h2');
  for (const h of headings) {
    const txt = h.textContent.replace(/\s+/g, ' ').trim();
    if (!txt || txt.length < 4 || txt.length > 200) continue;
    if (LINKEDIN_NOISE_HEADINGS.has(txt.toLowerCase())) continue;
    // Skip headings that start with common section prefixes
    const lower = txt.toLowerCase();
    if (lower.startsWith('about ') || lower.startsWith('how your') || lower.startsWith('people ')) continue;
    if (lower.startsWith('benefits') || lower.startsWith('skills')) continue;
    return txt;
  }

  return '';
}

/**
 * LinkedIn fallback: find job info when findFocusedPane didn't get a pane
 * with a title. Uses the active job card + #job-details as anchors.
 */
function findLinkedInJobSection() {
  const title = linkedInPickTitle(document.body);
  if (!title) return null;

  // Find the detail pane via #job-details or "About the job" heading
  let paneEl = document.getElementById('job-details');
  if (paneEl) {
    // Walk up to include the title card
    for (let i = 0; i < 6 && paneEl; i++) {
      if (paneEl === document.body) break;
      paneEl = paneEl.parentElement;
      if (paneEl && paneEl.innerHTML.length > 3000) break;
    }
  }

  if (!paneEl || paneEl === document.body) {
    paneEl = document.getElementById('job-details') || document.body;
  }

  // Extract company + location from the text near the title
  let company = '';
  let location = '';

  // Try the active card's metadata
  const activeCard =
    document.querySelector('.job-card-container--clickable.job-card-list--is-current-job') ||
    document.querySelector('.jobs-search-results__list-item--active') ||
    document.querySelector('[class*="job-card"][class*="current"]');
  if (activeCard) {
    const compEl = activeCard.querySelector('.job-card-container__company-name, .job-card-container__primary-description');
    if (compEl) company = compEl.textContent.replace(/\s+/g, ' ').trim();
    const locEl = activeCard.querySelector('.job-card-container__metadata-item');
    if (locEl) location = locEl.textContent.replace(/\s+/g, ' ').trim();
  }

  return { title, company, location, paneEl };
}

// ---- Google Jobs helpers ------------------------------------------------

/** Headings that are section labels, NOT job titles — filter these out. */
const GOOGLE_JOBS_NOISE_HEADINGS = new Set([
  'job highlights', 'qualifications', 'responsibilities', 'benefits',
  'full job description', 'job description', 'about the company',
  'related searches', 'jobs', 'job postings', 'saved jobs', 'following',
  'more job highlights', 'how you match', 'reviews', 'description',
]);

/**
 * Google-specific title picker. Finds the first h2 in the job detail
 * panel that isn't a section heading.
 */
function googlePickTitle(paneEl) {
  if (!paneEl) return '';
  for (const h of paneEl.querySelectorAll('h2')) {
    const txt = h.textContent.replace(/\s+/g, ' ').trim();
    if (!txt || txt.length < 4 || txt.length > 300) continue;
    if (GOOGLE_JOBS_NOISE_HEADINGS.has(txt.toLowerCase())) continue;
    const lower = txt.toLowerCase();
    if (lower.startsWith('about ') || lower.startsWith('how ') ||
        lower.startsWith('related ') || lower.startsWith('people ') ||
        lower.startsWith('similar ')) continue;
    return txt;
  }
  return '';
}

/**
 * Extract company and location from Google Jobs' metadata line.
 * Google renders "Company • Location • via Source" below the title.
 */
function googlePickCompanyLocation(paneEl) {
  if (!paneEl) return { company: '', location: '' };
  // Walk text nodes looking for the bullet-separated metadata line
  const walker = document.createTreeWalker(paneEl, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text.includes('•') || text.length < 5 || text.length > 300) continue;
    // Skip elements whose children have too much nested content (sections)
    if (node.children.length > 10) continue;
    // Check inner HTML length — metadata lines are short, not huge sections
    if (node.innerHTML.length > 1000) continue;
    const parts = text.split('•').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const filtered = parts.filter(p => !p.toLowerCase().startsWith('via '));
      return {
        company: filtered[0] || '',
        location: filtered.length > 1 ? filtered.slice(1).join(', ') : '',
      };
    }
  }
  return { company: '', location: '' };
}

// ---- Apply URL extraction -------------------------------------------
// Scans the page for "Apply" buttons/links that point to an external
// application system (Workday, Greenhouse, Lever, etc.). The sourceUrl
// is where the job was found; the applyUrl is where you actually apply.

/**
 * Look for an apply-button link on the page. Returns the href if found,
 * or empty string if the page has no distinct apply link.
 */
function extractApplyUrl() {
  // Common selectors for apply buttons/links across major job sites
  const applySelectors = [
    'a[data-apply-url]',                            // explicit data attr
    'a[href*="/apply"]',                             // generic /apply path
    'a.apply-button', 'a.apply-btn',                // common class names
    'a[class*="apply" i]',                           // fuzzy class match
    'a[data-testid*="apply" i]',                     // test IDs
    'button[data-apply-url]',                        // button with data attr
  ];

  for (const sel of applySelectors) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const href = el.getAttribute('href') || el.dataset?.applyUrl || '';
        if (!href || href === '#' || href.startsWith('javascript:')) continue;
        // Resolve relative URLs
        try {
          const resolved = new URL(href, window.location.href).href;
          // Only return if it looks like a real URL (not just an anchor)
          if (resolved.startsWith('http')) return resolved;
        } catch (e) { /* invalid URL */ }
      }
    } catch (e) { /* bad selector */ }
  }

  // Also check for LinkedIn's "Apply" / "Easy Apply" button which uses
  // a different pattern — the actual external apply URL is in a nearby link
  const linkedInApply = document.querySelector('.jobs-apply-button--top-card a[href]');
  if (linkedInApply) {
    const href = linkedInApply.getAttribute('href');
    if (href && href.startsWith('http')) return href;
  }

  return '';
}

// ---- Generic fallback extraction ------------------------------------
// Used by the `detectJob` handler when no site-specific detection
// matched. Tries h1, <title>, and common job-page meta patterns.

/** Headings that are generic site chrome, not job titles. */
const GENERIC_NOISE = new Set([
  'home', 'careers', 'jobs', 'job openings', 'open positions',
  'search results', 'apply now', 'sign in', 'log in', 'menu',
]);

function genericJobExtract() {
  let title = '';

  // 1. First h1 on the page — most job pages put the title in h1
  const h1 = document.querySelector('h1');
  if (h1) {
    const txt = h1.textContent.replace(/\s+/g, ' ').trim();
    if (txt && txt.length > 3 && txt.length < 200 &&
        !GENERIC_NOISE.has(txt.toLowerCase())) {
      title = txt;
    }
  }

  // 2. Fallback to <title> tag, stripping common site suffixes
  if (!title) {
    const raw = document.title.replace(/\s+/g, ' ').trim();
    if (raw) {
      // Remove trailing "- Company | Careers" style suffixes
      const cleaned = raw
        .replace(/\s*[-|–—•]\s*(Careers|Jobs|Hiring|Apply|Company|Recruit|Job Board|Openings).*$/i, '')
        .trim();
      if (cleaned && cleaned.length > 3 && cleaned.length < 200 &&
          !GENERIC_NOISE.has(cleaned.toLowerCase())) {
        title = cleaned;
      }
    }
  }

  if (!title) return null;

  // Try to extract company from common meta tags
  let company = '';
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) company = (ogSiteName.content || '').trim();

  // Try to extract location from structured data or common patterns
  let location = '';
  const locEl =
    document.querySelector('[data-testid*="location"], [class*="job-location"], [class*="jobLocation"]');
  if (locEl) location = locEl.textContent.replace(/\s+/g, ' ').trim();

  const genericSourceUrl = getCanonicalJobUrl();
  return {
    title: title.slice(0, 250),
    company,
    location,
    sourceUrl: genericSourceUrl,
    applyUrl: extractApplyUrl() || genericSourceUrl,
  };
}

function notifyJobDetected(payload) {
  const key = `${payload.title}|${payload.sourceUrl}`;
  if (key === lastDetectedKey) return;
  lastDetectedKey = key;
  lastDetectedPayload = payload;
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

if (!JOBSEEKER_SKIP_DETECTION) {
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
}

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

// LinkedIn: clicking a sidebar card swaps the right pane in place and
// does not always trigger a URL change fast enough. Listen on capture
// so we schedule re-detection before the throttled MutationObserver.
document.addEventListener('click', (e) => {
  const host = window.location.hostname.toLowerCase();
  if (!host.includes('linkedin.com')) return;
  const target = e.target;
  if (!target || !target.closest) return;
  const card = target.closest(
    '.job-card-container--clickable, .job-card-list__entity-lockup, .job-card-job-posting-card-wrapper, [data-job-id]'
  );
  if (!card) return;
  lastDetectedKey = null;
  lastDetectedPayload = null;
  setTimeout(detectJobOnPage, 300);
  setTimeout(detectJobOnPage, 900);
  setTimeout(detectJobOnPage, 2000);
}, true);

// Send the HTML back to the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getHTML") {
    // Wait for content to be ready before responding
    waitForContent(request.timeout || 3000).then((html) => {
      sendResponse({
        html: html,
        originUrl: getCanonicalJobUrl(),
      });
    });
    return true; // Keep the message channel open for async response
  }

  if (request.action === "ping") {
    // Simple ping to check if content script is loaded
    sendResponse({ status: "ready", url: getCanonicalJobUrl() });
    return true;
  }

  if (request.action === "detectJob") {
    // hired.video's own pages never contain trackable jobs — return null
    // BEFORE hitting genericJobExtract(), which would otherwise surface
    // page headings like "AI-Powered Career Tools" as false-positive titles.
    if (JOBSEEKER_SKIP_DETECTION) {
      sendResponse(null);
      return true;
    }

    // Re-run detection from scratch and return the payload directly.
    // Resets the dedupe key so the detection fires even if the same job
    // was already detected (e.g. before the side panel was open).
    lastDetectedKey = null;
    lastDetectedPayload = null;
    detectJobOnPage();

    // If site-specific detection failed, try generic DOM extraction so
    // we still surface a real title on sites we don't have selectors for.
    if (!lastDetectedPayload) {
      const generic = genericJobExtract();
      if (generic) lastDetectedPayload = generic;
    }

    sendResponse(lastDetectedPayload);
    return true;
  }

  if (request.action === "getFocusedPaneHTML") {
    if (JOBSEEKER_SKIP_DETECTION) {
      sendResponse({ html: null, originUrl: getCanonicalJobUrl() });
      return true;
    }
    // Clear the stale cache and re-detect from scratch so we always
    // capture the CURRENTLY focused job, not a previously clicked one.
    try { delete window.__hiredVideoFocusedPaneHtml; } catch (e) {}
    detectJobOnPage();
    const html = window.__hiredVideoFocusedPaneHtml || null;
    sendResponse({
      html,
      originUrl: getCanonicalJobUrl(),
    });
    return true;
  }

  return true;
});
