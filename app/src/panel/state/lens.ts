/** The lens the person picked (per user; cleared on account switch). */
import { storageGet, storageSet } from "../platform/chrome";
import { resolveLens, type LensDef, type LensId } from "../domain/lenses";
import { createStore, useStore } from "./store";
import { useRole } from "./session";
import { LENS_KEY } from "../../shared/settings";

export const lensStore = createStore<{ saved: LensId | null }>({ saved: null });

export async function loadLens(): Promise<void> {
  lensStore.set({ saved: (await storageGet<LensId>(LENS_KEY)) ?? null });
}

export async function chooseLens(id: LensId): Promise<void> {
  lensStore.set({ saved: id });
  await storageSet({ [LENS_KEY]: id });
}

/** The effective lens for the signed-in person. */
export function useLens(): LensDef {
  const saved = useStore(lensStore, (s) => s.saved);
  return resolveLens(saved, useRole());
}

