/**
 * Shown by any flow that needs "my" résumé when the person has none yet.
 * Renders nothing once a résumé exists.
 */
import { useEffect } from "preact/hooks";
import { navigate } from "../../state/nav";
import { loadResumes, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { Button, Card } from "../../ui/controls";

export function NeedsResume() {
  const { loaded, list } = useStore(resumesStore, (s) => s);
  useEffect(() => {
    void loadResumes().catch(() => undefined);
  }, []);
  if (!loaded || list.length) return null;
  return (
    <Card>
      <div class="strong">{t("resumes_none")}</div>
      <p class="muted small">{t("resumes_none_hint")}</p>
      <Button variant="primary" icon="upload" onClick={() => navigate("resumes")}>
        {t("resumes_add")}
      </Button>
    </Card>
  );
}
