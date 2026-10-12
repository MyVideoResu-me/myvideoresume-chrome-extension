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

// Hosts the seeker Vendor Sync flow can pull profile HTML from. Mirrors
// `PROFILE_SITE_PARSERS.*.hostPatterns` in shared/profile-parsers.js —
// kept as plain strings here because the service worker can't import
// the parsers module. Add to BOTH places when adding a vendor with
// `supportsExtensionExtract: true`.
// Single source of truth for which vendors are extension-supported. The
// ids match backend connector ids; labels are reused by the jobseeker
// side panel's "Sync this profile" banner so the host → label mapping
// doesn't drift between worker + UI. Add a new vendor here AND in
// profile-parsers.js → flip the backend connector's
// supportsExtensionExtract to true → done. DRY rule.
const VENDOR_SYNC_REGISTRY = [
  { id: 'linkedin', label: 'LinkedIn', host: 'linkedin.com' },
  { id: 'indeed', label: 'Indeed', host: 'indeed.com' },
  { id: 'indeed', label: 'Indeed', host: 'profile.indeed.com' },
  { id: 'glassdoor', label: 'Glassdoor', host: 'glassdoor.com' },
  { id: 'ziprecruiter', label: 'ZipRecruiter', host: 'ziprecruiter.com' },
  { id: 'monster', label: 'Monster', host: 'monster.com' },
  { id: 'wellfound', label: 'Wellfound', host: 'wellfound.com' },
  { id: 'wellfound', label: 'Wellfound', host: 'angel.co' },
  { id: 'dice', label: 'Dice', host: 'dice.com' },
  { id: 'github', label: 'GitHub', host: 'github.com' },
];

function matchVendorForUrl(url) {
  if (!url) return null;
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  for (const v of VENDOR_SYNC_REGISTRY) {
    if (host === v.host || host.endsWith('.' + v.host)) return v;
  }
  return null;
}

/**
 * Best-effort selector-drift telemetry from the service worker. Fires a
 * single-event batch directly to /api/extension/sessions when an autofill
 * attempt skips because the target field wasn't found — that's the signal
 * the vendor renamed an ARIA label and our selector needs maintenance.
 *
 * Reads `telemetryOptOut` from chrome.storage.local — the same flag the
 * side-panel telemetry module consults (#1450 SSoT). Anonymous if no JWT,
 * authed if one is present. Closes gap #1453.
 */
function reportSelectorMiss({ vendorId, selector, blockSection, errCode, host }) {
  chrome.storage.local.get(['settings', 'recruiterSettings', 'jwtToken'], async (data) => {
    const optedOut = !!(data?.settings?.telemetryOptOut || data?.recruiterSettings?.telemetryOptOut);
    if (optedOut) return;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (data.jwtToken) headers.Authorization = `Bearer ${data.jwtToken}`;
      await fetch(API_BASE + '/api/extension/sessions', {
        method: 'POST',
        headers,
        keepalive: true,
        body: JSON.stringify({
          sessionId: crypto.randomUUID(),
          extension: chrome.runtime.getManifest()?.name?.toLowerCase().includes('recruiter')
            ? 'recruiter' : 'jobseeker',
          version: chrome.runtime.getManifest()?.version || '0.0.0',
          events: [{
            kind: 'vendor_selector_miss',
            ts: new Date().toISOString(),
            host,
            payload: { vendorId, selector, blockSection, errCode },
          }],
        }),
      });
    } catch {
      // Telemetry is best-effort — never block the user flow.
    }
  });
}

/**
 * Vendor Sync — "user clicked Sync on /tools/vendor-sync" handler.
 *
 * Finds the most recent matching profile tab (LinkedIn, Indeed, ...),
 * asks its content script for the focused pane HTML, and broadcasts the
 * result back to every open hired.video tab via the extension→web bridge
 * as `hired.video:extension-event` with type `vendor-sync:focused-html`.
 *
 * Failure modes (no profile tab open, content script not responding,
 * cross-origin block) all emit the same event with `html: null` so the
 * web app can surface a user-facing error instead of hanging.
 */
function handleVendorSyncFocusedRequest(_payload) {
  const matchUrls = VENDOR_SYNC_REGISTRY.map((v) => `*://*.${v.host}/*`);

  function broadcast(result) {
    chrome.tabs.query(
      { url: ['https://hired.video/*', 'https://www.hired.video/*', 'http://localhost:3000/*'] },
      (webTabs) => {
        for (const t of webTabs) {
          if (!t?.id) continue;
          chrome.tabs.sendMessage(t.id, {
            action: 'hiredVideoExtensionEvent',
            type: 'vendor-sync:focused-html',
            payload: result,
          }).catch(() => {});
        }
      },
    );
  }

  chrome.tabs.query({ url: matchUrls }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      broadcast({ html: null, connectorId: null, originUrl: null, error: 'NO_PROFILE_TAB' });
      return;
    }
    // Prefer the tab the user most recently focused — chrome.tabs.query
    // has no native ordering, so fall back to lastAccessed when present.
    const sorted = tabs.slice().sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const tab = sorted[0];
    chrome.tabs.sendMessage(tab.id, { action: 'getFocusedProfileHTML' }, (response) => {
      if (chrome.runtime.lastError || !response) {
        broadcast({
          html: null,
          connectorId: null,
          originUrl: tab.url ?? null,
          error: chrome.runtime.lastError?.message ?? 'NO_RESPONSE',
        });
        return;
      }
      broadcast({
        html: response.html ?? null,
        connectorId: response.connectorId ?? null,
        originUrl: response.originUrl ?? tab.url ?? null,
        error: response.html ? null : 'NO_FOCUSED_PANE',
      });
    });
  });
}

