/**
 * Answers the person typed for application questions the résumé can't
 * answer ("Work authorization", "Earliest start date"), kept per question
 * so the next form with the same question is ready too. Local only.
 */
import { storageGet, storageSet } from "../platform/chrome";
import { createStore } from "./store";

export const APPLY_ANSWERS_KEY = "applyAnswers";

export const answersStore = createStore<{ all: Record<string, string> }>({ all: {} });

/** One question, however the form spaces or capitalises it. */
export const answerKey = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, " ");

let loading: Promise<void> | null = null;

export function loadAnswers(): Promise<void> {
  loading ??= storageGet<Record<string, string>>(APPLY_ANSWERS_KEY).then((all) => answersStore.set({ all: all ?? {} }));
  return loading;
}

/** Account switch: forget the previous person's answers. */
export function resetAnswers(): void {
  loading = null;
  answersStore.set({ all: {} });
}

export async function saveAnswer(label: string, value: string): Promise<void> {
  const all = { ...answersStore.get().all };
  const key = answerKey(label);
  if (value.trim()) all[key] = value.trim();
  else delete all[key];
  answersStore.set({ all });
  await storageSet({ [APPLY_ANSWERS_KEY]: all });
}
