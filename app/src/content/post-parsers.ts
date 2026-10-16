/**
 * Reading one post from its permalink page. Pure DOM — unit-testable.
 * A site is DATA: where its post pages live and which elements hold the
 * author and the text. Selectors drift; when they miss, the panel's
 * "Use my selection" fallback still works.
 */

export type PostPayload = { author: string; text: string; sourceUrl: string; platform: string };

type PostSite = {
  platform: string;
  hosts: readonly string[];
  /** Only a page that IS one post — never a feed. */
  pathPattern: RegExp;
  container: string;
  author: readonly string[];
  text: readonly string[];
};

export const POST_SITES: readonly PostSite[] = [
  {
    platform: "linkedin",
    hosts: ["linkedin.com"],
    pathPattern: /^\/(posts\/|feed\/update\/)/,
    container: ".feed-shared-update-v2, [data-urn*='activity']",
    author: [".update-components-actor__title span[aria-hidden='true']", ".update-components-actor__name", ".feed-shared-actor__name"],
    text: [".update-components-text", ".feed-shared-inline-show-more-text", ".feed-shared-text"],
  },
  {
    platform: "x",
    hosts: ["x.com", "twitter.com"],
    pathPattern: /^\/[^/]+\/status\/\d+/,
    container: "article[data-testid='tweet']",
    author: ["[data-testid='User-Name']"],
    text: ["[data-testid='tweetText']"],
  },
];

const MAX_TEXT = 4000;

function firstText(root: ParentNode, selectors: readonly string[]): string {
  for (const sel of selectors) {
    const el = root.querySelector(sel);
    const text = (el?.textContent ?? "").replace(/\s+\n/g, "\n").trim();
    if (text) return text;
  }
  return "";
}

function siteFor(host: string): PostSite | null {
  const h = host.toLowerCase();
  return POST_SITES.find((s) => s.hosts.some((d) => h === d || h.endsWith(`.${d}`))) ?? null;
}

export function readPost(doc: Document, location: Pick<Location, "hostname" | "pathname" | "href">): PostPayload | null {
  const site = siteFor(location.hostname);
  if (!site || !site.pathPattern.test(location.pathname)) return null;
  const container = doc.querySelector(site.container);
  if (!container) return null;
  const text = firstText(container, site.text);
  if (!text) return null;
  // X renders "Name\n@handle" — keep the display name.
  const author = firstText(container, site.author).split("\n")[0].trim();
  return { author, text: text.slice(0, MAX_TEXT), sourceUrl: location.href, platform: site.platform };
}
