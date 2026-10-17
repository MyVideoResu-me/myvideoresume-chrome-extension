/**
 * Every résumé as compact one-line rows: masters newest first, each with its
 * versions folded under a "N versions" toggle; a search box once the list is
 * long. Picking a row makes it the panel's résumé.
 */
import { useState } from "preact/hooks";
import type { ResumeSummary } from "../../api/resumes";
import { groupResumes } from "../../domain/resume-groups";
import { t, uiLocale } from "../../platform/i18n";
import { Eyebrow, TextField } from "../../ui/controls";
import { Icon } from "../../ui/Icon";

/** Search shows once the list is longer than this. */
const SEARCH_AFTER = 5;

function updated(r: ResumeSummary): string | null {
  if (!r.updatedAt) return null;
  const d = new Date(r.updatedAt);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(uiLocale(), { month: "short", day: "numeric", year: "numeric" });
}

function Row({ r, active, onPick }: { r: ResumeSummary; active: boolean; onPick: (id: string) => void }) {
  const date = updated(r);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      class={`resume-row ${active ? "on" : ""} ${r.isMaster ? "" : "resume-row-version"}`}
      onClick={() => onPick(r.id)}
    >
      <Icon name={r.isMaster ? "file" : "pen"} size={14} />
      <span class="resume-row-title">{r.title}</span>
      {date ? <span class="resume-row-meta">{date}</span> : null}
      {active ? <Icon name="check" size={14} label={t("resumes_usingNow")} /> : null}
    </button>
  );
}

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
  const groups = groupResumes(list, query);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section class="stack-sm">
      <Eyebrow>{t("resumes_all", { count: list.length })}</Eyebrow>
      {list.length > SEARCH_AFTER ? (
        <TextField id="resume-search" label={t("resumes_search")} value={query} onInput={setQuery} placeholder={t("resumes_searchHint")} />
      ) : null}
      {!groups.length ? <p class="muted small">{t("resumes_noMatch")}</p> : null}
      <div class="resume-list" role="radiogroup" aria-label={t("resumes_title")}>
        {groups.map(({ master, versions, matchedVersion }) => {
          // The active version's group stays open so the selection is visible.
          const expanded = open.has(master.id) || matchedVersion || versions.some((v) => v.id === activeId);
          return (
            <div key={master.id} class="resume-group">
              <Row r={master} active={master.id === activeId} onPick={onPick} />
              {versions.length ? (
                <button
                  type="button"
                  class="resume-versions-toggle"
                  aria-expanded={expanded}
                  onClick={() => toggle(master.id)}
                >
                  <Icon name={expanded ? "chevronUp" : "chevronDown"} size={12} />
                  {t("resumes_versions", { count: versions.length })}
                </button>
              ) : null}
              {expanded ? versions.map((v) => <Row key={v.id} r={v} active={v.id === activeId} onPick={onPick} />) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
