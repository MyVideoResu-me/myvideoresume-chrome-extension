/**
 * Reviewing an import of my own profile into my master: what's new (add or
 * not), which matched entries differ (combine / keep mine / use profile),
 * and which basics differ (keep mine / use profile). The defaults and the
 * request come from the shared merge builders, so the panel can't drift
 * from the web merge dialog.
 */
import {
  buildDecisions,
  buildFinalDecisions,
  type MergeAction,
  type MergeAnalysis,
  type MergeDecision,
  type MergeSectionType,
} from "@shared/resume-merge-decisions";
import type { MessageKey } from "../platform/i18n";

export type MatchChoice = "combine" | "mine" | "profile";

/** Choice → engine action, and its label. Data, not branches. */
export const MATCH_CHOICES: ReadonlyArray<{ id: MatchChoice; action: MergeAction; labelKey: MessageKey }> = [
  { id: "combine", action: "merge", labelKey: "import_choiceCombine" },
  { id: "mine", action: "skip", labelKey: "import_keepMine" },
  { id: "profile", action: "replace", labelKey: "import_useProfile" },
];

/** Matched entries worth a decision: same record, different content. */
export function reviewableMatches(a: MergeAnalysis): number[] {
  return a.sectionMatches.flatMap((m, i) => (m.mergeAction !== "skip" && m.hasContentDifferences ? [i] : []));
}

/** One choice per section match, seeded from the shared defaults. */
export function initialChoices(a: MergeAnalysis): MatchChoice[] {
  return buildDecisions(a).map((d) => (d.action === "skip" ? "mine" : "combine"));
}

export function finalImportDecisions(
  a: MergeAnalysis,
  choices: readonly MatchChoice[],
  newItems: ReadonlyMap<string, boolean>,
): MergeDecision[] {
  const matches = buildDecisions(a).map((d, i) => {
    const choice = MATCH_CHOICES.find((c) => c.id === choices[i]);
    return choice ? { ...d, action: choice.action } : d;
  });
  return buildFinalDecisions(matches, newItems);
}

/** Section names, localized. */
export const SECTION_LABEL: Record<MergeSectionType, MessageKey> = {
  work: "section_work",
  education: "section_education",
  skills: "section_skills",
  volunteer: "section_volunteer",
  awards: "section_awards",
  certificates: "section_certificates",
  publications: "section_publications",
  languages: "section_languages",
  interests: "section_interests",
  references: "section_references",
  projects: "section_projects",
};

const FIELD_LABEL: Readonly<Record<string, MessageKey>> = {
  name: "field_name",
  label: "field_label",
  email: "field_email",
  phone: "field_phone",
  url: "field_url",
  summary: "field_summary",
  description: "field_summary",
  location: "field_location",
  position: "field_position",
  title: "field_position",
  startDate: "field_startDate",
  endDate: "field_endDate",
  institution: "field_institution",
  area: "field_area",
  studyType: "field_studyType",
};

/** A résumé field's name, localized ("Other details" when we have no name for it). */
export function fieldLabelKey(field: string): MessageKey {
  return FIELD_LABEL[field] ?? "field_other";
}

type Loose = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Fields that name an entry, per section, most specific first. */
const NAME_FIELDS = ["name", "title", "organization", "institution", "language", "position", "issuer", "awarder"];
const SECONDARY_FIELDS = ["position", "studyType", "area", "issuer", "fluency", "level", "date", "startDate"];

/** "Acme · Staff Engineer" — the entry's own words, for the review list. */
export function describeEntry(item: Loose): { label: string; secondary: string } {
  const get = (k: string) => str(item[k] ?? item[k.charAt(0).toUpperCase() + k.slice(1)]);
  const labelField = NAME_FIELDS.find((k) => get(k));
  const label = labelField ? get(labelField) : "";
  const secondary = SECONDARY_FIELDS.filter((k) => k !== labelField)
    .map(get)
    .find(Boolean) ?? "";
  return { label, secondary };
}
