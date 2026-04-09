/**
 * hired.video Chrome Extension - Configuration
 * All backend endpoint definitions, runtime config, and the job-site
 * scraping rules used by the content script & side panel.
 */

const jwtTokenKey = 'jwtToken';
const selectedResumeKey = 'selectedResumeId';
const trackedJobKey = 'currentTrackedJob';
const isDevelopment = false;
const showConsoleAlerts = false;

// API Base URLs
// Dev: run `npm run dev` in /api — Node.js server on port 5000
// Prod: Cloudflare Worker at api.hired.video
const apiBaseDev = 'http://localhost:5000';
const apiBaseProd = 'https://api.hired.video';

// Web App Base URLs (used to delegate login flows that the extension
// itself can't host — OAuth, magic link, 2FA, etc.)
// The production frontend is hosted at the apex hired.video — there is
// no `app.` subdomain (verified against api/wrangler.toml FRONTEND_URL).
const webBaseDev = 'http://localhost:3000';
const webBaseProd = 'https://hired.video';

// ---- Endpoint paths (relative — joined onto apiBase at runtime) ----

const PATHS = {
  // Auth
  login: '/api/auth/login',
  register: '/api/auth/register',
  logout: '/api/auth/logout',
  me: '/api/auth/me',
  refresh: '/api/auth/refresh',
  magicLink: '/api/auth/magic-link',
  // OAuth start: append the provider, e.g. /api/auth/oauth/google
  oauthStart: '/api/auth/oauth',

  // Match (job <-> resume scoring + tailoring)
  matchAnalyze: '/api/match/analyze',
  matchTailor: '/api/match/tailor',

  // Resumes
  resumes: '/api/resumes',
  resumeMasterGroups: '/api/resumes/mastergroups',
  resumeParse: '/api/resumes/parse',
  resumeCreateFromFile: '/api/resumes/createfromfile',
  // Per-resume actions append the id and verb: /api/resumes/{id}/{action}
  resumeBase: '/api/resumes',

  // Jobs
  jobs: '/api/jobs',
  jobsExtract: '/api/jobs/extract',
  jobsSaved: '/api/jobs/saved',
  // Per-job actions append the id and verb
  jobBase: '/api/jobs',

  // User profile + billing
  userProfile: '/api/users/profile',
  billingSubscription: '/api/billing/subscription',
};

// Active endpoints — populated by updateConfiguration() at startup.
let apiBase = apiBaseDev;
let webBase = webBaseDev;
let login;
let matchAnalyze;
let matchTailor;
let masterResumeGroups;
let resumeBase;
let resumesBase;
let resumeParseUrl;
let resumeCreateFromFileUrl;
let jobsBase;
let jobsExtractUrl;
let jobsSavedUrl;
let userProfileUrl;
let meUrl;
let magicLinkUrl;
let oauthStartUrl;

function updateConfiguration() {
    apiBase = isDevelopment ? apiBaseDev : apiBaseProd;
    webBase = isDevelopment ? webBaseDev : webBaseProd;

    login = apiBase + PATHS.login;
    matchAnalyze = apiBase + PATHS.matchAnalyze;
    matchTailor = apiBase + PATHS.matchTailor;
    masterResumeGroups = apiBase + PATHS.resumeMasterGroups;
    resumeBase = apiBase + PATHS.resumeBase;
    resumesBase = apiBase + PATHS.resumes;
    resumeParseUrl = apiBase + PATHS.resumeParse;
    resumeCreateFromFileUrl = apiBase + PATHS.resumeCreateFromFile;
    jobsBase = apiBase + PATHS.jobBase;
    jobsExtractUrl = apiBase + PATHS.jobsExtract;
    jobsSavedUrl = apiBase + PATHS.jobsSaved;
    userProfileUrl = apiBase + PATHS.userProfile;
    meUrl = apiBase + PATHS.me;
    magicLinkUrl = apiBase + PATHS.magicLink;
    oauthStartUrl = apiBase + PATHS.oauthStart;
}

