/**
 * Résumé documents the panel builds or flattens:
 *   resumeToText        — any résumé → the plain text the video + message
 *                         AI read (one renderer: the platform's markdown).
 *   profileToResume     — a captured candidate profile → a JSON Resume.
 *   anonymizeResume     — strip who/where for a blind shortlist.
 *   applyReviewedTailor — the tailored draft minus the changes the person
 *                         turned off, plus the skills they confirmed.
 */
import { renderMarkdownFromJsonResume } from "@shared/resume-markdown";
import { readAt, writeAt } from "@shared/resume-path";
import { applyConfirmedFacts, type TailorChange } from "@shared/resume-tailor";
import type { ResumeContent } from "@shared/resume";
import type { ExtractedProfile } from "../api/recruiter";

export function resumeToText(content: ResumeContent): string {
  return renderMarkdownFromJsonResume(content);
}

type Loose = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function profileToResume(profile: ExtractedProfile): ResumeContent {
  return {
    basics: {
      name: profile.name,
      label: profile.title,
      summary: profile.summary,
      ...(profile.email ? { email: profile.email } : {}),
      location: { city: profile.location },
    },
    work: profile.experience.map((e: Loose) => ({
      name: str(e.company ?? e.name ?? e.organization),
      position: str(e.title ?? e.position ?? e.role),
      startDate: str(e.startDate ?? e.start),
      endDate: str(e.endDate ?? e.end),
      summary: str(e.description ?? e.summary),
      highlights: Array.isArray(e.highlights) ? (e.highlights as string[]) : [],
    })),
    education: profile.education.map((e: Loose) => ({
      institution: str(e.school ?? e.institution),
      studyType: str(e.degree ?? e.studyType),
      area: str(e.field ?? e.area ?? e.fieldOfStudy),
      endDate: str(e.endDate ?? e.end ?? e.year),
    })),
    skills: profile.skills.map((name) => ({ name, level: "", keywords: [] })),
  } as unknown as ResumeContent;
}

export function anonymizeResume(content: ResumeContent, placeholderName: string): ResumeContent {
  const c = content as unknown as Loose;
  const basics = (c.basics ?? {}) as Loose;
  return {
    ...c,
    basics: { label: basics.label, summary: basics.summary, name: placeholderName },
    work: ((c.work ?? []) as Loose[]).map((w) => ({ ...w, name: "", url: "" })),
    references: [],
  } as unknown as ResumeContent;
}

/**
 * `reverted` holds indexes into `changes`. A reverted change gets the
 * original value back at its path; changes without a path can't be
 * reverted individually and stay applied.
 */
export function applyReviewedTailor(
  original: ResumeContent,
  tailored: ResumeContent,
  changes: readonly TailorChange[],
  reverted: ReadonlySet<number>,
  confirmedSkills: readonly string[],
): ResumeContent {
  let out = tailored;
  changes.forEach((change, i) => {
    if (reverted.has(i) && change.path) out = writeAt(out, change.path, readAt(original, change.path));
  });
  return applyConfirmedFacts(
    out,
    confirmedSkills.map((name) => ({ kind: "skill" as const, name })),
  );
}
