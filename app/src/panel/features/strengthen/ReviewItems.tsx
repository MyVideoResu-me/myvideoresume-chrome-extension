/** One AI change (keep / turn off) and one job requirement the résumé doesn't show. */
import type { JobGap, TailorChange } from "@shared/resume-tailor";
import { t } from "../../platform/i18n";
import { Button, Toggle } from "../../ui/controls";

/**
 * `fixed`: the change can't be undone on its own, so it is always applied
 * and its switch is locked on (never a switch that says "off" and saves it anyway).
 */
export function ChangeItem({
  change,
  label,
  kept,
  fixed,
  onToggle,
}: {
  change: TailorChange;
  label: string;
  kept: boolean;
  fixed: boolean;
  onToggle: () => void;
}) {
  return (
    <div class={`review-item ${kept ? "on" : ""}`}>
      <div class="row">
        <span class="tag tag-primary">{change.before ? t("strengthen_kindRewrite") : t("strengthen_kindAdded")}</span>
        <span class="strong small grow">{label}</span>
        {fixed ? <span class="muted small">{t("strengthen_alwaysApplied")}</span> : null}
        <Toggle checked={kept} disabled={fixed} label={t("strengthen_keepChange")} onChange={onToggle} />
      </div>
      {change.before ? <div class="diff-del">{change.before}</div> : null}
      <div class="diff-add">{change.after}</div>
      {change.why ? <div class="muted small">{change.why}</div> : null}
    </div>
  );
}

export function GapItem({ gap, onAnswer }: { gap: JobGap; onAnswer: (has: boolean) => void }) {
  return (
    <div class="review-item on">
      <div class="row">
        <span class="tag tag-warn">{t("strengthen_gap")}</span>
        <span class="strong small grow">{gap.skill || gap.requirement}</span>
        <span class="muted small">{t("strengthen_requiredInJd")}</span>
      </div>
      <div class="small text-3">{gap.question}</div>
      {gap.kind === "skill" && gap.skill ? (
        <div class="row">
          <Button size="sm" variant="primary" onClick={() => onAnswer(true)}>
            {t("strengthen_gapYes")}
          </Button>
          <Button size="sm" onClick={() => onAnswer(false)}>
            {t("strengthen_gapNo")}
          </Button>
        </div>
      ) : (
        <div class="row">
          <span class="muted small">{t("strengthen_gapExperience")}</span>
          <Button size="sm" onClick={() => onAnswer(false)}>
            {t("common_dismiss")}
          </Button>
        </div>
      )}
    </div>
  );
}
