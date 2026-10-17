/**
 * job-url-match — is this page the same job as a tracked one? (imported
 * by the unified app panel).
 *
 * Uses the platform's own URL normalizer (canonical LinkedIn / Indeed job
 * URLs, tracking params dropped), so a page matches exactly the sourceUrl
 * the API stored for it.
 */
import { normalizeJobUrl } from "../../hired.video/shared/scraping/urls.js";

export function normalizeJobUrlForMatch(raw: string | null | undefined): string {
  return (normalizeJobUrl(raw) ?? "").replace(/\/+$/, "");
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
