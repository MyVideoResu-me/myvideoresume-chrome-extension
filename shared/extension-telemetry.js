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

  // ── Opt-out — the single source of truth, consulted at every record() ──
  //
  // Both extensions persist the toggle inside their own settings object
  // under chrome.storage.local: jobseeker uses `settings.telemetryOptOut`,
  // recruiter uses `recruiterSettings.telemetryOptOut`. We mirror both
  // containers so this file is the only place that has to know how to
  // resolve the flag. Without this gate the Settings toggle was cosmetic
  // — `record()` posted regardless. (Fixes gap #1450.)
  //
  // We snapshot synchronously-ish on init and update via `onChanged` so a
  // user who flips the toggle mid-session stops sending immediately.

  const OPT_OUT_STORAGE_KEYS = ["settings", "recruiterSettings"];
  let optedOut = false;

  function deriveOptOut(stores) {
    for (const key of OPT_OUT_STORAGE_KEYS) {
      const v = stores?.[key]?.telemetryOptOut;
      if (v === true) return true;
    }
    return false;
  }

  try {
    chrome.storage.local.get(OPT_OUT_STORAGE_KEYS, (data) => {
      optedOut = deriveOptOut(data);
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      const touched = OPT_OUT_STORAGE_KEYS.some((k) => k in changes);
      if (!touched) return;
      chrome.storage.local.get(OPT_OUT_STORAGE_KEYS, (data) => {
        optedOut = deriveOptOut(data);
      });
    });
  } catch {
    // Pre-MV3 / sandboxed context — leave optedOut at its default (false).
  }

  // ── Payload scrubbers — narrow what reaches the telemetry channel ─────
  //
  // Some event kinds carry the literal scraped DOM (selectors + values)
  // because the same `record()` site forwards captures to the LLM
  // extractor. The LLM extractor receives that payload via a separate
  // /api/recruiter/extract-* POST; the *analytics-telemetry* channel
  // should not also store the content. We keep the SIGNAL (a capture
  // happened, on this host, with N field keys) and drop the CONTENT
  // (selector strings + value strings). Fixes gap #1452.

  function scrubPayload(kind, payload) {
    if (!payload || typeof payload !== "object") return payload;
    if (kind !== "picker_capture") return payload;
    const out = { ...payload };
    if (out.fields && typeof out.fields === "object") {
      const keys = Object.keys(out.fields);
      out.fieldCount = keys.length;
      out.fieldKeys = keys;
      delete out.fields;
    }
    // Page-context probes are coarse signal too (UA / title) but the
    // title can carry candidate names on profile captures — strip it.
    if (out.page && typeof out.page === "object") {
      out.page = { ua: out.page.ua };
    }
    return out;
  }

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
    if (optedOut) return;
    const ev = {
      kind,
      ts: new Date().toISOString(),
      url: attrs.url,
      host: attrs.host,
      payload: scrubPayload(kind, attrs.payload),
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
  //   { [`${host}|${mode}`]: {
  //       updatedAt: ISOString,
  //       fields: { [fieldKey]: { selector, value } }
  //   } }
  //
  // The `${host}|${mode}` composite key separates job / profile / company
  // captures from the same host so they don't clobber each other (gap
  // #1395). Mode is also read by `content-script-picker.ts` to replay
  // saved selectors as the first auto-suggest on subsequent visits
  // (gap #1396) — the picker uses the same key shape directly against
  // chrome.storage.local because it runs in the page context and can't
  // see this side-panel-scoped `window.HiredVideoTelemetry`.

  const STORAGE_KEY = "hv:learnedSelectors";

  // Single source of truth for the composite key. Mirrored in
  // shared/content-script-picker.ts — change both together.
  function makeStorageKey(host, mode) {
    return `${host}|${mode || "job"}`;
  }

  async function saveLearned(host, mode, fields) {
    if (!host || !fields) return;
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([STORAGE_KEY], (data) => {
          const all = (data && data[STORAGE_KEY]) || {};
          all[makeStorageKey(host, mode)] = {
            updatedAt: new Date().toISOString(),
            fields,
          };
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
    saveLearned,
  };
})();
