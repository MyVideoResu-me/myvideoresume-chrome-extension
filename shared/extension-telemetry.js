/**
 * extension-telemetry.js — Session batcher + selector-replay storage.
 *
 * Two unrelated concerns bundled in one file because both live entirely
 * in the side panel and both need access to chrome.storage.local and
 * `apiBase`:
 *
 *   1. Session telemetry  — buffers events client-side, flushes to
 *      `/api/extension/sessions` on a timer, on visibilitychange, on
 *      page hide, or when the buffer hits a 25-event threshold. Anonymous
 *      sessions are supported — the server's optionalAuthMiddleware
 *      attaches the user when a JWT is present.
 *
 *   2. Per-host learned selectors — written by the picker, replayed on
 *      future visits to the same host before falling back to auto-detect.
 *      Keyed by hostname; one entry per host stores the most-recently
 *      confirmed field map (title/company/location/description/applyUrl).
 *
 * Exposes a single `window.HiredVideoTelemetry` namespace so the
 * existing sidepanel.js (classic script tag) can read it without ESM.
 */

(function () {
  if (typeof window.HiredVideoTelemetry !== "undefined") return;

  // ── Session identity ────────────────────────────────────────────────────
  // Single session per side-panel lifetime. New sidepanel open = new id.

  function uuid() {
    if (crypto?.randomUUID) return crypto.randomUUID();
    // RFC4122 v4 polyfill
    return ("xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx").replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  const SESSION_ID = uuid();
  const EXTENSION =
    chrome?.runtime?.getManifest()?.name?.toLowerCase().includes("recruiter")
      ? "recruiter"
      : "jobseeker";
  const VERSION = chrome?.runtime?.getManifest()?.version || "0.0.0";

  // ── Outbound batcher ────────────────────────────────────────────────────

  const buffer = [];
  let flushTimer = null;
  const FLUSH_INTERVAL_MS = 15_000;
  const FLUSH_THRESHOLD = 25;
  let consecutiveFailures = 0;
  // After this many consecutive failures, drop events on the floor instead
  // of growing the buffer forever (e.g. user is offline + extension stays
  // open for hours). Re-attempts continue but on a slower cadence.
  const FAILURE_DROP_THRESHOLD = 5;

  function endpoint() {
    // `apiBase` is a global set by constants.js → updateConfiguration().
    if (typeof apiBase !== "string") return null;
    return apiBase + "/api/extension/sessions";
  }

  function authHeader() {
    // Best-effort — sidepanel.js stores the JWT in localStorage under
    // jwtTokenKey. We don't await chrome.storage because we want telemetry
    // to be synchronous-ish on unload.
    try {
      const token = localStorage.getItem("jwtToken");
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  async function flush(useBeacon = false) {
    if (!buffer.length) return;
    const url = endpoint();
    if (!url) return;
    const events = buffer.splice(0, buffer.length);
    const payload = {
      sessionId: SESSION_ID,
      extension: EXTENSION,
      version: VERSION,
      events,
    };
    const body = JSON.stringify(payload);
    if (useBeacon && navigator.sendBeacon) {
      // sendBeacon doesn't carry headers — server's optionalAuth tolerates
      // missing auth; we still attribute the user via later batches.
      try {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        consecutiveFailures = 0;
        return;
      } catch {
        // fall through to fetch
      }
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeader() },
        body,
        keepalive: true,
      });
      if (!res.ok) throw new Error(`telemetry post ${res.status}`);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      // Re-queue at the FRONT so order is preserved when we eventually
      // recover — unless we're past the drop threshold.
      if (consecutiveFailures <= FAILURE_DROP_THRESHOLD) {
        buffer.unshift(...events);
      }
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_INTERVAL_MS);
  }

  function record(kind, attrs = {}) {
    if (!kind) return;
    const ev = {
      kind,
      ts: new Date().toISOString(),
      url: attrs.url,
      host: attrs.host,
      payload: attrs.payload,
    };
    buffer.push(ev);
    if (buffer.length >= FLUSH_THRESHOLD) {
      flush();
    } else {
      scheduleFlush();
    }
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
  window.addEventListener("pagehide", () => flush(true));
  window.addEventListener("beforeunload", () => flush(true));

  // ── Per-host learned selectors ──────────────────────────────────────────
  //
  // Schema (chrome.storage.local key `hv:learnedSelectors`):
  //   { [host: string]: {
  //       updatedAt: ISOString,
  //       fields: { [fieldKey]: { selector, value } }
  //   } }

  const STORAGE_KEY = "hv:learnedSelectors";

  async function getLearned(host) {
    if (!host) return null;
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (data) => {
          const all = (data && data[STORAGE_KEY]) || {};
          resolve(all[host] || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  async function saveLearned(host, fields) {
    if (!host || !fields) return;
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (data) => {
          const all = (data && data[STORAGE_KEY]) || {};
          all[host] = { updatedAt: new Date().toISOString(), fields };
          chrome.storage.local.set({ [STORAGE_KEY]: all }, () => resolve());
        });
      } catch {
        resolve();
      }
    });
  }

  async function clearLearned(host) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (data) => {
          const all = (data && data[STORAGE_KEY]) || {};
          delete all[host];
          chrome.storage.local.set({ [STORAGE_KEY]: all }, () => resolve());
        });
      } catch {
        resolve();
      }
    });
  }

  window.HiredVideoTelemetry = {
    sessionId: SESSION_ID,
    record,
    flush,
    getLearned,
    saveLearned,
    clearLearned,
  };
})();
