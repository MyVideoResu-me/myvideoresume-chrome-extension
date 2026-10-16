/**
 * hired.video Chrome Extension - Detection relay
 *
 * Appended after service-worker-base.js by the build script for every
 * extension that detects more than jobs (recruiter + the unified app).
 * Forwards profile / company / list-view / post detections from the
 * content scripts to the side panel, and relays the side panel's
 * "give me the focused profile / company / list HTML" requests to the
 * active tab.
 */

// ---- Shared helper ------------------------------------------------------
//
// Every getFooHTML / getFooCardsHTML handler does the same three things:
//   1. find the active tab
//   2. forward the request to the page's content script
//   3. relay the response (or a null fallback) back to the caller
// Extracted here so the per-action listeners are one-liners.

function forwardToActiveTab(action, extra, sendResponse) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
      sendResponse({ html: null, originUrl: tab?.url });
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action, ...(extra || {}) }, (response) => {
      if (chrome.runtime.lastError || !response) {
        sendResponse({ html: null, originUrl: tab.url });
      } else {
        sendResponse({ ...response, originUrl: response.originUrl || tab.url });
      }
    });
  });
}

// ---- Detection message handlers ------------------------------------------
// These are added to the existing chrome.runtime.onMessage listener chain
// from service-worker-base.js. Chrome allows multiple listeners.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ---- Detection-event forwarding (content-script → side panel) ----
  if (request.action === 'profileDetected'
      || request.action === 'companyDetected'
      || request.action === 'listViewDetected'
      || request.action === 'listViewCleared'
      || request.action === 'postDetected'
      || request.action === 'postCleared') {
    chrome.runtime.sendMessage(request).catch(() => {});
    return false;
  }

  // ---- HTML fetchers (side panel → active tab content script) ----
  if (request.action === 'getFocusedProfileHTML'
      || request.action === 'getFocusedCompanyHTML'
      || request.action === 'detectProfile'
      || request.action === 'detectPost') {
    forwardToActiveTab(request.action, null, sendResponse);
    return true; // async response
  }

  if (request.action === 'getListCardsHTML') {
    forwardToActiveTab('getListCardsHTML', { limit: request.limit }, sendResponse);
    return true;
  }

  return false;
});
