/** "Personalized from" — the facts the AI may use; each a toggle chip. */
import type { PersonalizeChip } from "../../domain/outreach";
import { t } from "../../platform/i18n";

export function PersonalizeChips({
  chips,
  on,
  onToggle,
}: {
  chips: readonly PersonalizeChip[];
  on: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  if (!chips.length) return null;
  return (
    <div class="stack-sm">
      <div class="muted small">{t("outreach_personalizedFrom")}</div>
      <div class="row wrap" role="group" aria-label={t("outreach_personalizedFrom")}>
        {chips.map((c) => (
          <button
            type="button"
            key={c.id}
            class={`chip-btn ${on.has(c.id) ? "on" : ""}`}
            aria-pressed={on.has(c.id)}
            onClick={() => onToggle(c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
