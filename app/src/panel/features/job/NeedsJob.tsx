/**
 * Shown by a job flow when there is no job to work on (the page shows no
 * posting and none is paired). Renders nothing otherwise.
 */
import { t } from "../../platform/i18n";
import { Card } from "../../ui/controls";
import { useJobContext } from "./useTrackedJob";

export function NeedsJob() {
  const { detected, job } = useJobContext();
  if (detected || job) return null;
  return (
    <Card>
      <div class="strong">{t("job_needOne")}</div>
      <p class="muted small">{t("job_needOne_hint")}</p>
    </Card>
  );
}