// Helper: build /api/resumes/{id}/{action}?{queryParams}
function buildResumeUrl(resumeId, action, queryParams = '') {
    let url = `${resumeBase}/${resumeId}/${action}`;
    if (queryParams) {
        url += `?${queryParams}`;
    }
    return url;
}

// Helper: build /api/jobs/{id}/{action}
function buildJobUrl(jobId, action = '') {
    let url = `${jobsBase}/${jobId}`;
    if (action) {
        url += `/${action}`;
    }
    return url;
}

// Helper: build the web-app URL for an authed deep link
function buildWebUrl(path = '/') {
    return webBase + path;
}

function consoleAlerts(text) {
    if (isDevelopment || showConsoleAlerts) {
        console.log(text);
    }
}

function findWholeWord(text, word) {
    const regex = new RegExp('\\b' + word + '\\b');
    return regex.test(text);
}

/**
 * Site-specific job description selectors
 * Each site has an array of selectors to try in order of specificity
 */
const JOB_SITE_PARSERS = {
    // LinkedIn
    linkedin: {
        hostPatterns: ['linkedin.com'],
        selectors: [
            '.jobs-description__container',
            '.jobs-description-content__text',
            '.jobs-box__html-content',
            '.description__text',
            '[class*="jobs-description"]',
            '.job-view-layout'
        ]
    },
    // Indeed
    indeed: {
        hostPatterns: ['indeed.com'],
        selectors: [
            '#jobDescriptionText',
            '.jobsearch-jobDescriptionText',
            '[class*="jobsearch-BodyContainer"]',
            '.jobsearch-JobComponent-description',
            '[data-testid="jobDescriptionText"]'
        ]
    },
    // Glassdoor
    glassdoor: {
        hostPatterns: ['glassdoor.com'],
        selectors: [
            '.jobDescriptionContent',
            '[class*="JobDetails_jobDescription"]',
            '.desc',
            '.jobDescriptionContainer'
        ]
    },
    // ZipRecruiter
    ziprecruiter: {
        hostPatterns: ['ziprecruiter.com'],
        selectors: [
            '.job_description',
            '.jobDescriptionSection',
            '[class*="job_description"]',
            '.job-body'
        ]
    },
    // Monster
    monster: {
        hostPatterns: ['monster.com'],
        selectors: [
            '[class*="DescriptionContainerOuter"]',
            '[data-testid*="svx-description-container-inner"]',
            '[data-testid*="svx-job-view-wrapper"]',
            '.job-description'
        ]
    },
    // CareerBuilder
    careerbuilder: {
        hostPatterns: ['careerbuilder.com'],
        selectors: [
            '.jdp-job-description-card',
            '.job-description',
            '[class*="job-description"]'
        ]
    },
    // Dice
    dice: {
        hostPatterns: ['dice.com'],
        selectors: [
            '#jobdescSec',
            '.job-description',
            '[data-testid="jobDescriptionHtml"]'
        ]
    },
    // SimplyHired
    simplyhired: {
        hostPatterns: ['simplyhired.com'],
        selectors: [
            '.viewjob-description',
            '.jobDescriptionContainer'
        ]
    },
    // Lever (ATS used by many companies)
    lever: {
        hostPatterns: ['lever.co', 'jobs.lever.co'],
        selectors: [
            '.section-wrapper',
            '.posting-requirements',
            '.content-wrapper'
        ]
    },
    // Greenhouse (ATS used by many companies)
    greenhouse: {
        hostPatterns: ['greenhouse.io', 'boards.greenhouse.io'],
        selectors: [
            '#content',
            '.content',
            '.job-post-body'
        ]
    },
    // Workday (ATS used by many companies)
    workday: {
        hostPatterns: ['myworkdayjobs.com', 'wd1.myworkdaysite.com', 'wd5.myworkdaysite.com'],
        selectors: [
            '[data-automation-id="jobPostingDescription"]',
            '.css-cygeeu',
            '[data-automation-id="job-posting-description"]'
        ]
    },
    // Ladder
    ladder: {
        hostPatterns: ['theladders.com'],
        selectors: [
            '.job-list-detail-container'
        ]
    },
    // RipRecruitr / Generic
    riprecruiter: {
        hostPatterns: ['riprecruiter.com'],
        selectors: [
            '[data-testid*="right-pane"]',
            '.job_details_wrapper',
            '.job_details',
            '.job_description'
        ]
    },
    // AngelList / Wellfound
    angellist: {
        hostPatterns: ['angel.co', 'wellfound.com'],
        selectors: [
            '.job-listing-content',
            '[class*="styles_description"]',
            '.description'
        ]
    },
    // Builtin
    builtin: {
        hostPatterns: ['builtin.com'],
        selectors: [
            '.job-description',
            '[class*="job-description"]'
        ]
    }
};

