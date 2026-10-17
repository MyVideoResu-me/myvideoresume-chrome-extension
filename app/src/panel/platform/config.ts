/**
 * API + web base URLs. The panel HTML loads shared/api-client.js (API base,
 * resolved once as `HIRED_API_BASE`) and shared/constants.js (web base)
 * before this bundle — the same sources login.html and the service worker
 * use — so we read their globals rather than redeclare them.
 */

declare const HIRED_API_BASE: string;
declare const webBase: string;
declare function updateConfiguration(): void;

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  updateConfiguration();
  configured = true;
}

export function apiUrl(path: string): string {
  return HIRED_API_BASE + path;
}

export function webUrl(path: string): string {
  ensureConfigured();
  return webBase + path;
}
