/** Home: what's on this page, and what this lens can make with it. */
import type { PageKind } from "../../domain/entities";
import { useLens } from "../../state/lens";
import { pageStore } from "../../state/page";
import { useStore } from "../../state/store";
import { t, type MessageKey } from "../../platform/i18n";
import { Eyebrow, Spinner } from "../../ui/controls";
import { NeedsResume } from "../resumes/NeedsResume";
import { ActionGrid } from "./ActionGrid";
import { DetectedCard } from "./DetectedCard";

const MAKE_HEADING: Record<PageKind, MessageKey> = {
  job: "home_makeWithJob",
  profile: "home_makeWithProfile",
  post: "home_makeWithPost",
  none: "home_makeWithResume",
};

export function HomeView() {
  const lens = useLens();
  const { entity, scanning } = useStore(pageStore, (s) => s);
  const kind: PageKind = entity?.kind ?? "none";
  const actions = lens.actions[kind];

  return (
    <div class="view-body">
      {lens.pairing === "pageAndMe" ? <NeedsResume /> : null}
      <Eyebrow>{t("home_onThisPage")}</Eyebrow>
      {scanning ? <Spinner label={t("home_scanning")} /> : <DetectedCard entity={entity} />}
      {actions.length ? (
        <>
          <Eyebrow>{t(MAKE_HEADING[kind])}</Eyebrow>
          <ActionGrid actions={actions} />
        </>
      ) : null}
    </div>
  );
}
