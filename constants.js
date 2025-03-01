const jwtTokenKey = 'jwtToken';
const isDevelopment = false;
const loginDev = 'https://localhost:7117/auth/login';
const loginProd = 'https://api.myvideoresu.me/auth/login';
const createjobbestmatchDev = 'https://localhost:7117/chrome/createjobbestmatch';
const createjobbestmatchProd = 'https://api.myvideoresu.me/chrome/createjobbestmatch';
const jobresumeanalysisDev = 'https://localhost:7117/chrome/jobresumeanalysis';
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
    if (isDevelopment) {
        alert(text);
    }
}

function findWholeWord(text, word) {
    const regex = new RegExp('\\b' + word + '\\b');
    return regex.test(text);
}

function jobDescriptionParser(text, originUrl) {
    let htmlResponse = text;
    const parser = new DOMParser();

    // Parse the HTML string into a DOM Document
    const doc = parser.parseFromString(text, 'text/html');

    const container = doc.querySelector('.jobs-description__container');
    // Check if the element exists
    if (container) {
        // Extract and log the innerHTML
        consoleAlerts(container.innerHTML);
        htmlResponse = container.innerHTML;
    }

    return htmlResponse;
}