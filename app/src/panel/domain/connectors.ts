/**
 * Which Vendor Sync connector reads the profile on this page. The API's
 * connector list carries each vendor's edit-profile URL; a page belongs to a
 * connector when it's on the same site (or a known alias of it).
 */
import type { VendorConnector } from "../api/profile-import";

/** Sites a vendor also lives on (Wellfound was AngelList). */
const SITE_ALIASES: Readonly<Record<string, string>> = { "angel.co": "wellfound.com" };

function siteOf(url: string): string | null {
  try {
    const parts = new URL(url).hostname.toLowerCase().split(".").filter(Boolean);
    if (parts.length < 2) return null;
    const site = parts.slice(-2).join(".");
    return SITE_ALIASES[site] ?? site;
  } catch {
    return null;
  }
}

export function connectorForUrl(url: string, connectors: readonly VendorConnector[]): VendorConnector | null {
  const site = siteOf(url);
  if (!site) return null;
  return (
    connectors.find(
      (c) => c.supportsExtensionExtract && (siteOf(c.editProfileUrl) === site || site.split(".")[0] === c.id),
    ) ?? null
  );
}
