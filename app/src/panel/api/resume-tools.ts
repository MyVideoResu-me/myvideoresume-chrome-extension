/**
 * Résumé tools that don't need a job: the résumé check (scorer). Free
 * accounts get the score + one recommendation; Pro gets every fix.
 */
import { aiToolPath } from "@shared/ai-tools/tool-ids";
import { request } from "./http";

export type ResumeCheck = {
  overallScore: number;
  grade: string | null;
  recommendations: Array<{ title: string; description: string }>;
  /** Free: the rest is locked behind Pro. */
  locked: boolean;
  upgradeUrl: string | null;
};

type RawCheck = {
  overallScore?: number;
  grade?: string;
  recommendations?: Array<{ title?: string; description?: string }>;
  teaserRecommendation?: { title?: string } | null;
  isProPreview?: boolean;
  upgradeUrl?: string;
};

export async function checkResume(resumeId: string): Promise<ResumeCheck> {
  const raw = await request<RawCheck>(aiToolPath("resume-score"), { method: "POST", body: { resumeId } });
  const recs = raw.recommendations
    ? raw.recommendations.map((r) => ({ title: r.title ?? "", description: r.description ?? "" }))
    : raw.teaserRecommendation?.title
      ? [{ title: raw.teaserRecommendation.title, description: "" }]
      : [];
  return {
    overallScore: Math.round(Number(raw.overallScore ?? 0)),
    grade: raw.grade ?? null,
    recommendations: recs.filter((r) => r.title),
    locked: raw.isProPreview === true,
    upgradeUrl: raw.upgradeUrl ?? null,
  };
}
