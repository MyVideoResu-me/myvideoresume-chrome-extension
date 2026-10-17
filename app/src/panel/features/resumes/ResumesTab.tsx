/**
 * My content › Résumés: upload or open on hired.video (header), the résumé
 * in use with its actions, then every résumé.
 */
import { useEffect, useRef } from "preact/hooks";
import { activeResume, chooseResume, loadResumes, resumesStore, uploadResume } from "../../state/resumes";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";
import { webResumesUrl } from "../../platform/web-links";
import { t } from "../../platform/i18n";
import { Button, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { EmptyState, IconAction } from "../../ui/items";
import { useAction } from "../../ui/useAction";
import type { ContentTabProps } from "../content/tab";
import { ResumeList } from "./ResumeList";
import { SelectedResume } from "./SelectedResume";

const ACCEPT = ".pdf,.doc,.docx,.txt,.rtf,.json";

export function ResumesTab({ header }: ContentTabProps) {
  const state = useStore(resumesStore, (s) => s);
  const active = activeResume(state);
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useAction(uploadResume);
  const choose = useAction(chooseResume);
  useEffect(() => {
    void loadResumes().catch(() => undefined);
  }, []);

  return (
    <>
      {header(
        <>
          <IconAction icon="upload" primary label={t("resumes_add")} busy={upload.busy} onClick={() => fileRef.current?.click()} />
          <IconAction icon="external" label={t("resumes_openSite")} onClick={() => openTab(webResumesUrl())} />
        </>,
      )}
      <div class="view-body">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          class="visually-hidden"
          aria-label={t("resumes_add")}
          onChange={(e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (file) void upload.run(file);
          }}
        />
        <ErrorNotice error={upload.error} />
        {!state.loaded ? <Spinner label={t("common_loading")} /> : null}
        {state.loaded && !state.list.length ? (
          <EmptyState hint={t("resumes_none_hint")}>
            <Button variant="primary" icon="upload" busy={upload.busy} onClick={() => fileRef.current?.click()}>
              {t("resumes_add")}
            </Button>
          </EmptyState>
        ) : null}
        {active ? <SelectedResume key={active.id} resume={active} /> : null}
        {state.list.length ? <ResumeList list={state.list} activeId={state.activeId} onPick={(id) => void choose.run(id)} /> : null}
        <ErrorNotice error={choose.error} />
      </div>
    </>
  );
}
