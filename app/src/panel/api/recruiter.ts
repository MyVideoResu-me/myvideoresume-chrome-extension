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
  duplicate: boolean;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function extractProfile(html: string, sourceUrl: string): Promise<CapturedCandidate> {
  const raw = await request<Record<string, unknown>>("/api/recruiter/extract-profile", {
    method: "POST",
    body: { html, sourceUrl },
  });
  const p = (raw.profile ?? {}) as Record<string, unknown>;
  const contact = (p.contactInfo ?? {}) as Record<string, unknown>;
  const pool = raw.talentPoolCandidate as { id?: string } | null | undefined;
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
