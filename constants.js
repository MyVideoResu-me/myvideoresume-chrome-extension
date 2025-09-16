const jwtTokenKey = 'jwtToken';
const isDevelopment = false;
const showConsoleAlerts = true;
const loginDev = 'http://localhost:5000/api/Auth/login';
const loginProd = 'https://api.myvideoresu.me/api/Auth/login';
const createjobbestmatchDev = 'http://localhost:5000/chrome/createjobbestmatch';
const createjobbestmatchProd = 'https://api.myvideoresu.me/chrome/createjobbestmatch';
const jobresumeanalysisDev = 'http://localhost:5000/chrome/jobresumeanalysis';
const jobresumeanalysisProd = 'https://api.myvideoresu.me/chrome/jobresumeanalysis';

let login = loginDev;
let createjobbestmatch = createjobbestmatchDev;
let jobresumeanalysis = jobresumeanalysisDev;

function updateConfiguration() {
    if (!isDevelopment) {
        login = loginProd;
        createjobbestmatch = createjobbestmatchProd;
        jobresumeanalysis = jobresumeanalysisProd;
    }
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