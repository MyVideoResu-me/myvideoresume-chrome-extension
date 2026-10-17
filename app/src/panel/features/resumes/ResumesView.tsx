/**
 * "Me": the résumé the panel works with. Top to bottom: add or edit
 * (always in reach), the résumé in use with its actions, then every résumé
 * as a compact, searchable list.
 */
import { useEffect, useRef } from "preact/hooks";
import { activeResume, chooseResume, loadResumes, resumesStore, uploadResume } from "../../state/resumes";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";
import { webResumesUrl } from "../../platform/web-links";
import { t } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";
import { ActiveResumeCard } from "./ActiveResumeCard";
import { ResumeList } from "./ResumeList";

const ACCEPT = ".pdf,.doc,.docx,.txt,.rtf,.json";

export function ResumesView() {
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
      <ViewHeader title={t("resumes_title")} subtitle={t("resumes_subtitle")} />
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
        <div class="row resume-toolbar">
          <Button size="sm" variant="primary" icon="upload" busy={upload.busy} onClick={() => fileRef.current?.click()}>
            {t("resumes_add")}
          </Button>
          <Button size="sm" icon="external" onClick={() => openTab(webResumesUrl())}>
            {t("resumes_openSite")}
          </Button>
        </div>
        <ErrorNotice error={upload.error} />

        {!state.loaded ? <Spinner label={t("common_loading")} /> : null}
        {state.loaded && !state.list.length ? <p class="muted small">{t("resumes_none_hint")}</p> : null}

        {active ? <ActiveResumeCard resume={active} /> : null}

        {state.list.length ? <ResumeList list={state.list} activeId={state.activeId} onPick={(id) => void choose.run(id)} /> : null}
        <ErrorNotice error={choose.error} />
      </div>
    </>
  );
}
