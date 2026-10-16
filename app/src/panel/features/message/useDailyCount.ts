/** How many messages of one kind the person handed over today (local to this browser). */
import { useEffect, useState } from "preact/hooks";
import { storageGet, storageSet } from "../../platform/chrome";

type Stamp = { day: string; count: number };

const today = (): string => new Date().toISOString().slice(0, 10);
const keyFor = (kind: string): string => `sentToday:${kind}`;

export function useDailyCount(kind: string): { count: number; increment: () => void } {
  const [count, setCount] = useState(0);
  useEffect(() => {
    void storageGet<Stamp>(keyFor(kind)).then((s) => setCount(s?.day === today() ? s.count : 0));
  }, [kind]);
  const increment = () => {
    setCount((n) => {
      void storageSet({ [keyFor(kind)]: { day: today(), count: n + 1 } satisfies Stamp });
      return n + 1;
    });
  };
  return { count, increment };
}
