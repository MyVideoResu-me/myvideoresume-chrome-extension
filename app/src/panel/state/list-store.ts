/**
 * A list the panel reads once per session from the API (videos, the
 * talent pool): `load()` fetches unless already loaded, `load(true)`
 * refreshes, `reset()` drops it on an account switch.
 */
import { createStore, type Store } from "./store";

export type ListState<T> = { items: T[]; loaded: boolean; loading: boolean; error: unknown };

export type ListLoader<T> = {
  store: Store<ListState<T>>;
  load: (force?: boolean) => Promise<void>;
  reset: () => void;
};

export function createListLoader<T>(fetch: () => Promise<T[]>): ListLoader<T> {
  const empty: ListState<T> = { items: [], loaded: false, loading: false, error: null };
  const store = createStore<ListState<T>>(empty);
  return {
    store,
    async load(force = false) {
      const s = store.get();
      if (s.loading || (s.loaded && !force)) return;
      store.set({ loading: true, error: null });
      try {
        store.set({ items: await fetch(), loaded: true });
      } catch (error) {
        store.set({ error, loaded: true });
      } finally {
        store.set({ loading: false });
      }
    },
    reset: () => store.set(empty),
  };
}
