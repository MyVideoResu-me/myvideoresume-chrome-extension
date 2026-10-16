/** Avatar menu: pipeline, résumés, in-page pill setting, open hired.video, sign out. */
import { signOut, sessionStore } from "../state/session";
import { navigate } from "../state/nav";
import { useStore } from "../state/store";
import { openTab } from "../platform/chrome";
import { webUrl } from "../platform/config";
import { t } from "../platform/i18n";
import { Icon } from "../ui/Icon";
import { usePopover } from "../ui/usePopover";
import { PillSetting } from "../features/settings/PillSetting";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function AccountMenu() {
  const session = useStore(sessionStore, (s) => s.session);
  const { open, rootRef, toggle, close } = usePopover();

  if (session.status !== "signedIn") return null;
  const { me, isPro } = session;
  const go = (route: "pipeline" | "resumes") => {
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
          <button type="button" role="menuitem" class="menu-item" onClick={() => go("pipeline")}>
            <Icon name="list" />
            {t("menu_pipeline")}
          </button>
          <button type="button" role="menuitem" class="menu-item" onClick={() => go("resumes")}>
            <Icon name="file" />
            {t("menu_resumes")}
          </button>
          <PillSetting />
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
