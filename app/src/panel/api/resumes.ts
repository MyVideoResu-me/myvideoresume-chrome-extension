/** Résumés: the person's master + versions, and saving a new version. */
import { request } from "./http";
import type { ResumeContent } from "@shared/resume";

export type ResumeSummary = {
  id: string;
  title: string;
  isMaster: boolean;
  isActive: boolean;
  masterId: string;
};

type RawResume = Record<string, unknown>;
type RawGroup = { masterResume: RawResume; variations?: RawResume[] };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

function toSummary(raw: RawResume, masterId: string, isMaster: boolean): ResumeSummary {
  return {
    id: str(raw.id),
    title: str(raw.title ?? raw.name) || "Résumé",
    isMaster,
    isActive: raw.isActive === true,
    masterId,
  };
}

export async function fetchResumes(): Promise<ResumeSummary[]> {
  const groups = await request<RawGroup[]>("/api/resumes/mastergroups");
  const out: ResumeSummary[] = [];
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g?.masterResume) continue;
    const masterId = str(g.masterResume.id);
    out.push(toSummary(g.masterResume, masterId, true));
    for (const v of g.variations ?? []) out.push(toSummary(v, masterId, false));
  }
  return out;
}

/** The résumé document. The API has returned it under several keys over time. */
export async function fetchResumeContent(id: string): Promise<ResumeContent> {
  const raw = await request<RawResume>(`/api/resumes/${encodeURIComponent(id)}`);
  for (const candidate of [raw.content, raw.resumeData, raw.data]) {
    if (candidate && typeof candidate === "object") return candidate as ResumeContent;
    if (typeof candidate === "string") {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === "object") return parsed as ResumeContent;
      } catch {
        /* not JSON — try the next shape */
      }
    }
  }
  return (raw.basics ? raw : {}) as ResumeContent;
}

export function setActiveResume(id: string): Promise<void> {
  return request(`/api/resumes/${encodeURIComponent(id)}/setactive`, { method: "POST" });
}

/** Save `content` as a new version under `masterId`; the master is untouched. */
export function saveVersion(
  masterId: string,
  input: { content: ResumeContent; title: string; description?: string },
): Promise<{ resumeId: string; title: string; masterId: string }> {
  return request(`/api/resume-versions/${encodeURIComponent(masterId)}/versions`, {
    method: "POST",
    body: input,
  });
}

export function uploadResumeFile(file: File): Promise<RawResume> {
  const form = new FormData();
  form.append("file", file);
  return request<RawResume>("/api/resumes/createfromfile", { method: "POST", form });
}
