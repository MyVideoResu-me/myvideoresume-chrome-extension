/**
 * Where a tailoring change lands, in the person's words: "Acme · bullet 2"
 * for a work bullet, "Acme" for the entry, else the section ("Summary").
 * Reads the entry's name from the original résumé via the change's path.
 */
import { readAt } from "@shared/resume-path";
import type { ResumeContent } from "@shared/resume";
import type { TailorChange } from "@shared/resume-tailor";
import { t } from "../../platform/i18n";

/** Sections whose entries have a name, and which field holds it. */
const ENTRY_NAME: Partial<Record<TailorChange["section"], string>> = {
  work: "name",
  volunteer: "organization",
  projects: "name",
};

export function changeLabel(change: TailorChange, original: ResumeContent): string {
  const sectionLabel = t(`section_${change.section}` as const);
  const parts = (change.path ?? "").split(".");
  const nameField = ENTRY_NAME[change.section];
  if (!nameField || parts.length < 2 || !/^\d+$/.test(parts[1])) return sectionLabel;
  const entry = readAt(original, `${parts[0]}.${parts[1]}`) as Record<string, unknown> | undefined;
  const name = typeof entry?.[nameField] === "string" ? (entry[nameField] as string).trim() : "";
  if (!name) return sectionLabel;
  if (parts[2] === "highlights" && parts[3] && /^\d+$/.test(parts[3])) {
    return t("strengthen_bulletLabel", { entry: name, n: Number(parts[3]) + 1 });
  }
  return name;
}
