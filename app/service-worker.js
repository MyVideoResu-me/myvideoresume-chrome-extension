/**
 * hired.video Chrome Extension - Unified app service worker
 *
 * Appended after service-worker-base.js + service-worker-detection.js by
 * the build script. Adds the three things only the unified side panel
 * needs:
 *
 *   openPanel     — the in-page pill (content-script-pill.js) asks to open
 *                   the side panel with an intent ("track this job"). The
 *                   intent is parked in chrome.storage.session so a panel
 *                   that is still booting picks it up, and broadcast for
 *                   a panel that is already open.
 *   fillComposer  — the side panel hands over a message / reply text; we
 *                   inject content-script-composer.js into the active tab
 *                   and it types the text into the open message box. It
 *                   NEVER presses Send — the person does.
 *   readSelection — returns the text the person selected on the page
 *                   (the "use my selection as the post" fallback).
 */

const PENDING_INTENT_KEY = 'pendingPanelIntent';

function withActiveTab(sendResponse, run) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
      sendResponse({ ok: false, error: 'no_tab' });
      return;
    }
    run(tab);
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'openPanel') {
    const tabId = sender.tab && sender.tab.id;
    const intent = { ...(request.intent || {}), tabId, at: Date.now() };
    chrome.storage.session.set({ [PENDING_INTENT_KEY]: intent }).catch(() => {});
    chrome.runtime.sendMessage({ action: 'panelIntent', intent }).catch(() => {});
    if (tabId !== undefined && chrome.sidePanel && chrome.sidePanel.open) {
      // Must run inside the click's user-gesture window — no awaits above.
      chrome.sidePanel.open({ tabId }).catch(() => {});
    }
    return false;
  }

  if (request.action === 'fillComposer') {
    withActiveTab(sendResponse, (tab) => {
      chrome.scripting.executeScript(
        { target: { tabId: tab.id }, files: ['content-script-composer.js'] },
        () => {
          if (chrome.runtime.lastError) {
            sendResponse({ ok: false, error: 'inject_failed' });
            return;
          }
          chrome.tabs.sendMessage(tab.id, { action: 'fillComposer', text: request.text || '' }, (response) => {
            if (chrome.runtime.lastError || !response) {
              sendResponse({ ok: false, error: 'no_response' });
            } else {
              sendResponse(response);
            }
          });
        },
      );
    });
    return true;
  }

  if (request.action === 'readSelection') {
    withActiveTab(sendResponse, (tab) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: () => ({
            text: String(window.getSelection ? window.getSelection() : '').trim().slice(0, 4000),
            url: window.location.href,
            title: document.title,
          }),
        },
        (result) => {
          if (chrome.runtime.lastError || !result || !result[0]) {
            sendResponse({ ok: false, error: 'read_failed' });
          } else {
            sendResponse({ ok: true, ...result[0].result });
          }
        },
      );
    });
    return true;
  }

  return false;
});
