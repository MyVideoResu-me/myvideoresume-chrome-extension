/**
 * My content › Cover letters: every letter saved with a job (on the
 * version tailored to it). The selected one shows its text with its
 * actions; each row has the same actions.
 */
import { useEffect, useState } from "preact/hooks";
import { listLetters, type LetterItem } from "../../domain/letters";
import { loadResumes, resumesStore } from "../../state/resumes";
import { navigate } from "../../state/nav";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";
import { shortDate, t } from "../../platform/i18n";
import { studioResumeUrl, webResumesUrl } from "../../platform/web-links";
import { Button, Eyebrow, Spinner } from "../../ui/controls";
import { BarAction, EmptyState, IconAction, ItemList, ItemRow, SelectedItem } from "../../ui/items";
import { ListSearch } from "../../ui/ListSearch";
import { useCopy } from "../../ui/useCopy";
import type { ContentTabProps } from "../content/tab";
import { savedLetterText } from "./letter-text";

const meta = (l: LetterItem) => [l.organization, shortDate(l.resume.updatedAt)].filter(Boolean).join(" · ");

function SelectedLetter({ letter, copied, onCopy }: { letter: LetterItem; copied: boolean; onCopy: () => void }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void savedLetterText(letter.resume.id).then((v) => live && setText(v), () => live && setText(""));
    return () => {
      live = false;
    };
  }, [letter.resume.id]);

  return (
    <SelectedItem
      eyebrow={t("letters_selected")}
      icon="message"
      tone="doc"
      title={letter.jobTitle}
      meta={meta(letter)}
      actions={
        <>
          <BarAction icon={copied ? "check" : "clipboard"} onClick={onCopy} label={copied ? t("common_copied") : t("common_copy")} />
          <BarAction icon="pen" onClick={() => openTab(studioResumeUrl(letter.resume.id))} label={t("action_edit")} />
        </>
      }
    >
      {text === null ? <Spinner label={t("common_loading")} /> : text ? <pre class="letter-preview">{text}</pre> : null}
    </SelectedItem>
  );
}

export function LettersTab({ header }: ContentTabProps) {
  const { list, loaded } = useStore(resumesStore, (s) => s);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { copy, copiedKey } = useCopy();
  useEffect(() => {
    void loadResumes().catch(() => undefined);
  }, []);

  const all = listLetters(list);
  const shown = listLetters(list, query);
  const selected = all.find((l) => l.resume.id === selectedId) ?? all[0] ?? null;
  const copyLetter = (id: string) => void copy(id, savedLetterText(id));

  return (
    <>
      {header(
        <>
          <IconAction icon="pen" primary label={t("letters_write")} onClick={() => navigate("coverLetter")} />
          <IconAction icon="external" label={t("resumes_openSite")} onClick={() => openTab(webResumesUrl())} />
        </>,
      )}
      <div class="view-body">
        {!loaded ? <Spinner label={t("common_loading")} /> : null}
        {loaded && !all.length ? (
          <EmptyState hint={t("letters_empty")}>
            <Button variant="primary" icon="pen" onClick={() => navigate("coverLetter")}>
              {t("letters_write")}
            </Button>
          </EmptyState>
        ) : null}
        {selected ? (
          <SelectedLetter
            key={selected.resume.id}
            letter={selected}
            copied={copiedKey === selected.resume.id}
            onCopy={() => copyLetter(selected.resume.id)}
          />
        ) : null}
        {all.length ? (
          <section class="stack-sm">
            <Eyebrow>{t("letters_all", { count: all.length })}</Eyebrow>
            <ListSearch id="letter-search" count={all.length} value={query} onInput={setQuery} />
            {!shown.length ? <p class="muted small">{t("content_noMatch")}</p> : null}
            <ItemList label={t("content_tab_letters")}>
              {shown.map((l) => (
                <ItemRow
                  key={l.resume.id}
                  icon="message"
                  tone="doc"
                  title={l.jobTitle}
                  meta={meta(l)}
                  selected={l.resume.id === selected?.resume.id}
                  selectLabel={t("content_show")}
                  onSelect={() => setSelectedId(l.resume.id)}
                  actions={
                    <>
                      <IconAction
                        icon={copiedKey === l.resume.id ? "check" : "clipboard"}
                        label={copiedKey === l.resume.id ? t("common_copied") : t("common_copy")}
                        onClick={() => copyLetter(l.resume.id)}
                      />
                      <IconAction icon="pen" label={t("action_edit")} onClick={() => openTab(studioResumeUrl(l.resume.id))} />
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
