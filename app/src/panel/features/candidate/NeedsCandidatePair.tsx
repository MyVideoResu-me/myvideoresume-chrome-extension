/** Shown by recruiter flows until a candidate AND a job are paired. */
import { navigate } from "../../state/nav";
import { pairStore } from "../../state/pair";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { Button, Card } from "../../ui/controls";

export function NeedsCandidatePair() {
  const ready = useStore(pairStore, (s) => !!s.candidate && !!s.job);
  if (ready) return null;
  return (
    <Card>
      <p class="small">{t("outreach_needPair")}</p>
      <Button size="sm" onClick={() => navigate("candidate")}>
        {t("action_candidate")}
      </Button>
    </Card>
  );
}
