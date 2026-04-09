/**
 * hired.video Chrome Extension - Recruiter Constants
 *
 * Extends the shared PATHS object with recruiter-specific API endpoints
 * and adds profile/company site parsers for auto-detection.
 *
 * Loaded AFTER constants.js so PATHS, JOB_SITE_PARSERS, etc. already exist.
 */

// ---- Recruiter API paths ------------------------------------------------

PATHS.recruiterExtractProfile = '/api/recruiter/extract-profile';
PATHS.recruiterTalentPool = '/api/recruiter/talent-pool';
PATHS.recruiterTalentPoolExport = '/api/recruiter/talent-pool/export';
PATHS.recruiterInteractions = '/api/recruiter/interactions';
PATHS.recruiterSubmissions = '/api/recruiter/submissions';
PATHS.recruiterPlacements = '/api/recruiter/placements';
PATHS.recruiterPipeline = '/api/recruiter/pipeline';
PATHS.recruiterMatchScoreCandidates = '/api/recruiter/match/score-candidates';
PATHS.recruiterMatchScoreJobs = '/api/recruiter/match/score-jobs';
PATHS.recruiterMatchScores = '/api/recruiter/match/scores';
PATHS.companiesExtract = '/api/companies/extract';

// ---- Computed URLs (populated after updateConfiguration runs) -----------

let recruiterExtractProfileUrl;
let recruiterTalentPoolUrl;
let recruiterPipelineUrl;
let recruiterMatchScoreCandidatesUrl;
let recruiterMatchScoreJobsUrl;
let recruiterMatchScoresUrl;
let companiesExtractUrl;

// Patch updateConfiguration to also set recruiter URLs.
// Save the original, then wrap it.
const _origUpdateConfiguration = updateConfiguration;
updateConfiguration = function () {
  _origUpdateConfiguration();
  recruiterExtractProfileUrl = apiBase + PATHS.recruiterExtractProfile;
  recruiterTalentPoolUrl = apiBase + PATHS.recruiterTalentPool;
  recruiterPipelineUrl = apiBase + PATHS.recruiterPipeline;
  recruiterMatchScoreCandidatesUrl = apiBase + PATHS.recruiterMatchScoreCandidates;
  recruiterMatchScoreJobsUrl = apiBase + PATHS.recruiterMatchScoreJobs;
  recruiterMatchScoresUrl = apiBase + PATHS.recruiterMatchScores;
  companiesExtractUrl = apiBase + PATHS.companiesExtract;
};

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

// ---- Profile pane selectors (wider container for extraction) ------------

const PROFILE_PANE_SELECTORS = {
  linkedin: [
    '.scaffold-layout__main',
    '.pv-profile-section',
    'main',
  ],
  indeed: [
    '.resume-body',
    '#resume-body',
    'main',
  ],
};

// ---- Company site parsers -----------------------------------------------

const COMPANY_SITE_PARSERS = {
  linkedin: {
    hostPatterns: ['linkedin.com'],
    urlPatterns: [/\/company\/[^/]+/],
    selectors: [
      '.org-top-card-summary',
      '.org-top-card',
      '[class*="org-top-card"]',
    ],
    nameSelectors: [
      '.org-top-card-summary__title',
      'h1',
    ],
    industrySelectors: [
      '.org-top-card-summary-info-list__info-item:nth-child(1)',
      '.org-about-company-module__company-page-url + dd',
    ],
    sizeSelectors: [
      '.org-about-company-module__company-staff-count-range',
      '[data-test-id="about-us__size"]',
    ],
    locationSelectors: [
      '.org-top-card-summary-info-list__info-item:nth-child(2)',
      '.org-locations-module__locations',
    ],
    websiteSelectors: [
      '.org-about-company-module__company-page-url a',
      '[data-test-id="about-us__website"] a',
    ],
  },
  glassdoor: {
    hostPatterns: ['glassdoor.com'],
    urlPatterns: [/\/Overview\//],
    selectors: [
      '[data-test="employer-overview"]',
      '.employer-overview',
    ],
    nameSelectors: ['h1', '.employer-name'],
    industrySelectors: ['.employer-overview-industry'],
    sizeSelectors: ['.employer-overview-size'],
    locationSelectors: ['.employer-overview-location'],
    websiteSelectors: ['.employer-overview-website a'],
  },
};

// ---- Company pane selectors ---------------------------------------------

const COMPANY_PANE_SELECTORS = {
  linkedin: [
    '.org-top-card',
    '.scaffold-layout__main',
    'main',
  ],
  glassdoor: [
    '[data-test="employer-overview"]',
    '.employer-overview',
    'main',
  ],
};
