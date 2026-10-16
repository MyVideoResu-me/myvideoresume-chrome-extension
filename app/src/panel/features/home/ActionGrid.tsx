/** "Make something with this …" — the lens's actions for what's on the page. */
import { ACTIONS, type ActionId } from "../../domain/actions";
import { navigate } from "../../state/nav";
import { t } from "../../platform/i18n";
import { Icon } from "../../ui/Icon";

export function ActionGrid({ actions }: { actions: readonly ActionId[] }) {
  if (!actions.length) return null;
  return (
    <div class="action-grid">
      {actions.map((id) => {
        const a = ACTIONS[id];
        return (
          <button type="button" key={id} class={`action action-${a.tone}`} onClick={() => navigate(a.route)}>
            <Icon name={a.icon} />
            <b>{t(a.labelKey)}</b>
            <small>{t(a.hintKey)}</small>
          </button>
        );
      })}
    </div>
  );
}
