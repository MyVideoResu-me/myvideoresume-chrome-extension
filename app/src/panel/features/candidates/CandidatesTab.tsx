/**
 * My content › Candidates (recruiter lens): the talent pool. The selected
 * candidate shows their contact actions; each row has the same actions.
 */
import { useEffect, useState } from "preact/hooks";
import type { PoolCandidate } from "../../api/recruiter";
import { matchesQuery } from "../../domain/search";
import { candidates } from "../../state/candidates";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { webCandidateUrl, webTalentPoolUrl } from "../../platform/web-links";
import { Button, Eyebrow, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { EmptyState, IconAction, ItemList, ItemRow, SelectedItem } from "../../ui/items";
import { ListSearch } from "../../ui/ListSearch";
import { useCopy } from "../../ui/useCopy";
import type { ContentTabProps } from "../content/tab";

const meta = (c: PoolCandidate) => [c.title, c.company].filter(Boolean).join(" · ");
const mailto = (email: string) => `mailto:${email}`;

export function CandidatesTab({ header }: ContentTabProps) {
  const { items, loaded, loading, error } = useStore(candidates.store, (s) => s);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { copy, copiedKey } = useCopy();
  useEffect(() => {
    void candidates.load();
  }, []);

  const shown = items.filter((c) => matchesQuery(query, c.name, c.title, c.company, c.email));
  const selected = items.find((c) => c.id === selectedId) ?? items[0] ?? null;

  return (
    <>
      {header(
        <>
          <IconAction icon="refresh" label={t("common_refresh")} busy={loading} onClick={() => void candidates.load(true)} />
          <IconAction icon="external" label={t("candidates_openSite")} onClick={() => openTab(webTalentPoolUrl())} />
        </>,
      )}
      <div class="view-body">
        <ErrorNotice error={error} />
        {!loaded ? <Spinner label={t("common_loading")} /> : null}
        {loaded && !error && !items.length ? <EmptyState hint={t("candidates_empty")} /> : null}
        {selected ? (
          <SelectedItem
            key={selected.id}
            eyebrow={t("content_selected")}
            icon="user"
            tone="person"
            title={selected.name}
            meta={[meta(selected), selected.email].filter(Boolean).join(" · ")}
            actions={
              <>
                <Button size="sm" icon="send" disabled={!selected.email} onClick={() => selected.email && openTab(mailto(selected.email))}>
                  {t("candidates_email")}
                </Button>
                <Button
                  size="sm"
                  icon={copiedKey === selected.id ? "check" : "clipboard"}
                  disabled={!selected.email}
                  onClick={() => selected.email && void copy(selected.id, selected.email)}
                >
                  {copiedKey === selected.id ? t("common_copied") : t("candidates_copyEmail")}
                </Button>
                <Button size="sm" icon="user" onClick={() => openTab(webCandidateUrl(selected.id))}>
                  {t("candidates_profile")}
                </Button>
              </>
            }
          />
        ) : null}
        {items.length ? (
          <section class="stack-sm">
            <Eyebrow>{t("candidates_all", { count: items.length })}</Eyebrow>
            <ListSearch id="candidate-search" count={items.length} value={query} onInput={setQuery} />
            {!shown.length ? <p class="muted small">{t("content_noMatch")}</p> : null}
            <ItemList label={t("content_tab_candidates")}>
              {shown.map((c) => (
                <ItemRow
                  key={c.id}
                  icon="user"
                  tone="person"
                  title={c.name}
                  meta={meta(c)}
                  selected={c.id === selected?.id}
                  selectLabel={t("content_show")}
                  onSelect={() => setSelectedId(c.id)}
                  actions={
                    <>
                      <IconAction
                        icon="send"
                        label={t("candidates_email")}
                        disabled={!c.email}
                        onClick={() => c.email && openTab(mailto(c.email))}
                      />
                      <IconAction icon="user" label={t("candidates_profile")} onClick={() => openTab(webCandidateUrl(c.id))} />
                    </>
                  }
                />
              ))}
            </ItemList>
          </section>
        ) : null}
      </div>
    </>
  );
}
