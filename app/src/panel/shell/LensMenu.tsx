/**
 * The lens switcher in the header. Shows only the lenses this account may
 * use; hides itself when there is just one to pick.
 */
import { availableLenses } from "../domain/lenses";
import { chooseLens, useLens } from "../state/lens";
import { useRole } from "../state/session";
import { t } from "../platform/i18n";
import { Icon } from "../ui/Icon";
import { usePopover } from "../ui/usePopover";

export function LensMenu() {
  const lens = useLens();
  const lenses = availableLenses(useRole());
  const { open, rootRef, toggle, close } = usePopover();

  if (lenses.length < 2) return null;

  return (
    <div class="lens" ref={rootRef}>
      <button
        type="button"
        class={`lens-btn ${open ? "open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("lens_switch")}
        onClick={toggle}
      >
        {t(lens.labelKey)}
        <Icon name="chevronDown" size={14} />
      </button>
      {open ? (
        <div class="lens-menu" role="menu" aria-label={t("lens_switch")}>
          {lenses.map((l) => (
            <button
              type="button"
              key={l.id}
              role="menuitemradio"
              aria-checked={l.id === lens.id}
              class={`lens-opt ${l.id === lens.id ? "on" : ""}`}
              onClick={() => {
                void chooseLens(l.id);
                close();
              }}
            >
              <span class="lens-opt-icon">
                <Icon name={l.icon} />
              </span>
              <span>
                <b>{t(l.labelKey)}</b>
                <small>{t(l.descKey)}</small>
              </span>
            </button>
          ))}
          <div class="lens-foot">{t("lens_footnote")}</div>
        </div>
      ) : null}
    </div>
  );
}
