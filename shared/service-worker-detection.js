/**
 * hired.video Chrome Extension - Recruiter Service Worker
 *
 * Extension-specific handlers appended after service-worker-base.js
 * by the build script. Adds forwarding for profileDetected and
 * companyDetected messages from the recruiter content scripts.
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

// ---- Recruiter-specific message handlers --------------------------------
// These are added to the existing chrome.runtime.onMessage listener chain
// from service-worker-base.js. Chrome allows multiple listeners.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ---- Detection-event forwarding (content-script → side panel) ----
  if (request.action === 'profileDetected'
      || request.action === 'companyDetected'
      || request.action === 'listViewDetected'
      || request.action === 'listViewCleared') {
    chrome.runtime.sendMessage(request).catch(() => {});
    return false;
  }

  // ---- HTML fetchers (side panel → active tab content script) ----
  if (request.action === 'getFocusedProfileHTML'
      || request.action === 'getFocusedCompanyHTML') {
    forwardToActiveTab(request.action, null, sendResponse);
    return true; // async response
  }

  if (request.action === 'getListCardsHTML') {
    forwardToActiveTab('getListCardsHTML', { limit: request.limit }, sendResponse);
    return true;
  }

  return false;
});
