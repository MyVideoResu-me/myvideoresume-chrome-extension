/** Create → Strengthen → Target → Promote, driven by the route registry. */
import { ROUTE_STEP, STEPS, STEP_LABEL, type ScreenName } from "../domain/routes";
import { t } from "../platform/i18n";

export function Stepper({ route }: { route: ScreenName }) {
  const { step, skips = [] } = ROUTE_STEP[route];
  if (!step) return null;
  const current = STEPS.indexOf(step);
  return (
    <ol class="steps" aria-label={t("steps_label")}>
      {STEPS.map((s, i) => {
        const state = skips.includes(s) ? "skip" : i < current ? "done" : i === current ? "on" : "todo";
        return (
          <li key={s} class={`step step-${state}`} aria-current={state === "on" ? "step" : undefined}>
            {t(STEP_LABEL[s])}
          </li>
        );
      })}
    </ol>
  );
}
