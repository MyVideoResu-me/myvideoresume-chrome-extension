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
    hostPatterns: ['indeed.com'],
    urlPatterns: [/\/resumes?\//],
    selectors: [
      '.resume-body',
      '#resume-body',
      '.icl-ResumeBody',
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
        // ignore — DOM access can throw inside a sandboxed frame
      }
    }
  }
  return null;
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
