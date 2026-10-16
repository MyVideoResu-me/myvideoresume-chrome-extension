/** "Me": pick the résumé the panel works with, add one, and check it. */
import { useEffect, useRef } from "preact/hooks";
import { activeResume, chooseResume, loadResumes, resumesStore, uploadResume } from "../../state/resumes";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";
import { webUrl } from "../../platform/config";
import { t } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { useAction } from "../../ui/useAction";
import { DownloadButton } from "./DownloadButton";
import { ResumeCheckCard } from "./ResumeCheckCard";

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
        {!state.loaded ? <Spinner label={t("common_loading")} /> : null}
        {state.loaded && !state.list.length ? <p class="muted small">{t("resumes_none_hint")}</p> : null}
        {state.list.length ? (
          <div class="stack-sm" role="radiogroup" aria-label={t("resumes_title")}>
            {state.list.map((r) => (
              <button
                type="button"
                key={r.id}
                role="radio"
                aria-checked={r.id === state.activeId}
                class={`job-opt ${r.id === state.activeId ? "on" : ""} ${r.isMaster ? "" : "indent"}`}
                onClick={() => void choose.run(r.id)}
              >
                <b>
                  <Icon name="file" size={14} /> {r.title}
                </b>
                <small>{r.isMaster ? t("resumes_master") : t("resumes_version")}</small>
              </button>
            ))}
          </div>
        ) : null}
        <ErrorNotice error={choose.error} />

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
        <div class="row">
          <Button icon="upload" busy={upload.busy} onClick={() => fileRef.current?.click()}>
            {t("resumes_add")}
          </Button>
          <Button icon="external" onClick={() => openTab(webUrl("/resumes"))}>
            {t("resumes_openSite")}
          </Button>
        </div>
        <ErrorNotice error={upload.error} />

        {active ? (
          <>
            <DownloadButton key={`dl-${active.id}`} resumeId={active.id} title={active.title} />
            <ResumeCheckCard key={active.id} resumeId={active.id} title={active.title} />
          </>
        ) : null}
      </div>
    </>
  );
}
