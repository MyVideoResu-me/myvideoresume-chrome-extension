/** Header for a flow screen: back, title, what it's for, and the stepper. */
import type { ComponentChildren } from "preact";
import { goBack, navStore } from "../state/nav";
import { useStore } from "../state/store";
import { t } from "../platform/i18n";
import { Icon } from "../ui/Icon";
import { Stepper } from "./Stepper";

export function ViewHeader({ title, subtitle }: { title: string; subtitle?: ComponentChildren }) {
  const route = useStore(navStore, (s) => s.route);
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
      </div>
      <Stepper route={route} />
    </div>
  );
}
