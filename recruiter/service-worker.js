/**
 * hired.video Chrome Extension - Recruiter Service Worker
 *
 * Extension-specific handlers appended after service-worker-base.js
 * by the build script. Adds forwarding for profileDetected and
 * companyDetected messages from the recruiter content scripts.
 */

// ---- Recruiter-specific message handlers --------------------------------
// These are added to the existing chrome.runtime.onMessage listener chain
// from service-worker-base.js. Chrome allows multiple listeners.

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ---- Profile-detected forwarding (from content-script-profiles.js) ----
  if (request.action === 'profileDetected') {
    chrome.runtime.sendMessage(request).catch(() => {});
    return false;
  }

  // ---- Company-detected forwarding (from content-script-companies.js) ---
  if (request.action === 'companyDetected') {
    chrome.runtime.sendMessage(request).catch(() => {});
    return false;
  }

  // ---- Focused profile HTML retrieval -----------------------------------
  if (request.action === 'getFocusedProfileHTML') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
        sendResponse({ html: null, originUrl: tab?.url });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'getFocusedProfileHTML' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          sendResponse({ html: null, originUrl: tab.url });
        } else {
          sendResponse({ html: response.html, originUrl: response.originUrl || tab.url });
        }
      });
    });
    return true; // async response
  }

  // ---- Focused company HTML retrieval -----------------------------------
  if (request.action === 'getFocusedCompanyHTML') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
        sendResponse({ html: null, originUrl: tab?.url });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'getFocusedCompanyHTML' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          sendResponse({ html: null, originUrl: tab.url });
        } else {
          sendResponse({ html: response.html, originUrl: response.originUrl || tab.url });
        }
      });
    });
    return true; // async response
  }

  return false;
});
