/**
 * My content: everything the person has made or tracked, one tab per kind.
 * The header carries the open tab's key actions; each tab renders it.
 */
import type { ComponentChildren, ComponentType } from "preact";
import { CONTENT_TAB, contentTabsFor, defaultContentTab } from "../../domain/content-tabs";
import { isTab, type ContentTab } from "../../domain/routes";
import { useLens } from "../../state/lens";
import { navStore, setTab } from "../../state/nav";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { Icon } from "../../ui/Icon";
import { ViewHeader } from "../../shell/ViewHeader";
import { CandidatesTab } from "../candidates/CandidatesTab";
import { JobsTab } from "../jobs/JobsTab";
import { LettersTab } from "../letters/LettersTab";
import { ResumesTab } from "../resumes/ResumesTab";
import { VideosTab } from "../videos/VideosTab";
import type { ContentTabProps } from "./tab";

const SCREEN: Record<ContentTab, ComponentType<ContentTabProps>> = {
  resumes: ResumesTab,
  letters: LettersTab,
  videos: VideosTab,
  jobs: JobsTab,
  candidates: CandidatesTab,
};

function Tabs({ tabs, current }: { tabs: readonly ContentTab[]; current: ContentTab }) {
  return (
    <div class="content-tabs" role="tablist" aria-label={t("content_title")}>
      {tabs.map((id) => (
        <button key={id} type="button" role="tab" aria-selected={id === current} class={id === current ? "on" : ""} onClick={() => setTab(id)}>
          <Icon name={CONTENT_TAB[id].icon} size={14} />
          {t(CONTENT_TAB[id].labelKey)}
        </button>
      ))}
    </div>
  );
}

export function ContentView() {
  const lens = useLens();
  const navTab = useStore(navStore, (s) => s.tab);
  const tabs = contentTabsFor(lens.id);
  const current = isTab(tabs, navTab) ? navTab : defaultContentTab(lens.id);
  const Screen = SCREEN[current];
  const header = (actions: ComponentChildren) => (
    <ViewHeader title={t("content_title")} actions={actions} below={<Tabs tabs={tabs} current={current} />} />
  );
  return <Screen key={current} header={header} />;
}
