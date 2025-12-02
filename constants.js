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

function jobDescriptionParser(text, originUrl) {
    let htmlResponse = text;

    // Parse the HTML string into a DOM Document
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');

    let container = doc.querySelector('.jobs-description__container');
    // Check if the element exists
    if (container) {
        // Extract and log the innerHTML
        consoleAlerts(container.innerHTML);
        htmlResponse = container.innerHTML;
    }

    //ladder
    container = doc.querySelector('.job-list-detail-container');
    // Check if the element exists
    if (container) {
        // Extract and log the innerHTML
        consoleAlerts("ladder");
        consoleAlerts(container.innerHTML);
        htmlResponse = container.innerHTML;
    }

    //RipRecruitr
    container = doc.querySelector('[data-testid*="right-pane"]');
    // Check if the element exists
    if (container) {
        // Extract and log the innerHTML
        consoleAlerts("RipRecruitr");
        consoleAlerts(container.innerHTML);
        htmlResponse = container.innerHTML;
    }
    container = document.querySelector('.job_details_wrapper');
    if (container) {
        consoleAlerts("RipRecruitr");
        const containerHTML = container.innerHTML;
        consoleAlerts(containerHTML);
        htmlResponse = containerHTML;
    }    
    container = document.querySelector('.job_details');
    if (container) {
        consoleAlerts("RipRecruitr");
        const containerHTML = container.innerHTML;
        consoleAlerts(containerHTML);
        htmlResponse = containerHTML;
    }    
    container = document.querySelector('.job_description');
    if (container) {
        consoleAlerts("RipRecruitr");
        const containerHTML = container.innerHTML;
        consoleAlerts(containerHTML);
        htmlResponse = containerHTML;
    } 
    
    //inded
    container = doc.querySelector('[class*="jobsearch-BodyContainer"]');
    // Check if the element exists
    if (container) {
        // Extract and log the innerHTML
        consoleAlerts("inded");
        consoleAlerts(container.innerHTML);
        htmlResponse = container.innerHTML;
    }

    //Mnstre
    container = document.querySelector('[class*="DescriptionContainerOuter"]');
    if (container) {
        consoleAlerts("Mnstre");
        const containerHTML = container.innerHTML;
        consoleAlerts(containerHTML);
        htmlResponse = containerHTML;
    }
    container = document.querySelector('div[data-testid*="svx-job-view-wrapper"]');
    if (container) {
        consoleAlerts("Mnstre");
        const containerHTML = container.innerHTML;
        consoleAlerts(containerHTML);
        htmlResponse = containerHTML;
    }
    container = document.querySelector('[data-testid*="svx-description-container-inner"]');
    if (container) {
        consoleAlerts("Mnstre");
        const containerHTML = container.innerHTML;
        consoleAlerts(containerHTML);
        htmlResponse = containerHTML;
    }
    

    return htmlResponse;
}