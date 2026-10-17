/**
 * Lens switcher and account — on home and every screen opened from the page.
 * No logo or name here: Chrome's side-panel title bar already shows the
 * extension's icon and name. Off home, a back-to-home button leads the row.
 */
import { navigate, navStore } from "../state/nav";
import { useStore } from "../state/store";
import { t } from "../platform/i18n";
import { Icon } from "../ui/Icon";
import { AccountMenu } from "./AccountMenu";
import { LensMenu } from "./LensMenu";

export function AppHeader() {
  const onHome = useStore(navStore, (s) => s.route === "home");
  return (
    <header class="app-header">
      {onHome ? null : (
        <button type="button" class="icon-btn" aria-label={t("header_home")} onClick={() => navigate("home")}>
          <Icon name="back" />
        </button>
      )}
      <span class="app-header-fill" aria-hidden="true" />
      <LensMenu />
      <AccountMenu />
    </header>
  );
}
