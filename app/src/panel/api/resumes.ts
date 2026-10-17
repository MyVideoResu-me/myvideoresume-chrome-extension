/** Résumés: the person's master + versions, and saving a new version. */
import { request, requestRaw } from "./http";
import type { DownloadFormat } from "../../shared/settings";
import type { ResumeContent } from "@shared/resume";
import { readCoverLetter } from "@shared/cover-letter";

export type ResumeSummary = {
  id: string;
  title: string;
  isMaster: boolean;
  isActive: boolean;
  masterId: string;
  /** ISO timestamp of the last edit, when the API sends one. */
  updatedAt: string | null;
  /** The cover letter saved with this (tailored) version, if any. */
  letter: { jobTitle: string; organization: string } | null;
};

/** Every résumé, plus the documents the list arrived with (cache them). */
export type ResumeLibrary = { list: ResumeSummary[]; documents: ReadonlyArray<[string, ResumeContent]> };

type RawResume = Record<string, unknown>;
type RawGroup = { masterResume: RawResume; variations?: RawResume[] };

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** The résumé document in a row. The API has returned it under several keys over time. */
function documentOf(raw: RawResume): ResumeContent | null {
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
  return raw.basics ? (raw as ResumeContent) : null;
}

/** Which job a version's saved cover letter is for (null: no letter). */
export function letterRef(doc: ResumeContent | null): ResumeSummary["letter"] {
  const letter = readCoverLetter(doc);
  return letter ? { jobTitle: letter.jobTitle, organization: letter.organization } : null;
}

function toSummary(raw: RawResume, masterId: string, isMaster: boolean, doc: ResumeContent | null): ResumeSummary {
  return {
    id: str(raw.id),
    title: str(raw.title ?? raw.name) || "Résumé",
    isMaster,
    isActive: raw.isActive === true,
    masterId,
    updatedAt: str(raw.updatedAt ?? raw.updated_at) || null,
    letter: isMaster ? null : letterRef(doc),
  };
}

export async function fetchResumes(): Promise<ResumeLibrary> {
  const groups = await request<RawGroup[]>("/api/resumes/mastergroups");
  const list: ResumeSummary[] = [];
  const documents: Array<[string, ResumeContent]> = [];
  const add = (raw: RawResume, masterId: string, isMaster: boolean) => {
    const doc = documentOf(raw);
    const summary = toSummary(raw, masterId, isMaster, doc);
    list.push(summary);
    if (doc && summary.id) documents.push([summary.id, doc]);
  };
  for (const g of Array.isArray(groups) ? groups : []) {
    if (!g?.masterResume) continue;
    const masterId = str(g.masterResume.id);
    add(g.masterResume, masterId, true);
    for (const v of g.variations ?? []) add(v, masterId, false);
  }
  return { list, documents };
}

export async function fetchResumeContent(id: string): Promise<ResumeContent> {
  const raw = await request<RawResume>(`/api/resumes/${encodeURIComponent(id)}`);
  return documentOf(raw) ?? ({} as ResumeContent);
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

/**
 * Replace a résumé's document (PUT /api/resumes/:id). Callers pass a
 * VERSION's id — the panel never writes the master this way.
 */
export function updateResumeContent(id: string, content: ResumeContent): Promise<unknown> {
  return request(`/api/resumes/${encodeURIComponent(id)}`, { method: "PUT", body: { content } });
}

export function uploadResumeFile(file: File): Promise<RawResume> {
  const form = new FormData();
  form.append("file", file);
  return request<RawResume>("/api/resumes/createfromfile", { method: "POST", form });
}

export type ResumeExport = { kind: "url"; url: string } | { kind: "file"; blob: Blob; filename: string };

/** The résumé as a file (PDF/Word/Markdown/text). The API answers with the bytes or a signed URL. */
export async function exportResume(id: string, format: DownloadFormat, fallbackName: string): Promise<ResumeExport> {
  const res = await requestRaw(`/api/resumes/${encodeURIComponent(id)}/export`, { query: { format } });
  if ((res.headers.get("content-type") ?? "").includes("application/json")) {
    const json = (await res.json()) as { data?: { exportUrl?: string }; exportUrl?: string };
    const url = json.data?.exportUrl ?? json.exportUrl;
    if (!url) throw new Error("no export url");
    return { kind: "url", url };
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="?([^";\n]+)"?/);
  return { kind: "file", blob: await res.blob(), filename: match?.[1] ?? `${fallbackName}.${format}` };
}