/**
 * Wider container selectors for the FOCUSED job pane on each major site.
 * Used by the Track-this-Job flow so the AI sees the title + meta +
 * description for the active job, not the surrounding job list / sidebar.
 *
 * Order matters: most-specific first, falling back to broader containers.
 */
const JOB_PANE_SELECTORS = {
    // Order matters: tightest container first (the right pane on a job
    // collection page) before broader fallbacks. NEVER use `main` or
    // `.scaffold-layout__detail` here on LinkedIn — those wrap the
    // ENTIRE multi-job view including the left rail.
    linkedin: [
        '.jobs-search__job-details--container',
        '.jobs-search__job-details',
        '.jobs-details',
        '.job-view-layout',
        '.top-card-layout',
        '[class*="job-details-jobs-unified-top-card"]',
    ],
    indeed: [
        '.jobsearch-JobComponent',
        '#viewJobSSRRoot',
        '.jobsearch-ViewJobLayout--embedded',
        '.jobsearch-ViewJobLayout',
        '#jobDescriptionText',
    ],
    glassdoor: [
        '[class*="JobDetails_jobDetails"]',
        '.JobDetails',
        '#JDCol',
        '.adp',
    ],
    workday: [
        '[data-automation-id="jobPostingPage"]',
        '[data-automation-id="job-posting"]',
        '[data-automation-id="jobPostingDescription"]',
    ],
    greenhouse: [
        '#main',
        '.app-body',
        '#content',
    ],
    lever: [
        '.posting-page',
        '.content-wrapper',
    ],
    ziprecruiter: [
        '.job_details',
        '#job_desc',
    ],
    monster: [
        '[class*="job-view-wrapper"]',
        '[data-testid*="svx-job-view-wrapper"]',
    ],
    careerbuilder: [
        '.jdp-content',
        '.job-details',
    ],
    dice: [
        '#jobInformation',
        '#jobdescSec',
    ],
    builtin: [
        '.job-detail',
        '#job-content',
    ],
    angellist: [
        '.job-listing-content',
        '[class*="styles_jobDetails"]',
    ],
};

/**
 * Generic fallback selectors that work on many sites
 */
const GENERIC_SELECTORS = [
    // Common class names
    '.job-description',
    '.jobDescription',
    '.job_description',
    '#job-description',
    '#jobDescription',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[id*="job-description"]',
    '[id*="jobDescription"]',
    // Common data attributes
    '[data-testid*="description"]',
    '[data-automation-id*="description"]',
    // Semantic HTML
    'article[class*="job"]',
    'main[class*="job"]',
    // Schema.org structured data containers
    '[itemtype*="JobPosting"]',
    // Common patterns
    '.posting-content',
    '.job-content',
    '.job-details',
    '.job-info'
];

/**
 * Parse job description from HTML based on URL and content
 * @param {string} text - The full HTML of the page
 * @param {string} originUrl - The URL of the page (optional)
 * @returns {string} - Extracted job description HTML or full page HTML as fallback
 */
