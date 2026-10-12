/**
 * hired.video Chrome Extension — Shared Profile Parsers
 *
 * Per-host configuration for detecting and extracting candidate / seeker
 * profiles from external sites (LinkedIn, Indeed, ...).
 *
 * Lifted from `recruiter/constants-recruiter.js` + `recruiter/content-script-profiles.js`
 * because the seeker-side Vendor Sync flow needs the same selectors. Both
 * extensions now consume from this single file:
 *
 *   - recruiter: source candidates from a profile pane the recruiter is viewing
 *   - jobseeker: extract the seeker's OWN profile to sync back into hired.video
 *
 * Selectors are read at content-script time. Add a new vendor here and
 * declare `supportsExtensionExtract: true` in the matching backend
 * connector — that's the full DRY surface.
 *
 * IMPORTANT: load order — both manifests must include this file BEFORE
 * any content script that references PROFILE_SITE_PARSERS or
 * findFocusedProfilePane().
 */

// ---- Profile site parsers -----------------------------------------------

const PROFILE_SITE_PARSERS = {
  linkedin: {
    hostPatterns: ['linkedin.com'],
    urlPatterns: [/\/in\/[^/]+/],
    selectors: [
      '.pv-top-card',
      '.scaffold-layout__main',
      '[class*="profile-card"]',
      '.profile-section-card',
    ],
    nameSelectors: [
      '.text-heading-xlarge',
      'h1.text-heading-xlarge',
      'h1',
    ],
    titleSelectors: [
      '.text-body-medium[data-anonymize="headline"]',
      '.text-body-medium',
      '.pv-top-card--list li:first-child',
    ],
    companySelectors: [
      '.pv-text-details__right-panel-item-text',
      '[aria-label*="Current company"]',
      '.experience-item__subtitle',
    ],
    locationSelectors: [
      '.text-body-small[data-anonymize="location"]',
      '.text-body-small.inline.t-black--light',
      '.pv-top-card--list-bullet li:first-child',
    ],
  },
  indeed: {
    // Accept both the legacy public resume URL (/resumes/<id> on indeed.com)
    // AND the modern profile editor on profile.indeed.com (root path). The
    // editProfileUrl on the backend connector points at profile.indeed.com,
    // so the parser must match that host or the "Sync from Indeed tab" CTA
    // sends the user somewhere the parser ignores. Fixes gap #1414.
    hostPatterns: ['indeed.com', 'profile.indeed.com'],
    urlPatterns: [/\/resumes?\//, /^\/$/, /^\/profile/],
    selectors: [
      '.resume-body',
      '#resume-body',
      '.icl-ResumeBody',
      '[data-testid="profile-summary"]',
      'main',
    ],
    nameSelectors: [
      '.icl-ResumeHeader-name',
      'h1',
    ],
    titleSelectors: [
      '.icl-ResumeHeader-headline',
      '.resume-headline',
    ],
    companySelectors: [],
    locationSelectors: [
      '.icl-ResumeHeader-location',
      '.resume-location',
    ],
  },
  // Glassdoor — extracts the signed-in user's profile from
  // glassdoor.com/member/profile. The LLM extractor handles section-name
  // variance, so a single fall-back `main` selector is enough for v1.
  // Pairs with VENDOR_HINTS.glassdoor on the backend. Fixes gap #1418.
  glassdoor: {
    hostPatterns: ['glassdoor.com'],
    urlPatterns: [/\/member\/profile/, /\/profile/],
    selectors: ['.profileContainer', 'main', '#root'],
    nameSelectors: ['h1'],
    titleSelectors: ['[data-test="profile-headline"]', 'h2'],
    companySelectors: [],
    locationSelectors: ['[data-test="profile-location"]'],
  },
  // ZipRecruiter profile editor lives at /profile (signed-in redirect).
  ziprecruiter: {
    hostPatterns: ['ziprecruiter.com'],
    urlPatterns: [/\/profile/, /\/candidate\//],
    selectors: ['.profile-container', '#profile', 'main'],
    nameSelectors: ['h1'],
    titleSelectors: ['.profile-headline', 'h2'],
    companySelectors: [],
    locationSelectors: ['.profile-location'],
  },
  // Monster profile editor.
  monster: {
    hostPatterns: ['monster.com'],
    urlPatterns: [/\/profile/, /\/account\/profile/],
    selectors: ['.profile-container', 'main', '#main'],
    nameSelectors: ['h1'],
    titleSelectors: ['.profile-headline', 'h2'],
    companySelectors: [],
    locationSelectors: ['.profile-location'],
  },
  // Wellfound (formerly AngelList Talent). Profile lives at /u/<handle>.
  wellfound: {
    hostPatterns: ['wellfound.com', 'angel.co'],
    urlPatterns: [/\/u\//, /\/profile/],
    selectors: ['main', '.profile-page', '#root'],
    nameSelectors: ['h1'],
    titleSelectors: ['h2', '.profile-headline'],
    companySelectors: [],
    locationSelectors: [],
  },
  // Dice profile / dashboard.
  dice: {
    hostPatterns: ['dice.com'],
    urlPatterns: [/\/dashboard\/profile/, /\/profile/],
    selectors: ['main', '.profile-container', '#root'],
    nameSelectors: ['h1'],
    titleSelectors: ['h2', '.profile-headline'],
    companySelectors: [],
    locationSelectors: [],
  },
  // GitHub user profile (github.com/<username>). README repo + bio
  // live on this page — we let the LLM extractor pick out what it can.
  github: {
    hostPatterns: ['github.com'],
    urlPatterns: [/^\/[^/]+\/?$/, /^\/[^/]+\?/],
    selectors: ['.h-card', 'main', '.application-main'],
    nameSelectors: ['.p-name', 'h1.vcard-names', 'h1'],
    titleSelectors: ['.p-note', '[data-bio]'],
    companySelectors: ['[itemprop="worksFor"]', '.p-org'],
    locationSelectors: ['[itemprop="homeLocation"]', '.p-label'],
  },
};

// ---- Per-host focused-pane finders --------------------------------------
//
// Returns the DOM container wrapping the candidate's profile on the
// current page, or null if this isn't a profile page. Centralised so
// both extensions hit the same identification logic.

const FOCUSED_PROFILE_FINDERS = {
  'linkedin.com': () => {
    if (!/\/in\/[^/]+/.test(window.location.pathname)) return null;
    return (
      document.querySelector('.scaffold-layout__main') ||
      document.querySelector('.pv-top-card')?.closest('main') ||
      null
    );
  },
  'indeed.com': () => {
    // Legacy public resume URL OR the modern profile editor on
    // profile.indeed.com (root path). chrome.tabs.query matches the host
    // suffix, so profile.indeed.com hits this branch too. Falls back to
    // <main> when the resume-body classes aren't present (modern editor).
    const isLegacyResume = /\/resumes?\//.test(window.location.pathname);
    const isModernProfile = window.location.hostname.startsWith('profile.')
      || /^\/(profile)?$/.test(window.location.pathname);
    if (!isLegacyResume && !isModernProfile) return null;
    return (
      document.querySelector('.resume-body') ||
      document.querySelector('#resume-body') ||
      document.querySelector('[data-testid="profile-summary"]')?.closest('main') ||
      document.querySelector('main') ||
      null
    );
  },
  'glassdoor.com': () => {
    if (!/\/(member\/)?profile/.test(window.location.pathname)) return null;
    return (
      document.querySelector('.profileContainer') ||
      document.querySelector('main') ||
      null
    );
  },
  'ziprecruiter.com': () => {
    if (!/\/(profile|candidate)/.test(window.location.pathname)) return null;
    return (
      document.querySelector('.profile-container') ||
      document.querySelector('#profile') ||
      document.querySelector('main') ||
      null
    );
  },
  'monster.com': () => {
    if (!/\/(profile|account\/profile)/.test(window.location.pathname)) return null;
    return (
      document.querySelector('.profile-container') ||
      document.querySelector('main') ||
      null
    );
  },
  'wellfound.com': () => {
    if (!/\/(u\/|profile)/.test(window.location.pathname)) return null;
    return document.querySelector('main') || document.querySelector('.profile-page') || null;
  },
  'dice.com': () => {
    if (!/\/(dashboard\/profile|profile)/.test(window.location.pathname)) return null;
    return document.querySelector('main') || document.querySelector('.profile-container') || null;
  },
  'github.com': () => {
    // Only fire on the user profile page (single path segment), not repos
    // or any of the dozens of other GitHub surfaces.
    if (!/^\/[^/]+\/?$/.test(window.location.pathname)) return null;
    return (
      document.querySelector('.h-card') ||
      document.querySelector('main') ||
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
        // ignore — DOM access can throw inside a sandboxed frame
      }
    }
  }
  return null;
}

// ---- List-view (search-results) finders --------------------------------
//
// For each supported host, return an array of DOM nodes representing
// individual candidate cards on a list page (LinkedIn search results,
// Indeed resume search, GitHub user list). Used by the recruiter
// extension's "Capture all on this page" bulk-source flow (gap #1358).
//
// Each finder is a no-op on profile-detail pages (the focused-pane
// finders cover that case) so the bulk button stays hidden until the
// user is actually on a list view.

const LIST_VIEW_FINDERS = {
  'linkedin.com': () => {
    // LinkedIn search results — only on /search/results/people/ etc.
    if (!/\/search\/results\//.test(window.location.pathname)) return [];
    return Array.from(document.querySelectorAll(
      '.reusable-search__result-container, .entity-result__item, li.search-result',
    ));
  },
  'indeed.com': () => {
    if (!/\/resumes?\//.test(window.location.pathname)) return [];
    // The detail page is one item; only count when there are >= 2 cards.
    const cards = Array.from(document.querySelectorAll('.resume-list__item, .icl-ResumeCard'));
    return cards.length >= 2 ? cards : [];
  },
  'github.com': () => {
    if (!/\/search\?/.test(window.location.search) && !/\/orgs\//.test(window.location.pathname)) return [];
    return Array.from(document.querySelectorAll(
      '.user-list-item, [data-testid="results-list"] > div',
    ));
  },
};

function findListProfileCards() {
  const host = window.location.hostname.toLowerCase();
  for (const [pattern, finder] of Object.entries(LIST_VIEW_FINDERS)) {
    if (!host.includes(pattern)) continue;
    try {
      const cards = finder();
      if (cards.length > 0) return { host: pattern, cards };
    } catch {
      // ignore — DOM access throws in sandboxed frames
    }
  }
  return { host: null, cards: [] };
}

/** Identify which connector (LinkedIn / Indeed / ...) the current page
 *  belongs to. Returns the connector id ('linkedin', 'indeed', ...) when
 *  the host + URL pattern matches a known parser, else null. Mirrors the
 *  backend `getConnector(id)` ids. */
function detectVendorConnector() {
  const host = window.location.hostname.toLowerCase();
  for (const [id, config] of Object.entries(PROFILE_SITE_PARSERS)) {
    if (!config.hostPatterns.some((p) => host.includes(p))) continue;
    if (config.urlPatterns && config.urlPatterns.length > 0) {
      const path = window.location.pathname;
      if (!config.urlPatterns.some((re) => re.test(path))) continue;
    }
    return id;
  }
  return null;
}
