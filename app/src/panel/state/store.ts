/** A minimal observable store + Preact hook. Each state module owns one. */
import { useEffect, useReducer, useRef } from "preact/hooks";

export type Store<T> = {
  get(): T;
  set(next: Partial<T> | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
};

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next) {
      state = typeof next === "function" ? next(state) : { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * Select a slice of a store. Re-renders when the selected value changes
 * (Object.is); the selector may close over props — the latest one is used.
 */
export function useStore<T extends object, S>(store: Store<T>, select: (state: T) => S): S {
  const selectRef = useRef(select);
  selectRef.current = select;
  const value = select(store.get());
  const valueRef = useRef(value);
  valueRef.current = value;
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    const check = () => {
      if (!Object.is(selectRef.current(store.get()), valueRef.current)) rerender(0);
    };
    const unsubscribe = store.subscribe(check);
    // The effect runs after paint: a set() between render and subscribe
    // would otherwise be missed (e.g. the session resolving "signed out"
    // before the panel subscribes — the panel then sat on "Loading…").
    check();
    return unsubscribe;
  }, [store]);
  return value;
}
