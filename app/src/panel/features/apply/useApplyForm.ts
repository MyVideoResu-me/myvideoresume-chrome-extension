/**
 * The application form on this page: read it as soon as the tab opens
 * (what we can fill, what the person must answer), then fill it from the
 * working résumé, the cover letter written for this job and the person's
 * saved answers, attach the résumé file, and watch for the person's own
 * submit. We never submit.
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import { extractResumeBasics, type AutofillProfile } from "../../../../../shared/autofill-matcher";
import { activeTabUrl, sendToWorker } from "../../platform/chrome";
import { answersStore, loadAnswers, saveAnswer } from "../../state/apply-answers";
import { watchForSubmit } from "../../state/apply-watch";
import { pairStore } from "../../state/pair";
import { resumeContent } from "../../state/resumes";
import { sessionStore } from "../../state/session";
import { useStore } from "../../state/store";
import { useAction } from "../../ui/useAction";
import { planFields, readinessRows, readyCount, type FieldPlan, type FillOutcome, type FormField } from "./readiness";
import { attachResumeFile } from "./resume-file";

type FormReply = { fields?: FormField[]; error?: string } | undefined;
type FillReply = { results?: Record<string, "filled" | "skipped" | "error"> } | undefined;

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

export function useApplyForm(resume: { id: string; title: string } | null, jobId: string | null) {
  const [fields, setFields] = useState<FormField[] | null>(null);
  const [profile, setProfile] = useState<AutofillProfile>({});
  const [outcomes, setOutcomes] = useState<Record<string, FillOutcome> | null>(null);
  const answers = useStore(answersStore, (s) => s.all);
  const letterText = useStore(pairStore, (s) => (jobId && s.coverLetter?.jobId === jobId ? s.coverLetter.text : ""));

  /** Read the form on the page; throws NoFormError when there is none. */
  const readForm = async (resumeId: string): Promise<FieldPlan[]> => {
    setOutcomes(null);
    const [form] = await Promise.all([sendToWorker<FormReply>({ action: "extractFormFields" }), loadAnswers()]);
    const found = (form?.fields ?? []).filter((f) => f.type !== "hidden");
    setFields(found);
    if (!found.length) throw new NoFormError();
    const built = await buildProfile(resumeId, jobId);
    setProfile(built);
    return planFields(found, built, answersStore.get().all);
  };

  const scan = useAction(async () => {
    if (resume) await readForm(resume.id);
  });

  // Read the form as soon as the tab opens, and again when the letter changes.
  useEffect(() => {
    void scan.run();
  }, [resume?.id, jobId]);
  useEffect(() => {
    if (letterText) setProfile((p) => ({ ...p, coverLetter: letterText }));
  }, [letterText]);

  const plans = useMemo(() => planFields(fields ?? [], profile, answers), [fields, profile, answers]);

  const fill = useAction(async () => {
    if (!resume) return;
    // Opened the form after the tab did → read it first.
    const current = fields?.length ? plans : await readForm(resume.id);
    const values: Record<string, string> = {};
    for (const p of current) if (p.value) values[p.field.id] = p.value;
    const pageUrl = (await activeTabUrl()) ?? "";
    const filled = await sendToWorker<FillReply>({ action: "fillFormFields", answers: values, watchSubmit: true });
    const next: Record<string, FillOutcome> = { ...(filled?.results ?? {}) };
    const fileField = current.find((p) => p.source === "resumeFile");
    if (fileField) next[fileField.field.id] = await attachResumeFile(resume, fileField.field.id);
    setOutcomes(next);
    if (jobId) watchForSubmit(jobId, pageUrl);
  });

  return {
    rows: readinessRows(plans, outcomes),
    ready: readyCount(plans),
    total: plans.length,
    filled: outcomes !== null,
    scan,
    fill,
    answer: saveAnswer,
  };
}
