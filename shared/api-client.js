/**
 * hired.video Chrome Extension - API client (plain-JS runtimes)
 *
 * The ONE place the classic-script contexts (service worker, login page,
 * legacy recruiter side panel, session telemetry) build an api.hired.video
 * request: it resolves the API base URL once, reads the JWT from
 * chrome.storage.local, sets `Authorization`, JSON-encodes bodies and
 * unwraps the `{ success, data, error }` envelope.
 *
 * Loading: a classic script with no dependencies. Pages load it BEFORE
 * constants.js (which reads `isDevelopment` + `HIRED_API_BASE` from here);
 * the build concatenates it FIRST into every service-worker.js. The bundled
 * app panel has its own single port (app/src/panel/api/http.ts) and reads
 * HIRED_API_BASE from here (app/src/panel/platform/config.ts).
 *
 * Exposed globals:
 *   isDevelopment                 — dev/prod switch (also drives webBase)
 *   HIRED_API_BASE                — resolved API origin
 *   JWT_STORAGE_KEY               — chrome.storage.local key of the JWT
 *   hvApiUrl(pathOrUrl)           — '/api/…' → absolute URL (absolute passes through)
 *   hvGetToken()                  — Promise<string|null>
 *   hvApiFetch(pathOrUrl, opts)   — Promise<Response>
 *   hvUnwrapEnvelope(json)        — `json.data` when enveloped, else json
 */

const isDevelopment = false;

// Dev: `npm run dev` in hired.video/api (Node server on :5000).
// Prod: Cloudflare Worker at api.hired.video.
const HIRED_API_BASE = isDevelopment ? 'http://localhost:5000' : 'https://api.hired.video';

const JWT_STORAGE_KEY = 'jwtToken';

function hvApiUrl(pathOrUrl) {
  return /^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : HIRED_API_BASE + pathOrUrl;
}

function hvGetToken() {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(JWT_STORAGE_KEY, (data) => resolve((data && data[JWT_STORAGE_KEY]) || null));
    } catch {
      resolve(null);
    }
  });
}

function hvIsRawBody(body) {
  return (
    typeof body === 'string' ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams)
  );
}

/**
 * Send a request to api.hired.video.
 *
 * @param {string} pathOrUrl  '/api/…' path (preferred) or an absolute URL
 * @param {object} [opts]
 * @param {string} [opts.method]     default POST when a body is given, else GET
 * @param {*}      [opts.body]       object → JSON; string → sent as JSON text;
 *                                   FormData / Blob / URLSearchParams → as-is
 * @param {object} [opts.headers]    extra headers (override the defaults)
 * @param {'required'|'optional'|'none'} [opts.auth]  default 'required':
 *                                   throws 'Not authenticated' without a JWT;
 *                                   'optional' sends anonymously; 'none' never
 *                                   attaches one
 * @param {string} [opts.token]      a JWT the caller already holds
 * @param {boolean} [opts.keepalive]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Response>}
 */
async function hvApiFetch(pathOrUrl, opts = {}) {
  const auth = opts.auth || 'required';
  const headers = {};

  if (auth !== 'none') {
    const token = opts.token || (await hvGetToken());
    if (token) headers.Authorization = `Bearer ${token}`;
    else if (auth === 'required') throw new Error('Not authenticated');
  }

  let body;
  if (opts.body !== undefined && opts.body !== null) {
    if (hvIsRawBody(opts.body)) {
      body = opts.body;
      if (typeof body === 'string') headers['Content-Type'] = 'application/json';
    } else {
      body = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
  }

  return fetch(hvApiUrl(pathOrUrl), {
    method: opts.method || (body !== undefined ? 'POST' : 'GET'),
    headers: { ...headers, ...(opts.headers || {}) },
    body,
    keepalive: opts.keepalive,
    signal: opts.signal,
  });
}

/** `{ success, data }` → data; legacy un-enveloped bodies pass through. */
function hvUnwrapEnvelope(json) {
  if (json && typeof json === 'object' && 'data' in json && json.data !== undefined && json.data !== null) {
    return json.data;
  }
  return json;
}
