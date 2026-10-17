/**
 * Every résumé as rows: masters newest first, each with its versions folded
 * under a "Versions (N)" toggle; a search box once the list is long.
 * Picking a row makes it the panel's résumé; each row has its own actions.
 */
import { useState } from "preact/hooks";
import type { ResumeSummary } from "../../api/resumes";
import { groupResumes } from "../../domain/resume-groups";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioResumeUrl } from "../../platform/web-links";
import { Eyebrow } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { IconAction, ItemList, ItemRow } from "../../ui/items";
import { ListSearch } from "../../ui/ListSearch";
import { useKeyedAction } from "../../ui/useAction";
import { resumeMeta } from "./SelectedResume";
import { downloadResume, useDownloadFormat } from "./useDownload";

export function ResumeList({
  list,
  activeId,
  onPick,
}: {
  list: readonly ResumeSummary[];
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const format = useDownloadFormat();
  const download = useKeyedAction((id: string, title: string) => downloadResume(id, title, format));
  const groups = groupResumes(list, query);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const row = (r: ResumeSummary) => (
    <ItemRow
      key={r.id}
      icon={r.isMaster ? "file" : "pen"}
      tone="doc"
      title={r.title}
      meta={resumeMeta(r)}
      nested={!r.isMaster}
      selected={r.id === activeId}
      selectLabel={t("resumes_use")}
      onSelect={() => onPick(r.id)}
      actions={
        <>
          <IconAction
            icon="download"
            label={t("resumes_download", { format: format.toUpperCase() })}
            busy={download.busyKey === r.id}
            onClick={() => void download.run(r.id, r.title)}
          />
          <IconAction icon="pen" label={t("action_edit")} onClick={() => openTab(studioResumeUrl(r.id))} />
        </>
      }
    />
  );

  return (
    <section class="stack-sm">
      <Eyebrow>{t("resumes_all", { count: list.length })}</Eyebrow>
      <ListSearch id="resume-search" count={list.length} value={query} onInput={setQuery} />
      <ErrorNotice error={download.error} />
      {!groups.length ? <p class="muted small">{t("content_noMatch")}</p> : null}
      <ItemList label={t("resumes_title")}>
        {groups.map(({ master, versions, matchedVersion }) => {
          // The active version's group stays open so the selection is visible.
          const expanded = open.has(master.id) || matchedVersion || versions.some((v) => v.id === activeId);
          return (
            <div key={master.id} class="item-group" role="presentation">
              {row(master)}
              {versions.length ? (
                <button type="button" class="item-versions-toggle" aria-expanded={expanded} onClick={() => toggle(master.id)}>
                  <Icon name={expanded ? "chevronUp" : "chevronDown"} size={12} />
                  {t("resumes_versions", { count: versions.length })}
                </button>
              ) : null}
              {expanded ? versions.map(row) : null}
            </div>
          );
        })}
      </ItemList>
    </section>
  );
}
