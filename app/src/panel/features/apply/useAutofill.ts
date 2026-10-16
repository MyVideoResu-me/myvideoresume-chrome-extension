/**
 * Fill the application form on this page from the working résumé (+ the
 * cover letter written for this job). The person reviews and presses
 * Submit — we never submit.
 */
import { useState } from "preact/hooks";
import {
  extractResumeBasics,
  pickAutofillValue,
  type AutofillField,
  type AutofillProfile,
} from "../../../../../shared/autofill-matcher";
import { sendToWorker } from "../../platform/chrome";
import { pairStore } from "../../state/pair";
import { resumeContent } from "../../state/resumes";
import { sessionStore } from "../../state/session";
import { useAction } from "../../ui/useAction";

export type FillRow = { label: string; status: "filled" | "skipped" | "unmatched" | "error" };

type FormReply = { fields?: AutofillField[]; atsProvider?: string; error?: string } | undefined;
type FillReply = { results?: Record<string, string> } | undefined;

export class NoFormError extends Error {}

async function buildProfile(resumeId: string, jobId: string | null): Promise<AutofillProfile> {
  const profile: AutofillProfile = {};
  const session = sessionStore.get().session;
  if (session.status === "signedIn") {
    const name = session.me.name ?? "";
    if (name) {
      const [first, ...rest] = name.split(/\s+/);
      Object.assign(profile, { fullName: name, firstName: first ?? "", lastName: rest.join(" ") });
    }
    if (session.me.email) profile.email = session.me.email;
  }
  Object.assign(profile, extractResumeBasics(await resumeContent(resumeId)));
  const letter = pairStore.get().coverLetter;
  if (letter && jobId && letter.jobId === jobId && letter.text) profile.coverLetter = letter.text;
  return profile;
}

export function useAutofill(resumeId: string | null, jobId: string | null) {
  const [rows, setRows] = useState<FillRow[] | null>(null);

  const fill = useAction(async () => {
    if (!resumeId) return;
    const form = await sendToWorker<FormReply>({ action: "extractFormFields" });
    const fields = form?.fields ?? [];
    if (!fields.length) throw new NoFormError();
    const profile = await buildProfile(resumeId, jobId);
    const answers: Record<string, string> = {};
    for (const field of fields) {
      const picked = pickAutofillValue(field, profile);
      if (picked) answers[field.id] = picked.value;
    }
    const filled = Object.keys(answers).length
      ? await sendToWorker<FillReply>({ action: "fillFormFields", answers })
      : undefined;
    const results = filled?.results ?? {};
    setRows(
      fields.map((f) => {
        const label = f.label || f.name || f.placeholder || f.id;
        if (!(f.id in answers)) return { label, status: "unmatched" as const };
        const r = results[f.id];
        return { label, status: r === "filled" ? "filled" : r === "skipped" ? "skipped" : "error" };
      }),
    );
  });

  return { rows, fill };
}
