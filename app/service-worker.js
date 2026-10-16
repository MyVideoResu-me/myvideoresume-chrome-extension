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
 *   attachFormFile — hands the tailored résumé file to the autofill content
 *                   script, which puts it in the form's file input. It never
 *                   submits the form.
 *
 * Plus the toolbar badge (how many things were detected on the tab) and
 * the "Remind me to apply" alarms the panel schedules.
 */

const PENDING_INTENT_KEY = 'pendingPanelIntent';
// Keep in step with app/src/panel/state/reminders.ts.
const REMINDERS_KEY = 'applyReminders';
const REMINDER_ALARM_PREFIX = 'applyReminder:';

// ---- Toolbar badge: detections on each tab ---------------------------
// Distinct things the detectors found on a tab ("h 1" on the toolbar).
// Lost if the worker sleeps — the next detection repaints it.
const detectionsByTab = new Map();
const BADGE_KIND = { jobDetected: 'job', profileDetected: 'profile', postDetected: 'post' };

function paintBadge(tabId) {
  const count = (detectionsByTab.get(tabId) || new Set()).size;
  chrome.action.setBadgeText({ tabId, text: count ? String(count) : '' }).catch(() => {});
}

chrome.action.setBadgeBackgroundColor({ color: '#2563EB' }).catch(() => {});

function noteDetection(request, sender) {
  const tabId = sender.tab && sender.tab.id;
  if (tabId === undefined) return;
  if (request.action === 'urlChanged') {
    detectionsByTab.delete(tabId);
  } else if (request.action === 'postCleared') {
    const set = detectionsByTab.get(tabId);
    if (set) for (const key of [...set]) if (key.startsWith('post|')) set.delete(key);
  } else {
    const kind = BADGE_KIND[request.action];
    if (!kind) return;
    const p = request.payload || {};
    const set = detectionsByTab.get(tabId) || new Set();
    set.add(`${kind}|${p.sourceUrl || ''}|${p.title || p.name || p.author || ''}`);
    detectionsByTab.set(tabId, set);
  }
  paintBadge(tabId);
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) {
    detectionsByTab.delete(tabId);
    paintBadge(tabId);
  }
});
chrome.tabs.onRemoved.addListener((tabId) => detectionsByTab.delete(tabId));

// ---- "Remind me to apply" -------------------------------------------
// The panel stores { [jobId]: { at, title } } and creates the alarm; when
// it fires we flag the reminder as due and show "!" on the toolbar (no
// notifications permission — the panel shows the due reminder).
chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(REMINDER_ALARM_PREFIX)) return;
  const jobId = alarm.name.slice(REMINDER_ALARM_PREFIX.length);
  chrome.storage.local.get(REMINDERS_KEY, (data) => {
    const all = { ...((data && data[REMINDERS_KEY]) || {}) };
    if (!all[jobId]) return;
    all[jobId] = { ...all[jobId], due: true };
    chrome.storage.local.set({ [REMINDERS_KEY]: all });
    chrome.action.setBadgeText({ text: '!' }).catch(() => {});
  });
});

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
  if (request.action in BADGE_KIND || request.action === 'urlChanged' || request.action === 'postCleared') {
    noteDetection(request, sender);
    return false;
  }

  if (request.action === 'clearReminderBadge') {
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
    return false;
  }

  if (request.action === 'attachFormFile') {
    withActiveTab(sendResponse, (tab) => {
      chrome.tabs.sendMessage(tab.id, request, (response) => {
        if (chrome.runtime.lastError || !response) sendResponse({ ok: false, error: 'no_response' });
        else sendResponse(response);
      });
    });
    return true;
  }

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