/**
 * Vendor Sync — DOM autofill. Locate a vendor tab matching `vendorId`,
 * inject the autofill content script if needed, type `value` into the
 * element matching `selector`. Broadcasts a `vendor-sync:autofill-result`
 * event back to the web tabs so the UI can toast success/failure.
 *
 * Single-field, user-initiated — the user opens the edit modal on the
 * vendor tab first. We never auto-open modals or auto-save; the user
 * reviews and saves themselves. Matches the same "no silent automation"
 * envelope as a password manager.
 */
function handleVendorSyncAutofill(payload) {
  const { vendorId, selector, value, blockSection } = payload || {};
  const vendorHosts = VENDOR_SYNC_REGISTRY
    .filter((v) => v.id === vendorId)
    .map((v) => `*://*.${v.host}/*`);

  function broadcast(result) {
    chrome.tabs.query(
      { url: ['https://hired.video/*', 'https://www.hired.video/*', 'http://localhost:3000/*'] },
      (webTabs) => {
        for (const t of webTabs) {
          if (!t?.id) continue;
          chrome.tabs.sendMessage(t.id, {
            action: 'hiredVideoExtensionEvent',
            type: 'vendor-sync:autofill-result',
            payload: { ...result, vendorId, blockSection },
          }).catch(() => {});
        }
      },
    );
  }

  if (!vendorId || !selector || typeof value !== 'string') {
    broadcast({ status: 'error', error: 'BAD_REQUEST' });
    return;
  }
  if (vendorHosts.length === 0) {
    broadcast({ status: 'error', error: 'UNKNOWN_VENDOR' });
    return;
  }

  chrome.tabs.query({ url: vendorHosts }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      broadcast({ status: 'error', error: 'NO_VENDOR_TAB' });
      return;
    }
    const sorted = tabs.slice().sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
    const tab = sorted[0];

    function send() {
      chrome.tabs.sendMessage(
        tab.id,
        { action: 'fillFormFields', answers: { [selector]: value } },
        (response) => {
          if (chrome.runtime.lastError || !response) {
            broadcast({ status: 'error', error: 'NO_RESPONSE' });
            return;
          }
          const fillResult = response.results?.[selector];
          if (fillResult === 'filled') {
            broadcast({ status: 'filled' });
          } else {
            const errCode = fillResult === 'skipped'
              ? 'FIELD_NOT_FOUND'
              : (fillResult === 'error' ? 'FILL_FAILED' : 'UNKNOWN');
            // Selector-drift telemetry: aggregate misses so the team
            // sees when LinkedIn / Indeed / ... rename a field's
            // ARIA label. Fire-and-forget; opt-out is honoured because
            // the side panel's HiredVideoTelemetry consumes the same
            // flag via #1450's gate. Closes gap #1453.
            reportSelectorMiss({
              vendorId, selector, blockSection, errCode,
              host: tab.url ? new URL(tab.url).hostname : null,
            });
            broadcast({ status: 'skipped', error: errCode });
          }
        },
      );
    }

    // Lazy-inject the autofill content script if it's not loaded — mirrors
    // the pattern used by the form-fill flow above.
    chrome.tabs.sendMessage(tab.id, { action: 'fillFormFields', answers: {} }, (probe) => {
      if (chrome.runtime.lastError || !probe) {
        chrome.scripting.executeScript(
          { target: { tabId: tab.id }, files: ['content-script-autofill.js'] },
          () => {
            if (chrome.runtime.lastError) {
              broadcast({ status: 'error', error: 'INJECTION_FAILED' });
              return;
            }
            setTimeout(send, 300);
          },
        );
      } else {
        send();
      }
    });
  });
}

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

