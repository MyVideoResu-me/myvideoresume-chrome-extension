/**
 * Header for a flow screen. Screens opened from the page (ROUTE_STEP
 * `appHeader`) show the app header above the stepper; the rest show
 * back, title, what it's for and the account menu.
 */
import type { ComponentChildren } from "preact";
import { ROUTE_STEP } from "../domain/routes";
import { goBack, navStore } from "../state/nav";
import { useStore } from "../state/store";
import { t } from "../platform/i18n";
import { Icon } from "../ui/Icon";
import { AccountMenu } from "./AccountMenu";
import { AppHeader } from "./AppHeader";
import { Stepper } from "./Stepper";

export function ViewHeader({ title, subtitle }: { title: string; subtitle?: ComponentChildren }) {
  const route = useStore(navStore, (s) => s.route);
  if (ROUTE_STEP[route].appHeader) {
    return (
      <>
        <AppHeader />
        <div class="view-header view-header-steps">
          <h1 class="visually-hidden">{title}</h1>
          <Stepper route={route} />
        </div>
      </>
    );
  }
  return (
    <div class="view-header">
      <div class="view-header-row">
        <button type="button" class="icon-btn" aria-label={t("common_back")} onClick={goBack}>
          <Icon name="back" />
        </button>
        <div class="view-header-text">
          <h1 class="view-title">{title}</h1>
          {subtitle ? <div class="view-subtitle">{subtitle}</div> : null}
        </div>
        <AccountMenu />
      </div>
      <Stepper route={route} />
    </div>
  );
}
