/**
 * "Me" — the person's résumés and which one the panel works with. The
 * server's isActive flag wins; otherwise the master.
 */
import {
  fetchResumeContent,
  fetchResumes,
  letterRef,
  setActiveResume,
  uploadResumeFile,
  type ResumeSummary,
} from "../api/resumes";
import { storageSet } from "../platform/chrome";
import type { ResumeContent } from "@shared/resume";
import { createStore } from "./store";

const SELECTED_KEY = "selectedResumeId";

export type ResumesState = {
  list: ResumeSummary[];
  activeId: string | null;
  loaded: boolean;
  loading: boolean;
};

export const resumesStore = createStore<ResumesState>({ list: [], activeId: null, loaded: false, loading: false });

export async function loadResumes(force = false): Promise<void> {
  const s = resumesStore.get();
  if (s.loading || (s.loaded && !force)) return;
  resumesStore.set({ loading: true });
  try {
    const { list, documents } = await fetchResumes();
    for (const [id, doc] of documents) contentCache.set(id, Promise.resolve(doc));
    const active = list.find((r) => r.isActive) ?? list.find((r) => r.isMaster) ?? null;
    resumesStore.set({ list, activeId: active?.id ?? null, loaded: true });
  } finally {
    resumesStore.set({ loading: false });
  }
}

export async function chooseResume(id: string): Promise<void> {
  resumesStore.set({ activeId: id });
  await storageSet({ [SELECTED_KEY]: id });
  await setActiveResume(id).catch(() => undefined);
}

export async function uploadResume(file: File): Promise<void> {
  await uploadResumeFile(file);
  await loadResumes(true);
}

export function activeResume(state: ResumesState): ResumeSummary | null {
  return state.list.find((r) => r.id === state.activeId) ?? null;
}

/** Résumé documents are read often (letter, video, tailor) — keep one copy per id. */
const contentCache = new Map<string, Promise<ResumeContent>>();

/** After the panel itself saved a document, keep the cached copy (and the list's letter) in step. */
export function cacheResumeContent(id: string, content: ResumeContent): void {
  contentCache.set(id, Promise.resolve(content));
  resumesStore.set((s) => ({
    ...s,
    list: s.list.map((r) => (r.id === id && !r.isMaster ? { ...r, letter: letterRef(content) } : r)),
  }));
}

export function resumeContent(id: string): Promise<ResumeContent> {
  let hit = contentCache.get(id);
  if (!hit) {
    hit = fetchResumeContent(id);
    hit.catch(() => contentCache.delete(id));
    contentCache.set(id, hit);
  }
  return hit;
}