// ---- Tab activation — notify the side panel when the user switches tabs
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.runtime.sendMessage({ action: 'tabActivated', tabId: activeInfo.tabId }).catch(() => {});
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

  // ---- hired.video tab → extension bridge --------------------------
  // auth-bridge.js forwards web-app mutations (resume created/deleted
  // on /resumes, etc.) here. We relay to the side panel via
  // chrome.runtime.sendMessage so it can re-fetch affected lists.
  if (request.action === 'webAppEvent') {
    // Special-case: Vendor Sync wants the focused profile HTML out of
    // some OTHER tab (LinkedIn, Indeed, ...). The web app fires this
    // when the user clicks "Sync from this tab" on /tools/vendor-sync;
    // we find a matching profile tab, query its content script, and
    // broadcast the HTML back via the existing extension→web bridge.
    if (request.type === 'vendor-sync:request-focused-html') {
      handleVendorSyncFocusedRequest(request.payload ?? {});
      return false;
    }
    // Vendor Sync write-back: type a single field's value into the
    // matching vendor tab via the existing autofill content script.
    // The web app sends `{ vendorId, selector, value }`; we locate
    // the vendor tab, ensure the autofill content script is injected,
    // and forward `fillFormFields({ [selector]: value })`. Broadcasts
    // the result back as `vendor-sync:autofill-result`.
    if (request.type === 'vendor-sync:autofill-field') {
      handleVendorSyncAutofill(request.payload ?? {});
      return false;
    }
    chrome.runtime.sendMessage({
      action: 'webAppEvent',
      type: request.type,
      payload: request.payload ?? null,
    }).catch(() => {}); // side panel closed
    return false;
  }

  // ---- Extension → hired.video tab bridge --------------------------
  // Relays a custom event to any open hired.video/localhost tab so the
  // web app can react to extension-side changes (e.g. re-fetch the
  // resume list after an extension-triggered upload). auth-bridge.js,
  // which is already injected on these hosts, picks this up and turns
  // it into a window-level CustomEvent.
  if (request.action === 'broadcastToWebApp') {
    chrome.tabs.query(
      { url: ['https://hired.video/*', 'https://www.hired.video/*', 'http://localhost:3000/*'] },
      (tabs) => {
        for (const tab of tabs) {
          if (!tab?.id) continue;
          chrome.tabs.sendMessage(tab.id, {
            action: 'hiredVideoExtensionEvent',
            type: request.type,
            payload: request.payload ?? null,
          }).catch(() => {}); // tab may not have the content script ready
        }
      },
    );
    return false;
  }

  // ---- Vendor-sync host detection ---------------------------------
  // The side panel polls this on init + tab change so its "Sync this
  // profile" banner can self-gate against the active tab's host. One
  // SSoT (VENDOR_SYNC_REGISTRY) — DRY rule.
  if (request.action === 'vendor-sync:detect-active-tab') {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const url = tabs?.[0]?.url ?? null;
      const match = matchVendorForUrl(url);
      sendResponse({ vendor: match, url });
    });
    return true; // async sendResponse
  }

  // ---- On-demand job detection from the active tab -----------------
  if (request.action === 'detectJob') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
        sendResponse({ payload: null });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'detectJob' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Content script not loaded on this tab (e.g. tab predates
          // the extension install). Inject it on the fly, then retry.
          console.warn('[hired.video] detectJob: content script not responding, injecting…',
            chrome.runtime.lastError?.message);
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content-script-jobs.js'] },
            () => {
              if (chrome.runtime.lastError) {
                console.warn('[hired.video] detectJob: injection failed', chrome.runtime.lastError.message);
                sendResponse({ payload: null });
                return;
              }
              // Give the newly-injected script a moment to initialise
              // (scheduleDetect runs at 500ms). Then retry.
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, { action: 'detectJob' }, (retryResponse) => {
                  if (chrome.runtime.lastError || !retryResponse) {
                    sendResponse({ payload: null });
                  } else {
                    sendResponse({ payload: retryResponse });
                  }
                });
              }, 800);
            }
          );
        } else {
          sendResponse({ payload: response });
        }
      });
    });
    return true; // async response
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

  // ---- Autofill form extraction/fill relay -------------------------
  // Forward from sidepanel to active tab's content script, with
  // on-demand injection fallback.
  if (request.action === 'extractFormFields' || request.action === 'fillFormFields' || request.action === 'getFormHtml') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
        sendResponse({ fields: [], error: 'No active tab' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, request, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Content script not loaded — inject on demand
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content-script-autofill.js'] },
            () => {
              if (chrome.runtime.lastError) {
                sendResponse({ fields: [], error: 'Injection failed: ' + chrome.runtime.lastError.message });
                return;
              }
              setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, request, (retryResponse) => {
                  if (chrome.runtime.lastError || !retryResponse) {
                    sendResponse({ fields: [], error: 'Content script not responding' });
                  } else {
                    sendResponse(retryResponse);
                  }
                });
              }, 500);
            }
          );
        } else {
          sendResponse(response);
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
            // Fallback path: no content script — run the same cleanse
            // logic via executeScript so the service worker never sends
            // raw document.outerHTML (it's 10x larger without script/style
            // stripping and blows out our payload budget).
            chrome.scripting.executeScript(
              {
                target: { tabId: tab.id },
                func: () => {
                  const raw = document.documentElement.outerHTML;
                  let out = raw;
                  out = out.replace(
                    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
                    (m, attrs) => (/type\s*=\s*["']application\/ld\+json["']/i.test(attrs) ? m : ''),
                  );
                  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
                  out = out.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
                  out = out.replace(/<link\b[^>]*rel\s*=\s*["'](?:stylesheet|preload|prefetch|dns-prefetch|preconnect)["'][^>]*>/gi, '');
                  out = out.replace(/<!--[\s\S]*?-->/g, '');
                  out = out.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, '');
                  out = out.replace(/\s(?:on[a-z]+|data-(?:analytics|tracking|gtm|adobe)[a-z-]*)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
                  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
                  return out;
                },
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
