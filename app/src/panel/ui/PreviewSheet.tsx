/** A read-only document over the screen (a draft before it is saved). Escape or ✕ closes it. */
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { t } from "../platform/i18n";
import { Icon } from "./Icon";

export function PreviewSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div class="sheet-backdrop" onClick={onClose}>
      <section class="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header class="sheet-head">
          <span class="strong grow">{title}</span>
          <button ref={closeRef} type="button" class="icon-btn" aria-label={t("common_close")} onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
        <div class="sheet-body">{children}</div>
      </section>
    </div>
  );
}
