/**
 * job-url-match — is this page the same job as a tracked one? (imported
 * by the unified app panel).
 *
 * LinkedIn's many URL shapes go through the platform's canonicalizer;
 * everything else drops the hash, tracking params and trailing slashes.
 */
import { canonicalizeJobUrl } from "../../hired.video/shared/scraping/urls.js";

const TRACKING_PARAMS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref", "fbclid", "gclid", "trk"];

export function normalizeJobUrlForMatch(raw: string | null | undefined): string {
  if (!raw) return "";
  const canonical = canonicalizeJobUrl(raw);
  try {
    const u = new URL(canonical);
    u.hash = "";
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    return u.toString().replace(/\/+$/, "");
  } catch {
    return canonical.replace(/\/+$/, "").split("#")[0];
  }
}

/** The tracked job whose listing (preferred) or apply URL is `url`. */
export function matchTrackedJob<J extends { sourceUrl?: string; applyUrl?: string }>(
  jobs: readonly J[],
  url: string,
): { job: J; matchedBy: "sourceUrl" | "applyUrl" } | null {
  const norm = normalizeJobUrlForMatch(url);
  if (!norm) return null;
  const bySource = jobs.find((j) => normalizeJobUrlForMatch(j.sourceUrl) === norm);
  if (bySource) return { job: bySource, matchedBy: "sourceUrl" };
  const byApply = jobs.find((j) => {
    const apply = normalizeJobUrlForMatch(j.applyUrl);
    return !!apply && apply !== normalizeJobUrlForMatch(j.sourceUrl) && apply === norm;
  });
  return byApply ? { job: byApply, matchedBy: "applyUrl" } : null;
}
