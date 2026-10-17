/**
 * Run an async action with busy + error state — every button that calls
 * the API goes through this, so loading and error handling look the same
 * everywhere.
 */
import { useCallback, useRef, useState } from "preact/hooks";

export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async (...args: A): Promise<R | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fnRef.current(...args);
    } catch (err) {
      setError(err);
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, clearError: () => setError(null) };
}

/**
 * `useAction` for a list: one action, run for one row at a time — `busyKey`
 * says which row is working so only its button spins.
 */
export function useKeyedAction<A extends unknown[], R>(fn: (key: string, ...args: A) => Promise<R>) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const action = useAction(fn);
  const run = useCallback(
    async (key: string, ...args: A): Promise<R | undefined> => {
      setBusyKey(key);
      try {
        return await action.run(key, ...args);
      } finally {
        setBusyKey(null);
      }
    },
    [action.run],
  );
  return { run, busyKey, error: action.error, clearError: action.clearError };
}
