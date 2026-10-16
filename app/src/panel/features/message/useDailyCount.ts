/**
 * How many messages of one kind the person handed over today (local to this
 * browser), against an optional daily cap. At the cap, `reached` is true and
 * the composer refuses to hand over another one.
 */
import { useEffect, useState } from "preact/hooks";
import { storageGet, storageSet } from "../../platform/chrome";

type Stamp = { day: string; count: number };

/** The local calendar day (YYYY-MM-DD) — the cap resets at the person's midnight, not UTC's. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const keyFor = (kind: string): string => `sentToday:${kind}`;

export function useDailyCount(
  kind: string,
  cap?: number,
): { count: number; cap: number | null; reached: boolean; increment: () => void } {
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
  return { count, cap: cap ?? null, reached: cap != null && count >= cap, increment };
}
