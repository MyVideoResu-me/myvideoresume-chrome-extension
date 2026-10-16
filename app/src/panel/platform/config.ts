/**
 * API + web base URLs. The single source of truth is shared/constants.js
 * (also used by login.html and the legacy builds); the panel HTML loads it
 * before this bundle, so we read its globals rather than redeclare them.
 */

declare const apiBase: string;
declare const webBase: string;
declare function updateConfiguration(): void;

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  updateConfiguration();
  configured = true;
}

export function apiUrl(path: string): string {
  ensureConfigured();
  return apiBase + path;
}

export function webUrl(path: string): string {
  ensureConfigured();
  return webBase + path;
}
