/** Logo (home), lens switcher and account — on home and every screen opened from the page. */
import { navigate } from "../state/nav";
import { t } from "../platform/i18n";
import { AccountMenu } from "./AccountMenu";
import { LensMenu } from "./LensMenu";

export function AppHeader() {
  return (
    <header class="app-header">
      <button type="button" class="brand-home" aria-label={t("header_home")} onClick={() => navigate("home")}>
        <span class="logo" aria-hidden="true">
          h
        </span>
        <span class="brand">hired.video</span>
      </button>
      <LensMenu />
      <AccountMenu />
    </header>
  );
}
