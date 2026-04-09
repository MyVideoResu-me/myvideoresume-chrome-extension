/**
 * hired.video Chrome Extension - Background service worker
 *
 * Responsibilities:
 *   - Open the side panel when the toolbar action is clicked.
 *   - Relay URL-change notifications from the content script to the
 *     side panel so it can clear stale job state.
 *   - Fulfil "getHTML" requests from the side panel by talking to the
 *     content script (preferred) or directly executing a script in
 *     the active tab.
 *   - Receive auth-token sync messages from the auth bridge running
 *     on hired.video and persist them to chrome.storage.local
 *     so the side panel picks them up automatically.
 *   - Silently refresh the JWT before it expires so the user never
 *     has to log in twice as long as they're active.
 */

// ---- Constants ------------------------------------------------------
const REFRESH_ALARM = 'hiredVideoTokenRefresh';
const REFRESH_PERIOD_MINUTES = 60;        // check hourly
const REFRESH_THRESHOLD_SECONDS = 24 * 60 * 60; // refresh when < 24h left

// API base — kept in sync with constants.js. Service workers can't
// import non-module scripts, so it's duplicated here.
const API_BASE = 'https://api.hired.video';

// Origins where the auth bridge runs. Used to find tabs that need a
// hard reload when the extension's own login flow stores a new token.
const HIRED_WEB_ORIGINS = [
  'https://hired.video/*',
  'https://www.hired.video/*',
  'http://localhost:3000/*',
];

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.error(err));

// Schedule the refresh alarm at install + every browser startup.
chrome.runtime.onInstalled.addListener(() => scheduleRefreshAlarm());
chrome.runtime.onStartup.addListener(() => scheduleRefreshAlarm());
scheduleRefreshAlarm();

function scheduleRefreshAlarm() {
  chrome.alarms.get(REFRESH_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(REFRESH_ALARM, {
        delayInMinutes: 1,
        periodInMinutes: REFRESH_PERIOD_MINUTES,
      });
    }
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    refreshTokenIfNeeded().catch((err) => console.error('[hired.video] refresh failed', err));
  }
});

/**
 * Refresh the JWT if it's within REFRESH_THRESHOLD_SECONDS of expiring.
 * Falls back gracefully if the user isn't signed in or the API rejects
 * the existing token (in which case we clear it and let the side panel
 * show the login prompt).
 */
async function refreshTokenIfNeeded() {
  const { jwtToken } = await chrome.storage.local.get('jwtToken');
  if (!jwtToken) return;

  const exp = decodeJwtExp(jwtToken);
  if (!exp) return;

  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = exp - now;

  if (secondsLeft <= 0) {
    await chrome.storage.local.remove('jwtToken');
    chrome.runtime.sendMessage({ action: 'authStateChanged', signedIn: false }).catch(() => {});
    return;
  }

  if (secondsLeft > REFRESH_THRESHOLD_SECONDS) return;

  try {
    const response = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });

    if (response.status === 401) {
      // Token rejected outright — clear and let the user sign in again.
      await chrome.storage.local.remove('jwtToken');
      chrome.runtime.sendMessage({ action: 'authStateChanged', signedIn: false }).catch(() => {});
      return;
    }

    if (!response.ok) return;

    const data = await response.json().catch(() => ({}));
    const newToken = data?.data?.token || data?.token;
    if (newToken) {
      await chrome.storage.local.set({ jwtToken: newToken });
      chrome.runtime.sendMessage({ action: 'authStateChanged', signedIn: true }).catch(() => {});
    }
  } catch (err) {
    console.error('[hired.video] refresh request failed', err);
  }
}

/**
 * Decode the `exp` claim from a JWT without verifying the signature.
 * The service worker can't load jwt-decode (no DOM), so this is a
 * minimal handroll. Returns null on any parse failure.
 */
function decodeJwtExp(token) {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

// ---- Storage change observer ---------------------------------------
// When the extension's own login form stores a fresh token (marked
// with tokenSource: 'extension'), reload any open hired.video tabs
// so they pick up the new session via the auth bridge running at
// document_start.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes.jwtToken || !changes.jwtToken.newValue) return;

  chrome.storage.local.get('tokenSource', (data) => {
    if (data.tokenSource !== 'extension') return;
    // One-shot: clear the marker so subsequent refreshes don't reload tabs.
    chrome.storage.local.remove('tokenSource');

    chrome.tabs.query({ url: HIRED_WEB_ORIGINS }, (tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) chrome.tabs.reload(tab.id);
      }
    });
  });
});

// ---- Message handlers ----------------------------------------------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // ---- Auth token sync from hired.video -----------------------------
  if (request.action === 'authTokenSync') {
    const token = request.token || null;
    if (token) {
      chrome.storage.local.set({ jwtToken: token }, () => {
        chrome.runtime.sendMessage({ action: 'authStateChanged', signedIn: true }).catch(() => {});
      });
    } else {
      chrome.storage.local.remove(['jwtToken'], () => {
        chrome.runtime.sendMessage({ action: 'authStateChanged', signedIn: false }).catch(() => {});
      });
    }
    return false;
  }

  // ---- Manual refresh trigger from the side panel -------------------
  if (request.action === 'refreshTokenNow') {
    refreshTokenIfNeeded()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err?.message }));
    return true;
  }

  // ---- URL change forwarding ---------------------------------------
  if (request.action === 'urlChanged') {
    chrome.runtime.sendMessage(request).catch(() => {});
    return false;
  }

  // ---- Job-detected forwarding (auto-detect content-script signal) -
  if (request.action === 'jobDetected') {
    chrome.runtime.sendMessage(request).catch(() => {});
    return false;
  }

  // ---- Focused-pane HTML retrieval --------------------------------
  // Asks the active tab's content script for ONLY the right-pane
  // (focused job) HTML — used by the Tailor pipelines so the AI
  // never sees the left rail / job list.
  if (request.action === 'getFocusedPaneHTML') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
        sendResponse({ html: null, originUrl: tab?.url });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'getFocusedPaneHTML' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          sendResponse({ html: null, originUrl: tab.url });
        } else {
          sendResponse({ html: response.html, originUrl: response.originUrl || tab.url });
        }
      });
    });
    return true; // async response
  }

  // ---- Page HTML retrieval -----------------------------------------
  if (request.action === 'getHTML') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];

      if (tab === undefined || tab.url === undefined || tab.url.startsWith('chrome://')) {
        sendResponse({ html: null, error: 'Cannot access this page' });
        return;
      }

      try {
        chrome.tabs.sendMessage(tab.id, { action: 'getHTML', timeout: 3000 }, (response) => {
          if (chrome.runtime.lastError || !response) {
            chrome.scripting.executeScript(
              {
                target: { tabId: tab.id },
                func: () => document.documentElement.outerHTML,
              },
              (result) => {
                if (chrome.runtime.lastError) {
                  sendResponse({ html: null, error: chrome.runtime.lastError.message });
                } else if (result && result[0]) {
                  sendResponse({ html: result[0].result, originUrl: tab.url });
                } else {
                  sendResponse({ html: null, error: 'Could not get page content' });
                }
              }
            );
          } else {
            sendResponse(response);
          }
        });
      } catch (e) {
        console.error('Error getting HTML:', e);
        sendResponse({ html: null, error: e.message });
      }
    });
    return true; // async response
  }
});
