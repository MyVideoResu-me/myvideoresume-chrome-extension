/**
 * hired.video Chrome Extension - Recruiter Constants
 *
 * Extends the shared PATHS object with recruiter-specific API endpoints
 * and adds profile/company site parsers for auto-detection.
 *
 * Loaded AFTER constants.js so PATHS, JOB_SITE_PARSERS, etc. already exist.
 */

// ---- Recruiter API paths ------------------------------------------------
// Guard: only extends PATHS when loaded in the sidepanel context (where
// constants.js was loaded first). In content-script context PATHS doesn't
// exist and we only need the site parsers below.

if (typeof PATHS !== 'undefined') {
  PATHS.recruiterExtractProfile = '/api/recruiter/extract-profile';
  PATHS.recruiterExtractProfilesBatch = '/api/recruiter/extract-profiles/batch';
  PATHS.recruiterLists = '/api/recruiter/lists';
  PATHS.recruiterSequences = '/api/recruiter/sequences';
  PATHS.phoneCall = '/api/phone/call';
  PATHS.phoneNumbers = '/api/phone/numbers';
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

  // Recruiter's own posted jobs (used by the "Add to job" picker after
  // extracting a candidate — matches Loxo Boost's "add to jobs / lists /
  // call queues" capability).
  PATHS.userJobs = '/api/jobs/user-jobs';

  // Messaging (direct conversations)
  PATHS.messagesInbox = '/api/messages/inbox';
  PATHS.messagesConversations = '/api/messages/conversations';
  PATHS.messagesPersonalize = '/api/messages/personalize';
}

// ---- Computed URLs (populated after updateConfiguration runs) -----------

var recruiterExtractProfileUrl;
var recruiterExtractProfilesBatchUrl;
var recruiterListsUrl;
var recruiterSequencesUrl;
var phoneCallUrl;
var phoneNumbersUrl;
var recruiterTalentPoolUrl;
var recruiterPipelineUrl;
var recruiterMatchScoreCandidatesUrl;
var recruiterMatchScoreJobsUrl;
var recruiterMatchScoresUrl;
var recruiterInteractionsUrl;
var recruiterSubmissionsUrl;
var userJobsUrl;
var companiesExtractUrl;
var messagesInboxUrl;
var messagesConversationsUrl;
var messagesPersonalizeUrl;

// Patch updateConfiguration to also set recruiter URLs.
// Only runs in sidepanel context where updateConfiguration exists.
if (typeof updateConfiguration === 'function') {
  const _origUpdateConfiguration = updateConfiguration;
  updateConfiguration = function () {
    _origUpdateConfiguration();
    recruiterExtractProfileUrl = apiBase + PATHS.recruiterExtractProfile;
    recruiterExtractProfilesBatchUrl = apiBase + PATHS.recruiterExtractProfilesBatch;
    recruiterListsUrl = apiBase + PATHS.recruiterLists;
    recruiterSequencesUrl = apiBase + PATHS.recruiterSequences;
    phoneCallUrl = apiBase + PATHS.phoneCall;
    phoneNumbersUrl = apiBase + PATHS.phoneNumbers;
    recruiterTalentPoolUrl = apiBase + PATHS.recruiterTalentPool;
    recruiterPipelineUrl = apiBase + PATHS.recruiterPipeline;
    recruiterMatchScoreCandidatesUrl = apiBase + PATHS.recruiterMatchScoreCandidates;
    recruiterMatchScoreJobsUrl = apiBase + PATHS.recruiterMatchScoreJobs;
    recruiterMatchScoresUrl = apiBase + PATHS.recruiterMatchScores;
    recruiterInteractionsUrl = apiBase + PATHS.recruiterInteractions;
    recruiterSubmissionsUrl = apiBase + PATHS.recruiterSubmissions;
    userJobsUrl = apiBase + PATHS.userJobs;
    companiesExtractUrl = apiBase + PATHS.companiesExtract;
    messagesInboxUrl = apiBase + PATHS.messagesInbox;
    messagesConversationsUrl = apiBase + PATHS.messagesConversations;
    messagesPersonalizeUrl = apiBase + PATHS.messagesPersonalize;
  };
}

// PROFILE_SITE_PARSERS lifted to shared/profile-parsers.js so the
// seeker-side Vendor Sync flow can share the same selectors. Both
// manifests now load profile-parsers.js before this file.

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
