/** Open/close state for a menu that closes on outside click or Escape. */
import { useEffect, useRef, useState } from "preact/hooks";

export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, rootRef, toggle: () => setOpen((o) => !o), close: () => setOpen(false) };
}
