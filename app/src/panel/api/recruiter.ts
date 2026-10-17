/** Recruiter: capture a candidate from a profile page and log touches. */
import { request } from "./http";

export type ExtractedProfile = {
  name: string;
  title: string;
  company: string;
  location: string;
  summary: string;
  skills: string[];
  experience: Array<Record<string, unknown>>;
  education: Array<Record<string, unknown>>;
  email: string | null;
};

export type CapturedCandidate = {
  profile: ExtractedProfile;
  talentPoolId: string | null;
  /** The email on the talent-pool row — the only address consent may go to. */
  poolEmail?: string | null;
  duplicate: boolean;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** `force` skips the server's same-page dedup, so a fresh talent-pool row is made. */
export async function extractProfile(html: string, sourceUrl: string, force = false): Promise<CapturedCandidate> {
  const raw = await request<Record<string, unknown>>("/api/recruiter/extract-profile", {
    method: "POST",
    body: { html, sourceUrl, ...(force ? { force: true } : {}) },
  });
  const p = (raw.profile ?? {}) as Record<string, unknown>;
  const contact = (p.contactInfo ?? {}) as Record<string, unknown>;
  const pool = raw.talentPoolCandidate as { id?: string; candidateEmail?: string | null } | null | undefined;
  return {
    profile: {
      name: str(p.name),
      title: str(p.title),
      company: str(p.company),
      location: str(p.location),
      summary: str(p.summary),
      skills: list<string>(p.skills).filter((s) => typeof s === "string"),
      experience: list(p.experience),
      education: list(p.education),
      email: str(contact.email) || null,
    },
    talentPoolId: pool?.id ?? null,
    poolEmail: str(pool?.candidateEmail) || null,
    duplicate: raw.duplicate === true,
  };
}

export function logInteraction(input: {
  talentPoolId: string;
  type: "sourcing" | "email" | "linkedin" | "note";
  subject: string;
  notes?: string;
  followUpDate?: string;
}): Promise<unknown> {
  return request("/api/recruiter/interactions", {
    method: "POST",
    body: {
      talentPoolId: input.talentPoolId,
      interactionType: input.type,
      subject: input.subject,
      notes: input.notes ?? "",
      interactionDate: new Date().toISOString(),
      requiresFollowUp: !!input.followUpDate,
      ...(input.followUpDate ? { followUpDate: input.followUpDate } : {}),
    },
  });
}

/** Find a work email (1 enrichment credit). Null when none was found. */
export async function enrichEmail(name: string, company: string): Promise<string | null> {
  const out = await request<{ email?: string | null; enriched?: boolean }>("/api/advertising/enrichment/enrich", {
    method: "POST",
    body: { name, company },
  });
  return out.enriched && out.email ? out.email : null;
}

/** A talent-pool candidate as a list shows them. */
export type PoolCandidate = {
  id: string;
  name: string;
  title: string;
  company: string;
  email: string | null;
  status: string;
  addedAt: string | null;
};

const POOL_FIELDS = "id,candidateName,candidateTitle,currentTitle,currentCompany,candidateEmail,status,createdAt";

/** The recruiter's talent pool, newest first. */
export async function fetchTalentPool(): Promise<PoolCandidate[]> {
  const raw = await request<Array<Record<string, unknown>>>("/api/recruiter/talent-pool", { query: { fields: POOL_FIELDS } });
  return (Array.isArray(raw) ? raw : [])
    .map((c) => ({
      id: str(c.id),
      name: str(c.candidateName),
      title: str(c.currentTitle) || str(c.candidateTitle),
      company: str(c.currentCompany),
      email: str(c.candidateEmail) || null,
      status: str(c.status),
      addedAt: str(c.createdAt) || null,
    }))
    .filter((c) => c.id);
}
