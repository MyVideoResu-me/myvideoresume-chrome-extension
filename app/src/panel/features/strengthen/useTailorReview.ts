/**
 * Strengthen = tailor the active résumé to the job WITHOUT saving, let the
 * person turn individual changes off and confirm skills the job asks for,
 * then save the result as a new version (the master is never touched).
 */
import { useMemo, useState } from "preact/hooks";
import type { ResumeContent } from "@shared/resume";
import type { JobGap } from "@shared/resume-tailor";
import { previewTailor, type TailorPreview } from "../../api/match";
import { saveVersion, type ResumeSummary } from "../../api/resumes";
import type { Job } from "../../api/jobs";
import { applyReviewedTailor } from "../../domain/resume-docs";
import { setTailoredVersion } from "../../state/pair";
import { loadResumes, resumeContent } from "../../state/resumes";
import { useAction } from "../../ui/useAction";

export type Review = {
  job: Job;
  original: ResumeContent;
  preview: TailorPreview;
};

export function useTailorReview(resume: ResumeSummary | null, getJob: () => Promise<Job>) {
  const [review, setReview] = useState<Review | null>(null);
  const [reverted, setReverted] = useState<ReadonlySet<number>>(new Set());
  const [confirmed, setConfirmed] = useState<readonly string[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<{ resumeId: string; title: string } | null>(null);

  const start = useAction(async () => {
    if (!resume) return;
    const job = await getJob();
    const [original, preview] = await Promise.all([resumeContent(resume.id), previewTailor({ jobId: job.id }, resume.id)]);
    setReview({ job, original, preview });
    setReverted(new Set());
    setConfirmed([]);
    setDismissed(new Set());
    setSaved(null);
  });

  const toggleChange = (index: number) =>
    setReverted((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  const answerGap = (gap: JobGap, has: boolean) => {
    if (has && gap.skill) setConfirmed((prev) => (prev.includes(gap.skill!) ? prev : [...prev, gap.skill!]));
    setDismissed((prev) => new Set(prev).add(gap.id));
  };

  const keptCount = review ? review.preview.changes.length - reverted.size : 0;

  const save = useAction(async () => {
    if (!review || !resume) return;
    const content = applyReviewedTailor(
      review.original,
      review.preview.tailoredResume,
      review.preview.changes,
      reverted,
      confirmed,
    );
    const title = review.preview.variationTitle || `${review.job.company} — ${review.job.title}`.trim();
    const out = await saveVersion(resume.masterId, { content, title });
    setSaved({ resumeId: out.resumeId, title: out.title });
    setTailoredVersion({ jobId: review.job.id, resumeId: out.resumeId, title: out.title });
    void loadResumes(true);
  });

  const openGaps = useMemo(
    () => (review ? review.preview.gaps.filter((g) => !dismissed.has(g.id)) : []),
    [review, dismissed],
  );

  return { review, start, reverted, toggleChange, openGaps, answerGap, confirmed, keptCount, save, saved };
}
