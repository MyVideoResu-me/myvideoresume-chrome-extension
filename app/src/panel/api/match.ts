/** Match: fit score, tailoring preview, cover letter. */
import { request } from "./http";
import type { ResumeContent } from "@shared/resume";
import type { JobGap, TailorChange } from "@shared/resume-tailor";
import type { CoverLetter, CoverLetterTone } from "@shared/cover-letter";

export type JobRef = { jobId: string } | { jobHtml: string };

/**
 * `matchedSkills` / `missingSkills`: the job's required skills the résumé
 * shows / doesn't show (always in the analyze response, possibly empty;
 * both empty → the fit card shows only the score).
 */
export type FitResult = { score: number; summary: string; matchedSkills: string[]; missingSkills: string[] };

const skillList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && s.trim() !== "") : [];

export async function analyzeFit(job: JobRef, resumeId: string): Promise<FitResult> {
  const raw = await request<{
    score?: number;
    summaryRecommendations?: string;
    matchedSkills?: unknown;
    missingSkills?: unknown;
  }>("/api/match/analyze", {
    method: "POST",
    body: { ...job, resumeId },
  });
  return {
    score: Math.round(Number(raw.score ?? 0)),
    summary: typeof raw.summaryRecommendations === "string" ? raw.summaryRecommendations : "",
    matchedSkills: skillList(raw.matchedSkills),
    missingSkills: skillList(raw.missingSkills),
  };
}

export type TailorPreview = {
  oldScore: number;
  newScore: number;
  tailoredResume: ResumeContent;
  changes: TailorChange[];
  gaps: JobGap[];
  variationTitle: string;
  /** The job's keywords the tailored résumé shows. */
  matchedKeywords?: string[];
};

/** Tailor without saving — the person reviews the changes first. */
export function previewTailor(job: JobRef, resumeId: string): Promise<TailorPreview> {
  return request<TailorPreview>("/api/match/tailor", {
    method: "POST",
    body: { ...job, resumeId, preview: true },
  });
}

/** Tailor content that is not saved anywhere (a candidate's résumé). */
export function previewTailorContent(job: JobRef, resumeContent: ResumeContent): Promise<TailorPreview> {
  return request<TailorPreview>("/api/match/tailor", {
    method: "POST",
    body: { ...job, resumeContent, preview: true },
  });
}

export async function writeCoverLetter(job: JobRef, resumeContent: ResumeContent): Promise<CoverLetter> {
  const out = await request<{ letter: CoverLetter }>("/api/match/cover-letter", {
    method: "POST",
    body: { ...job, resumeContent },
  });
  return out.letter;
}

export async function retoneCoverLetter(letter: CoverLetter, tone: CoverLetterTone): Promise<CoverLetter> {
  const out = await request<{ letter: CoverLetter }>("/api/match/cover-letter/tone", {
    method: "POST",
    body: { letter, tone },
  });
  return out.letter;
}
