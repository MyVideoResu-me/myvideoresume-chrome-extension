/**
 * Fit score for two texts that aren't saved résumés of the caller — a
 * candidate's profile against one of the recruiter's jobs. /api/match/analyze
 * only scores the caller's own résumés, so this goes through /bycontent.
 */
import { request } from "./http";

const MAX_CHARS = 8000;

export async function scoreFitByContent(jobText: string, resumeText: string): Promise<number> {
  const raw = await request<{ score?: number }>("/api/match/bycontent", {
    method: "POST",
    body: { jobContent: jobText.slice(0, MAX_CHARS), resumeContent: resumeText.slice(0, MAX_CHARS) },
  });
  return Math.max(0, Math.min(100, Math.round(Number(raw.score ?? 0))));
}
