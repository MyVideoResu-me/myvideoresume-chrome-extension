/**
 * Target this job: one screen, three tabs — the résumé that goes with it,
 * the cover letter, and the application form. Each tab is its own
 * feature (resumes / cover / apply); this screen only switches between them.
 */
import type { ComponentChildren, ComponentType } from "preact";
import { TARGET_TABS, isTab, type TargetTab } from "../../domain/routes";
import { navStore, setTab } from "../../state/nav";
import { useStore } from "../../state/store";
import { t, type MessageKey } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Segmented } from "../../ui/controls";
import { ApplyTab } from "../apply/ApplyTab";
import { CoverLetterTab } from "../cover/CoverLetterTab";
import { NeedsResume } from "../resumes/NeedsResume";
import { ResumeTab } from "../resumes/ResumeTab";
import { NeedsJob } from "./NeedsJob";
import { useJobContext } from "./useTrackedJob";
import { useWorkingResume } from "./useWorkingResume";

const TAB: Record<TargetTab, { labelKey: MessageKey; Body: ComponentType<{ tabs: ComponentChildren }> }> = {
  resume: { labelKey: "target_tabResume", Body: ResumeTab },
  cover: { labelKey: "cover_title", Body: CoverLetterTab },
  apply: { labelKey: "apply_title", Body: ApplyTab },
};

const DEFAULT_TAB: TargetTab = "cover";

export function TargetView() {
  const { job } = useJobContext();
  const resume = useWorkingResume(job?.id ?? null);
  const navTab = useStore(navStore, (s) => s.tab);
  const tab = isTab(TARGET_TABS, navTab) ? navTab : DEFAULT_TAB;
  const { Body } = TAB[tab];

  return (
    <>
      <ViewHeader title={t("target_title")} subtitle={resume ? t("apply_usesResume", { resume: resume.title }) : undefined} />
      <Body
        tabs={
          <>
            <NeedsResume />
            <NeedsJob />
            <Segmented
              label={t("target_title")}
              value={tab}
              options={TARGET_TABS.map((id) => ({ value: id, label: t(TAB[id].labelKey) }))}
              onChange={setTab}
            />
          </>
        }
      />
    </>
  );
}
