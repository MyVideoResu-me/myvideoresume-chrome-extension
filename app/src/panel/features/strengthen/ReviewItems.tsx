/** One AI change (keep / turn off) and one job requirement the résumé doesn't show. */
import type { JobGap, TailorChange } from "@shared/resume-tailor";
import { t } from "../../platform/i18n";
import { Button, Toggle } from "../../ui/controls";

export function ChangeItem({ change, kept, onToggle }: { change: TailorChange; kept: boolean; onToggle: () => void }) {
  return (
    <div class={`review-item ${kept ? "on" : ""}`}>
      <div class="row between">
        <span class="tag tag-primary">{t(`section_${change.section}` as const)}</span>
        <Toggle checked={kept} label={t("strengthen_keepChange")} onChange={onToggle} />
      </div>
      {change.before ? <div class="diff-del">{change.before}</div> : null}
      <div class="diff-add">{change.after}</div>
      {change.why ? <div class="muted small">{change.why}</div> : null}
    </div>
  );
}

export function GapItem({ gap, onAnswer }: { gap: JobGap; onAnswer: (has: boolean) => void }) {
  return (
    <div class="review-item">
      <div class="row between">
        <span class="tag tag-warn">{t("strengthen_gap")}</span>
        <span class="strong small">{gap.skill || gap.requirement}</span>
      </div>
      <div class="small">{gap.question}</div>
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
