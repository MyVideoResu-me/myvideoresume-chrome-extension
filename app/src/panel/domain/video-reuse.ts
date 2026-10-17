/**
 * Stable parts of a video flow's `reuseKey` (useVideoProject): the same
 * target must give the same key across visits, and two targets must never
 * share one. Pure.
 */

/**
 * A page's identity without its noise: origin + path, no query / hash /
 * trailing slash, so `?s=20` or a tracking param doesn't fork a new project.
 * A LinkedIn profile collapses to `/in/<slug>` (its overlay and sub-pages are
 * the same person). Empty for an unparseable URL.
 */
export function pageKey(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, "");
    const profile = /^\/in\/([^/]+)/.exec(path);
    if (profile && /(^|\.)linkedin\.com$/.test(u.hostname)) path = `/in/${profile[1].toLowerCase()}`;
    return `${u.hostname.toLowerCase()}${path}`;
  } catch {
    return "";
  }
}

/** A short, stable fingerprint of a text (whitespace/case-insensitive; FNV-1a). */
export function textKey(text: string): string {
  const norm = text.replace(/\s+/g, " ").trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
