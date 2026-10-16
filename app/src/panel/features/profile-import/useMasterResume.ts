/** The master the import works against: the active résumé's master, else the first master. */
import type { ResumeSummary } from "../../api/resumes";
import { resumesStore, type ResumesState } from "../../state/resumes";
import { useStore } from "../../state/store";

function masterOf(s: ResumesState): ResumeSummary | null {
  const active = s.list.find((r) => r.id === s.activeId);
  const id = active?.masterId || s.list.find((r) => r.isMaster)?.id;
  return s.list.find((r) => r.id === id && r.isMaster) ?? null;
}

export function useMasterResume(): ResumeSummary | null {
  return useStore(resumesStore, masterOf);
}
