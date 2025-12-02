const jwtTokenKey = 'jwtToken';
const selectedResumeKey = 'selectedResumeId';
const isDevelopment = false;
const showConsoleAlerts = false;

// API Base URLs
const apiBaseDev = 'http://localhost:5000';
const apiBaseProd = 'https://api.myvideoresu.me';

// Auth Endpoints
const loginDev = `${apiBaseDev}/api/Auth/login`;
const loginProd = `${apiBaseProd}/api/Auth/login`;

// Match API Endpoints (New v2 endpoints)
const matchAnalyzeDev = `${apiBaseDev}/api/Match/analyze`;
const matchAnalyzeProd = `${apiBaseProd}/api/Match/analyze`;
const matchTailorDev = `${apiBaseDev}/api/Match/tailor`;
const matchTailorProd = `${apiBaseProd}/api/Match/tailor`;

// Legacy Chrome Extension Endpoints (kept for fallback)
const legacyCreatejobbestmatchDev = `${apiBaseDev}/chrome/createjobbestmatch`;
const legacyCreatejobbestmatchProd = `${apiBaseProd}/chrome/createjobbestmatch`;
const legacyJobresumeanalysisDev = `${apiBaseDev}/chrome/jobresumeanalysis`;
const legacyJobresumeanalysisProd = `${apiBaseProd}/chrome/jobresumeanalysis`;

// Resume API Endpoints
const masterResumeGroupsDev = `${apiBaseDev}/api/Resume/masterGroups`;
const masterResumeGroupsProd = `${apiBaseProd}/api/Resume/masterGroups`;
const resumeBaseDev = `${apiBaseDev}/api/Resume`; // + /{id}/createVariation or /{id}/export
const resumeBaseProd = `${apiBaseProd}/api/Resume`;

// Active endpoints (updated by updateConfiguration)
let apiBase = apiBaseDev;
let login = loginDev;
let matchAnalyze = matchAnalyzeDev;
let matchTailor = matchTailorDev;
let legacyCreatejobbestmatch = legacyCreatejobbestmatchDev;
let legacyJobresumeanalysis = legacyJobresumeanalysisDev;
let masterResumeGroups = masterResumeGroupsDev;
let resumeBase = resumeBaseDev;

// Backward compatibility aliases
let createjobbestmatch = matchTailorDev;  // New endpoint for tailoring
let jobresumeanalysis = matchAnalyzeDev;  // New endpoint for analysis

function updateConfiguration() {
    if (!isDevelopment) {
        apiBase = apiBaseProd;
        login = loginProd;
        matchAnalyze = matchAnalyzeProd;
        matchTailor = matchTailorProd;
        legacyCreatejobbestmatch = legacyCreatejobbestmatchProd;
        legacyJobresumeanalysis = legacyJobresumeanalysisProd;
        masterResumeGroups = masterResumeGroupsProd;
        resumeBase = resumeBaseProd;

        // Update aliases
        createjobbestmatch = matchTailorProd;
        jobresumeanalysis = matchAnalyzeProd;
    }
}

// Helper function to build Resume API URLs
function buildResumeUrl(resumeId, action, queryParams = '') {
    let url = `${resumeBase}/${resumeId}/${action}`;
    if (queryParams) {
        url += `?${queryParams}`;
    }
    return url;
}

function consoleAlerts(text) {
    if (isDevelopment || showConsoleAlerts) {
        alert(text);
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