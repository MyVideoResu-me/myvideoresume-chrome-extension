/**
 * Strengthen = tailor the active résumé to the job WITHOUT saving, let the
 * person turn individual changes off and confirm skills the job asks for,
 * then save the result as a new version (the master is never touched).
 */
import { useMemo, useState } from "preact/hooks";
import type { ResumeContent } from "@shared/resume";
import type { JobGap, TailorChange } from "@shared/resume-tailor";
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

/**
 * A change without a path can't be put back on its own
 * (applyReviewedTailor), so it is always applied — its toggle must not
 * pretend otherwise.
 */
export const isRevertible = (change: TailorChange): boolean => !!change.path;

/** The fit if the person keeps `kept` of `total` changes: the API's before → after, in proportion. */
export function predictedScore(oldScore: number, newScore: number, kept: number, total: number): number {
  if (!total) return newScore;
  return Math.round(oldScore + ((newScore - oldScore) * kept) / total);
}

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

  const toggleChange = (index: number) => {
    const change = review?.preview.changes[index];
    if (!change || !isRevertible(change)) return;
    setReverted((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const answerGap = (gap: JobGap, has: boolean) => {
    if (has && gap.skill) setConfirmed((prev) => (prev.includes(gap.skill!) ? prev : [...prev, gap.skill!]));
    setDismissed((prev) => new Set(prev).add(gap.id));
  };

  const total = review?.preview.changes.length ?? 0;
  const keptCount = total - reverted.size;
  const score = review
    ? predictedScore(review.preview.oldScore, review.preview.newScore, keptCount, total)
    : 0;
  const versionTitle = review
    ? review.preview.variationTitle || [review.job.company, review.job.title].filter(Boolean).join(" — ")
    : "";

  /** The version as it will be saved (what Preview shows). */
  const draft = (): ResumeContent | null =>
    review
      ? applyReviewedTailor(review.original, review.preview.tailoredResume, review.preview.changes, reverted, confirmed)
      : null;

  const save = useAction(async (): Promise<boolean> => {
    const content = draft();
    if (!review || !resume || !content) return false;
    // A NEW version under the master — the master itself is never written.
    const out = await saveVersion(resume.masterId, { content, title: versionTitle });
    setSaved({ resumeId: out.resumeId, title: out.title });
    setTailoredVersion({ jobId: review.job.id, resumeId: out.resumeId, title: out.title });
    void loadResumes(true);
    return true;
  });

  const openGaps = useMemo(
    () => (review ? review.preview.gaps.filter((g) => !dismissed.has(g.id)) : []),
    [review, dismissed],
  );

  return {
    review,
    start,
    reverted,
    toggleChange,
    openGaps,
    answerGap,
    confirmed,
    keptCount,
    score,
    versionTitle,
    draft,
    save,
    saved,
  };
}
