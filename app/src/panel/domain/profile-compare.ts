/**
 * Compare someone else's profile with my résumé — as SUGGESTIONS only.
 * Their facts (employers, titles, dates, bullets, names) never enter my
 * résumé: a skill is added only after I say I have it, a section becomes a
 * prompt to add MY entries, and their headline is inspiration for the one
 * I write. `applyConfirmedSuggestions` is the only thing that edits content,
 * and it only takes what I confirmed or typed.
 */
import { applyConfirmedFacts } from "@shared/resume-tailor";
import type { ResumeContent } from "@shared/resume";
import type { MessageKey } from "../platform/i18n";

type Loose = Record<string, unknown>;

/** Sections worth suggesting when they have one and I don't. Data, not branches. */
export const SUGGESTED_SECTIONS = [
  { id: "certificates", labelKey: "section_certificates" },
  { id: "projects", labelKey: "section_projects" },
  { id: "volunteer", labelKey: "section_volunteer" },
  { id: "languages", labelKey: "section_languages" },
] as const satisfies ReadonlyArray<{ id: keyof ResumeContent; labelKey: MessageKey }>;

export type SuggestedSection = (typeof SUGGESTED_SECTIONS)[number];

export type BulletDensity = { bullets: number; quantified: number; ratio: number };

export type ProfileComparison = {
  /** Skills they list that I don't (names only — I confirm each one). */
  missingSkills: string[];
  headline: { mine: string; theirs: string };
  summary: { mine: number; theirs: number };
  missingSections: SuggestedSection[];
  density: { mine: BulletDensity; theirs: BulletDensity };
  /** Their bullets carry noticeably more numbers than mine. */
  quantifyTip: boolean;
};

const MAX_SKILLS = 15;
const QUANTIFIED = /\d|%|[$€£¥]/;
/** How far below theirs my quantified share must be before we suggest it. */
const DENSITY_GAP = 0.15;

const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, " ");
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const list = (v: unknown): Loose[] => (Array.isArray(v) ? (v as Loose[]) : []);

function skillTerms(c: ResumeContent): string[] {
  const out: string[] = [];
  for (const s of list(c.skills)) {
    const name = str(s.name);
    if (name) out.push(name);
    for (const k of Array.isArray(s.keywords) ? s.keywords : []) if (typeof k === "string" && k.trim()) out.push(k.trim());
  }
  return out;
}

export function bulletDensity(c: ResumeContent): BulletDensity {
  const bullets = [...list(c.work), ...list(c.projects)].flatMap((e) =>
    Array.isArray(e.highlights) ? (e.highlights as unknown[]).filter((h): h is string => typeof h === "string") : [],
  );
  const quantified = bullets.filter((b) => QUANTIFIED.test(b)).length;
  return { bullets: bullets.length, quantified, ratio: bullets.length ? quantified / bullets.length : 0 };
}

export function compareProfiles(mine: ResumeContent, theirs: ResumeContent): ProfileComparison {
  const have = new Set(skillTerms(mine).map(norm));
  const seen = new Set<string>();
  const missingSkills: string[] = [];
  for (const skill of skillTerms(theirs)) {
    const key = norm(skill);
    if (have.has(key) || seen.has(key)) continue;
    seen.add(key);
    missingSkills.push(skill);
    if (missingSkills.length >= MAX_SKILLS) break;
  }
  const density = { mine: bulletDensity(mine), theirs: bulletDensity(theirs) };
  return {
    missingSkills,
    headline: { mine: str(mine.basics?.label), theirs: str(theirs.basics?.label) },
    summary: { mine: str(mine.basics?.summary).length, theirs: str(theirs.basics?.summary).length },
    missingSections: SUGGESTED_SECTIONS.filter((s) => list(theirs[s.id]).length > 0 && list(mine[s.id]).length === 0),
    density,
    quantifyTip: density.theirs.bullets > 0 && density.theirs.ratio - density.mine.ratio >= DENSITY_GAP,
  };
}

export type ConfirmedSuggestions = {
  /** Skills I said I have. */
  skills: readonly string[];
  /** The headline I wrote; empty or unchanged = keep mine. */
  headline: string;
};

export function hasConfirmedChanges(mine: ResumeContent, confirmed: ConfirmedSuggestions): boolean {
  const headline = confirmed.headline.trim();
  return confirmed.skills.length > 0 || (!!headline && headline !== str(mine.basics?.label));
}

/** My résumé plus only what I confirmed. Never reads their content. */
export function applyConfirmedSuggestions(mine: ResumeContent, confirmed: ConfirmedSuggestions): ResumeContent {
  let out = applyConfirmedFacts(
    mine,
    confirmed.skills.map((name) => ({ kind: "skill" as const, name })),
  );
  const headline = confirmed.headline.trim();
  if (headline && headline !== str(mine.basics?.label)) {
    out = { ...out, basics: { ...(out.basics ?? {}), label: headline } } as ResumeContent;
  }
  return out;
}
