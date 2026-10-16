/**
 * Per-user state when someone signs in. On an account SWITCH everything the
 * previous account left in memory is dropped first; on first sign-in the
 * restored pair / route are kept.
 */
import { resetAnswers } from "./apply-answers";
import { jobsStore } from "./jobs";
import { loadLens } from "./lens";
import { navStore } from "./nav";
import { pairStore, restorePair } from "./pair";
import { remindersStore, startReminders } from "./reminders";
import { loadResumes, resumesStore } from "./resumes";
import { loadSettings } from "./settings";

export async function startUser(userId: string, switched: boolean): Promise<void> {
  if (switched) {
    jobsStore.set({ saved: [], loaded: false, loading: false });
    resumesStore.set({ list: [], activeId: null, loaded: false, loading: false });
    pairStore.set({ job: null, tailored: null, coverLetter: null, candidate: null, candidateResume: null });
    remindersStore.set({ all: {} });
    resetAnswers();
    navStore.set({ route: "home", tab: null, stack: [] });
  }
  await restorePair(userId);
  startReminders();
  await Promise.all([loadLens(), loadSettings().catch(() => undefined)]);
  await loadResumes().catch(() => undefined);
}
