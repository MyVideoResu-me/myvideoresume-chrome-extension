/** The job's keywords: the ones the tailored résumé shows, and the ones it still lacks. */
import type { JobGap } from "@shared/resume-tailor";
import { t } from "../../platform/i18n";
import { Card, Chip } from "../../ui/controls";

export function KeywordsTab({ matched, gaps }: { matched: readonly string[]; gaps: readonly JobGap[] }) {
  const missing = [...new Set(gaps.map((g) => g.skill || g.requirement).filter(Boolean))];
  return (
    <Card>
      <div class="strong">{t("strengthen_keywordsPresent", { count: matched.length })}</div>
      {matched.length ? (
        <div class="row wrap gap-6">
          {matched.map((k) => (
            <Chip key={k} tone="ok">
              {k}
            </Chip>
          ))}
        </div>
      ) : (
        <p class="muted small">{t("strengthen_keywordsNone")}</p>
      )}
      <div class="strong">{t("strengthen_keywordsMissing", { count: missing.length })}</div>
      {missing.length ? (
        <div class="row wrap gap-6">
          {missing.map((k) => (
            <Chip key={k} tone="warn">
              {k}
            </Chip>
          ))}
        </div>
      ) : (
        <p class="muted small">{t("strengthen_keywordsAllPresent")}</p>
      )}
    </Card>
  );
}
