/**
 * Write a cover letter from the working résumé (the version tailored to
 * this job when there is one) + the job, and re-tone it. The letter is
 * shown and edited as plain text; the Apply step reuses that text.
 */
import { useState } from "preact/hooks";
import { coverLetterToText, type CoverLetter, type CoverLetterTone } from "@shared/cover-letter";
import type { ResumeContent } from "@shared/resume";
import { retoneCoverLetter, writeCoverLetter } from "../../api/match";
import type { Job } from "../../api/jobs";
import { setCoverLetterText } from "../../state/pair";
import { resumeContent } from "../../state/resumes";
import { uiLocale } from "../../platform/i18n";
import { useAction } from "../../ui/useAction";

type Draft = { job: Job; letter: CoverLetter; content: ResumeContent };

function formattedDate(): string {
  return new Date().toLocaleDateString(uiLocale(), { year: "numeric", month: "long", day: "numeric" });
}

export function useCoverLetter(resumeId: string | null, getJob: () => Promise<Job>) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState("");
  const [tone, setTone] = useState<CoverLetterTone | null>(null);

  const show = (next: Draft) => {
    setDraft(next);
    const body = coverLetterToText(next.letter, next.content, formattedDate());
    setText(body);
    setCoverLetterText(next.job.id, body);
  };

  const write = useAction(async () => {
    if (!resumeId) return;
    const job = await getJob();
    const content = await resumeContent(resumeId);
    show({ job, content, letter: await writeCoverLetter({ jobId: job.id }, content) });
  });

  const retone = useAction(async (next: CoverLetterTone) => {
    if (!draft) return;
    setTone(next);
    show({ ...draft, letter: await retoneCoverLetter(draft.letter, next) });
  });

  const edit = (value: string) => {
    setText(value);
    if (draft) setCoverLetterText(draft.job.id, value);
  };

  return { draft, text, edit, tone, write, retone };
}
