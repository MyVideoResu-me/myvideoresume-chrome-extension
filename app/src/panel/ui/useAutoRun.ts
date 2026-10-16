/** Run an action once when `enabled` first becomes true (settings like auto-score). */
import { useEffect, useRef } from "preact/hooks";

export function useAutoRun(enabled: boolean, run: () => unknown): void {
  const done = useRef(false);
  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;
    void run();
  }, [enabled]);
}
