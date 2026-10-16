/**
 * What the form on the page asks and where each answer comes from — shown
 * BEFORE filling ("9 of 11 ready"), then updated with what the fill did.
 * Pure: fields + the person's profile/letter/answers → a plan per field →
 * the rows the Apply tab lists.
 */
import { pickAutofillValue, type AutofillField, type AutofillProfile } from "../../../../../shared/autofill-matcher";
import { answerKey } from "../../state/apply-answers";

/** A field as the autofill content script reports it. */
export type FormField = AutofillField & { type?: string; required?: boolean };

export type FieldSource = "profile" | "letter" | "answer" | "resumeFile" | "none";
export type FieldPlan = { field: FormField; label: string; source: FieldSource; value: string };

/** Per field id, after a fill. "attached" = the résumé file went into the file input. */
export type FillOutcome = "filled" | "skipped" | "error" | "attached" | "download";

export type ReadinessRow =
  | { kind: "profile"; labels: string[]; done: boolean }
  | { kind: "letter"; fieldId: string; ready: boolean }
  | { kind: "resume"; fieldId: string; outcome: FillOutcome | null }
  | { kind: "need"; fieldId: string; label: string; answer: string; failed: boolean };

export const fieldLabel = (f: FormField): string => f.label || f.name || f.placeholder || f.id;

const isFile = (f: FormField) => f.type === "file";
const isLetterField = (f: FormField) => /cover/i.test(`${f.label ?? ""} ${f.name ?? ""} ${f.id}`);

export function planFields(
  fields: readonly FormField[],
  profile: AutofillProfile,
  answers: Readonly<Record<string, string>>,
): FieldPlan[] {
  let resumeTaken = false;
  return fields
    .filter((f) => f.type !== "hidden")
    .map((field) => {
      const label = fieldLabel(field);
      if (isFile(field)) {
        // The first file input takes the résumé; any other is the person's to attach.
        const source: FieldSource = resumeTaken ? "none" : "resumeFile";
        resumeTaken = true;
        return { field, label, source, value: "" };
      }
      const saved = answers[answerKey(label)];
      if (saved) return { field, label, source: "answer", value: saved };
      const picked = pickAutofillValue(field, profile);
      if (picked) return { field, label, source: picked.key === "coverLetter" ? "letter" : "profile", value: picked.value };
      if (isLetterField(field)) return { field, label, source: "letter", value: "" };
      return { field, label, source: "none", value: "" };
    });
}

export function readyCount(plans: readonly FieldPlan[]): number {
  return plans.filter((p) => p.value || p.source === "resumeFile").length;
}

/** Rows for the list: profile facts grouped into one line, the résumé + letter, then each open question. */
export function readinessRows(plans: readonly FieldPlan[], outcomes: Readonly<Record<string, FillOutcome>> | null): ReadinessRow[] {
  const failed = (p: FieldPlan) => !!outcomes && outcomes[p.field.id] !== "filled";
  const rows: ReadinessRow[] = [];
  const profile = plans.filter((p) => p.source === "profile" && !failed(p));
  if (profile.length) rows.push({ kind: "profile", labels: profile.map((p) => p.label), done: !!outcomes });
  for (const p of plans) {
    if (p.source === "resumeFile") rows.push({ kind: "resume", fieldId: p.field.id, outcome: outcomes?.[p.field.id] ?? null });
    else if (p.source === "letter" && p.value && !failed(p)) rows.push({ kind: "letter", fieldId: p.field.id, ready: true });
    else if (p.source === "letter" && !p.value) rows.push({ kind: "letter", fieldId: p.field.id, ready: false });
    else if (p.source === "none" || p.source === "answer" || failed(p))
      rows.push({ kind: "need", fieldId: p.field.id, label: p.label, answer: p.value, failed: failed(p) && !!p.value });
  }
  return rows;
}
