/** "Make something with this …" — the lens's actions for what's on the page. */
import { ACTIONS, actionCopy, type ActionId } from "../../domain/actions";
import { navigate } from "../../state/nav";
import { useIsOwnProfile } from "../../state/own-profile";
import { pageStore } from "../../state/page";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { Icon } from "../../ui/Icon";

export function ActionGrid({ actions }: { actions: readonly ActionId[] }) {
  const entity = useStore(pageStore, (s) => s.entity);
  const ownProfile = useIsOwnProfile(entity);
  if (!actions.length) return null;
  return (
    <div class="action-grid">
      {actions.map((id) => {
        const a = ACTIONS[id];
        const copy = actionCopy(id, { ownProfile });
        return (
          <button type="button" key={id} class={`action action-${a.tone}`} onClick={() => navigate(a.route)}>
            <Icon name={a.icon} />
            <b>{t(copy.labelKey)}</b>
            <small>{t(copy.hintKey)}</small>
          </button>
        );
      })}
    </div>
  );
}
