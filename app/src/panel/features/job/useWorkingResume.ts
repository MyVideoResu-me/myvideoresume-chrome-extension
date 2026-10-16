/** The résumé a job flow should use: the version tailored to this job, else the active one. */
import { pairStore, resumeIdForJob } from "../../state/pair";
import { resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";

export function useWorkingResume(jobId: string | null): { id: string; title: string; tailored: boolean } | null {
  const pair = useStore(pairStore, (s) => s);
  const resumes = useStore(resumesStore, (s) => s);
  const id = resumeIdForJob(pair, jobId, resumes.activeId);
  if (!id) return null;
  const tailored = !!jobId && pair.tailored?.jobId === jobId && pair.tailored.resumeId === id;
  const title = tailored ? pair.tailored!.title : (resumes.list.find((r) => r.id === id)?.title ?? "");
  return { id, title, tailored };
}
