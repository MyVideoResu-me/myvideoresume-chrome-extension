/** Avatar menu: the account's list screens (data below), open hired.video, sign out. */
import { signOut, sessionStore } from "../state/session";
import { navigate } from "../state/nav";
import { useStore } from "../state/store";
import { openTab } from "../platform/chrome";
import { webUrl } from "../platform/config";
import { t } from "../platform/i18n";
import type { RouteName } from "../domain/routes";
import type { MessageKey } from "../platform/i18n";
import { Icon, type IconName } from "../ui/Icon";
import { usePopover } from "../ui/usePopover";

const MENU: ReadonlyArray<{ route: RouteName; icon: IconName; labelKey: MessageKey }> = [
  { route: "pipeline", icon: "list", labelKey: "menu_pipeline" },
  { route: "analytics", icon: "chart", labelKey: "menu_analytics" },
  { route: "resumes", icon: "file", labelKey: "menu_resumes" },
  { route: "settings", icon: "settings", labelKey: "menu_settings" },
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function AccountMenu() {
  const session = useStore(sessionStore, (s) => s.session);
  const { open, rootRef, toggle, close } = usePopover();

  if (session.status !== "signedIn") return null;
  const { me, isPro } = session;
  const go = (route: RouteName) => {
    navigate(route);
    close();
  };

  return (
    <div class="account" ref={rootRef}>
      <button
        type="button"
        class="avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("account_menu")}
        onClick={toggle}
      >
        {initials(me.name || me.email)}
      </button>
      {open ? (
        <div class="account-menu" role="menu">
          <div class="account-who">
            <b>{me.name || me.email}</b>
            <small>{isPro ? t("account_pro") : t("account_free")}</small>
          </div>
          {MENU.map((item) => (
            <button key={item.route} type="button" role="menuitem" class="menu-item" onClick={() => go(item.route)}>
              <Icon name={item.icon} />
              {t(item.labelKey)}
            </button>
          ))}
          <button type="button" role="menuitem" class="menu-item" onClick={() => openTab(webUrl("/"))}>
            <Icon name="external" />
            {t("menu_openSite")}
          </button>
          <button type="button" role="menuitem" class="menu-item" onClick={() => void signOut()}>
            <Icon name="signOut" />
            {t("menu_signOut")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
