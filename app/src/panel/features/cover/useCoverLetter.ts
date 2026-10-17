/**
 * Write a cover letter from the working résumé (the version tailored to
 * this job when there is one) + the job, re-tone it, and save it with the
 * job. "Saved with the job" = on the tailored version's document
 * (`meta.coverLetter`, shared/cover-letter.ts) — the one place hired.video
 * keeps a job's letter — so it needs a tailored version; the master is
 * never written. The letter is shown and edited as plain text; the Apply
 * tab reuses that text.
 */
import { useEffect, useState } from "preact/hooks";
import {
  coverLetterFromText,
  coverLetterToText,
  readCoverLetter,
  withCoverLetter,
  type CoverLetter,
  type CoverLetterTone,
} from "@shared/cover-letter";
import type { ResumeContent } from "@shared/resume";
import { retoneCoverLetter, writeCoverLetter } from "../../api/match";
import type { Job } from "../../api/jobs";
import { updateResumeContent } from "../../api/resumes";
import { setCoverLetterText } from "../../state/pair";
import { cacheResumeContent, resumeContent } from "../../state/resumes";
import { longDate } from "../../platform/i18n";
import { useAction } from "../../ui/useAction";

type Draft = { job: Job; letter: CoverLetter; content: ResumeContent };

/** The résumé the letter is written from: its id, and whether it is the version tailored to this job. */
export type LetterResume = { id: string; tailored: boolean };

/** The person's edits, back into a letter (the sender block + date are re-derived on render). */
function letterFromText(text: string, base: CoverLetter): CoverLetter {
  const start = text.indexOf(base.salutation);
  const parsed = coverLetterFromText(start >= 0 ? text.slice(start) : text, {
    salutation: base.salutation,
    signOff: base.signOff,
    date: base.date,
  });
  return parsed
    ? { ...parsed, jobTitle: base.jobTitle, organization: base.organization, recipientLines: base.recipientLines, tone: base.tone, style: base.style }
    : base;
}

export function useCoverLetter(resume: LetterResume | null, getJob: () => Promise<Job>) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState<string | null>(null);
  const [generated, setGenerated] = useState("");

  const show = (next: Draft) => {
    setDraft(next);
    const body = coverLetterToText(next.letter, next.content, longDate());
    setText(body);
    setGenerated(body);
    setCoverLetterText(next.job.id, body);
    return body;
  };

  // A letter already saved with this job's version opens as the draft.
  useEffect(() => {
    if (!resume?.tailored || draft) return;
    let live = true;
    void Promise.all([getJob(), resumeContent(resume.id)])
      .then(([job, content]) => {
        const letter = readCoverLetter(content);
        if (live && letter) setSavedText(show({ job, content, letter }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [resume?.id, resume?.tailored]);

  const write = useAction(async () => {
    if (!resume) return;
    const job = await getJob();
    const content = await resumeContent(resume.id);
    show({ job, content, letter: await writeCoverLetter({ jobId: job.id }, content) });
  });

  /** The letter as it stands: the AI's, or the person's edits of it. */
  const current = (d: Draft): CoverLetter => (text === generated ? d.letter : letterFromText(text, d.letter));

  const retone = useAction(async (next: CoverLetterTone) => {
    if (!draft) return;
    show({ ...draft, letter: { ...(await retoneCoverLetter(current(draft), next)), tone: next } });
  });

  const edit = (value: string) => {
    setText(value);
    if (draft) setCoverLetterText(draft.job.id, value);
  };

  const saveToJob = useAction(async () => {
    if (!draft || !resume?.tailored) return;
    const content = withCoverLetter(await resumeContent(resume.id), current(draft));
    await updateResumeContent(resume.id, content);
    cacheResumeContent(resume.id, content);
    setSavedText(text);
  });

  return {
    draft,
    text,
    edit,
    tone: draft?.letter.tone ?? null,
    write,
    retone,
    saveToJob,
    /** The text on screen is what's saved with the job. */
    isSaved: savedText !== null && savedText === text,
  };
}