function jobDescriptionParser(text, originUrl) {
    // Parse the HTML string into a DOM Document
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');

    // Determine which site we're on based on URL
    let siteParser = null;
    if (originUrl) {
        const url = originUrl.toLowerCase();
        for (const [siteName, config] of Object.entries(JOB_SITE_PARSERS)) {
            if (config.hostPatterns.some(pattern => url.includes(pattern))) {
                siteParser = config;
                consoleAlerts(`Detected job site: ${siteName}`);
                break;
            }
        }
    }

    // Try site-specific selectors first
    if (siteParser) {
        for (const selector of siteParser.selectors) {
            const container = doc.querySelector(selector);
            if (container && container.innerHTML.trim().length > 100) {
                consoleAlerts(`Found job description using selector: ${selector}`);
                return container.innerHTML;
            }
        }
    }

    // Try generic selectors as fallback
    for (const selector of GENERIC_SELECTORS) {
        try {
            const container = doc.querySelector(selector);
            if (container && container.innerHTML.trim().length > 100) {
                consoleAlerts(`Found job description using generic selector: ${selector}`);
                return container.innerHTML;
            }
        } catch (e) {
            // Some selectors might be invalid, skip them
            continue;
        }
    }

    // Try to extract from JSON-LD structured data (many sites use this)
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
        try {
            const data = JSON.parse(script.textContent);
            // Handle array of objects
            const items = Array.isArray(data) ? data : [data];
            for (const item of items) {
                if (item['@type'] === 'JobPosting' && item.description) {
                    consoleAlerts('Found job description in JSON-LD structured data');
                    return item.description;
                }
            }
        } catch (e) {
            // Invalid JSON, skip
            continue;
        }
    }

    // Last resort: return body content (stripped of scripts/styles)
    const body = doc.body;
    if (body) {
        // Remove script and style elements
        const scripts = body.querySelectorAll('script, style, nav, header, footer');
        scripts.forEach(el => el.remove());

        // Try to find the main content area
        const main = body.querySelector('main') || body.querySelector('[role="main"]') || body.querySelector('article');
        if (main && main.innerHTML.trim().length > 200) {
            consoleAlerts('Using main content area as fallback');
            return main.innerHTML;
        }
    }

    consoleAlerts('Could not extract job description, returning full HTML');
    return text;
}

/**
 * Extract the FOCUSED job pane (title + meta + description) for the
 * Track-this-Job flow. Returns a wider container than jobDescriptionParser
 * so the AI classifier sees the actual job heading, not just the body.
 *
 * Falls back to jobDescriptionParser → full HTML when no known pane
 * selector matches.
 */
function extractJobPane(text, originUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    const lower = (originUrl || '').toLowerCase();

    // Find the best site config
    let siteName = null;
    if (originUrl) {
        for (const [name, config] of Object.entries(JOB_SITE_PARSERS)) {
            if (config.hostPatterns.some((p) => lower.includes(p))) {
                siteName = name;
                break;
            }
        }
    }

    // Try the wider pane selectors first
    if (siteName && JOB_PANE_SELECTORS[siteName]) {
        for (const selector of JOB_PANE_SELECTORS[siteName]) {
            try {
                const el = doc.querySelector(selector);
                if (el && el.innerHTML.trim().length > 200) {
                    consoleAlerts(`extractJobPane: pane via ${selector}`);
                    // Return outerHTML so the heading + meta are preserved
                    return el.outerHTML;
                }
            } catch (e) {
                continue;
            }
        }
    }

    // Try JSON-LD JobPosting structured data — if present, return the
    // raw script block plus the document title so the backend gets a
    // perfect signal regardless of which container is wrapping things.
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (const script of jsonLdScripts) {
        try {
            const data = JSON.parse(script.textContent);
            const items = Array.isArray(data) ? data : [data];
            const hasJobPosting = items.some((item) => item && item['@type'] === 'JobPosting');
            if (hasJobPosting) {
                consoleAlerts('extractJobPane: JSON-LD JobPosting found');
                return script.outerHTML;
            }
        } catch (e) {
            continue;
        }
    }

    // Fall back to the description-only parser
    const desc = jobDescriptionParser(text, originUrl);
    if (desc && desc !== text) return desc;

    // Last resort: full HTML (the backend will reject it as not-a-job
    // if the AI can't find a single posting in there)
    return text;
}
