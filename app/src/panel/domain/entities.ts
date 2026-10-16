/**
 * What the page gives you — the "page" half of every pair. Detected by
 * the content scripts (jobs: content-script-jobs, profiles:
 * content-script-profiles, posts: content-script-posts).
 */

export type DetectedJob = {
  kind: "job";
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  applyUrl: string;
};

export type DetectedProfile = {
  kind: "profile";
  name: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
};

export type DetectedPost = {
  kind: "post";
  author: string;
  text: string;
  sourceUrl: string;
  platform: string;
};

export type PageEntity = DetectedJob | DetectedProfile | DetectedPost;
export type EntityKind = PageEntity["kind"];
/** "none" = nothing detected on this page. */
export type PageKind = EntityKind | "none";

type Raw = Record<string, unknown> | null | undefined;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function toDetectedJob(raw: Raw): DetectedJob | null {
  if (!raw || !str(raw.title)) return null;
  return {
    kind: "job",
    title: str(raw.title),
    company: str(raw.company),
    location: str(raw.location),
    sourceUrl: str(raw.sourceUrl),
    applyUrl: str(raw.applyUrl) || str(raw.sourceUrl),
  };
}

export function toDetectedProfile(raw: Raw): DetectedProfile | null {
  if (!raw || !str(raw.name)) return null;
  return {
    kind: "profile",
    name: str(raw.name),
    title: str(raw.title),
    company: str(raw.company),
    location: str(raw.location),
    sourceUrl: str(raw.sourceUrl),
  };
}

export function toDetectedPost(raw: Raw): DetectedPost | null {
  if (!raw || !str(raw.text)) return null;
  return {
    kind: "post",
    author: str(raw.author),
    text: str(raw.text).slice(0, 4000),
    sourceUrl: str(raw.sourceUrl),
    platform: str(raw.platform),
  };
}

/** Never treat our own site as a job/profile/post page. */
const OWN_HOSTS = new Set(["hired.video", "www.hired.video", "localhost", "127.0.0.1"]);

export function isOwnSite(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return OWN_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function entityTitle(entity: PageEntity): string {
  switch (entity.kind) {
    case "job":
      return entity.title;
    case "profile":
      return entity.name;
    case "post":
      return entity.author || entity.text.slice(0, 60);
  }
}
