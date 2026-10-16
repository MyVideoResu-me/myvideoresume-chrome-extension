/**
 * Per-user state when someone signs in. On an account SWITCH everything the
 * previous account left in memory is dropped first; on first sign-in the
 * restored pair / route are kept.
 */
import { jobsStore } from "./jobs";
import { loadLens } from "./lens";
import { navStore } from "./nav";
import { pairStore, restorePair } from "./pair";
import { loadResumes, resumesStore } from "./resumes";

export async function startUser(userId: string, switched: boolean): Promise<void> {
  if (switched) {
    jobsStore.set({ saved: [], loaded: false, loading: false });
    resumesStore.set({ list: [], activeId: null, loaded: false, loading: false });
    pairStore.set({ job: null, tailored: null, coverLetter: null, candidate: null, candidateResume: null });
    navStore.set({ route: "home", stack: [] });
  }
  await restorePair(userId);
  await loadLens();
  await loadResumes().catch(() => undefined);
}
