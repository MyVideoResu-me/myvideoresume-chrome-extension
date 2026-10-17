/** Target › Cover letter: a letter for this job in the person's chosen tone, saved with the job. */
import type { ComponentChildren } from "preact";
import { useCopy } from "../../ui/useCopy";
import type { CoverLetterTone } from "@shared/cover-letter";
import { setTab } from "../../state/nav";
import { t, type MessageKey } from "../../platform/i18n";
import { Button, Card, ProBadge, Spinner, TextArea } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useJobContext } from "../job/useTrackedJob";
import { useWorkingResume } from "../job/useWorkingResume";
import { useCoverLetter } from "./useCoverLetter";

/** The tones offered, as the API names them (COVER_LETTER_TONES). */
const TONES: ReadonlyArray<{ tone: CoverLetterTone; labelKey: MessageKey }> = [
  { tone: "confident", labelKey: "tone_direct" },
  { tone: "warm", labelKey: "tone_warm" },
  { tone: "formal", labelKey: "tone_formal" },
];

export function CoverLetterTab({ tabs }: { tabs: ComponentChildren }) {
  const { detected, job, ensure } = useJobContext();
  const resume = useWorkingResume(job?.id ?? null);
  const letter = useCoverLetter(resume, ensure);
  const { copy, copiedKey } = useCopy();
  const copied = copiedKey === "letter";
  const ready = !!resume && !!(job || detected);

  return (
    <>
      <div class="view-body">
        {tabs}
        {ready && letter.draft ? (
          <>
            <div class="row wrap gap-6" role="group" aria-label={t("cover_tone")}>
              <span class="small text-3">{t("cover_tone")}</span>
              {TONES.map(({ tone, labelKey }) => (
                <button
                  type="button"
                  key={tone}
                  class={`chip-btn ${letter.tone === tone ? "on" : ""}`}
                  aria-pressed={letter.tone === tone}
                  disabled={letter.retone.busy}
                  onClick={() => void letter.retone.run(tone)}
                >
                  {t(labelKey)}
                </button>
              ))}
              <span class="push-right">
                <ProBadge />
              </span>
            </div>
            <TextArea id="cover-letter" label={t("cover_letter")} rows={12} value={letter.text} onInput={letter.edit} />
            <ErrorNotice error={letter.retone.error} />
            <div class="row">
              <Button size="sm" block busy={letter.write.busy} onClick={() => void letter.write.run()}>
                {t("cover_regenerate")}
              </Button>
              <Button size="sm" block icon={copied ? "check" : "clipboard"} onClick={() => void copy("letter", letter.text)}>
                {copied ? t("common_copied") : t("common_copy")}
              </Button>
              <Button
                size="sm"
                block
                icon={letter.isSaved ? "check" : "bookmark"}
                busy={letter.saveToJob.busy}
                disabled={!resume?.tailored || letter.isSaved}
                onClick={() => void letter.saveToJob.run()}
              >
                {letter.isSaved ? t("cover_savedToJob") : t("cover_saveToJob")}
              </Button>
            </div>
            {resume?.tailored ? null : <p class="muted small">{t("cover_saveNeedsVersion")}</p>}
            <ErrorNotice error={letter.saveToJob.error} />
          </>
        ) : ready ? (
          <Card>
            <div class="row between">
              <span class="strong">{t("cover_intro_title")}</span>
              <ProBadge />
            </div>
            <p class="muted small">{t("cover_intro")}</p>
            <Button variant="primary" block icon="pen" busy={letter.write.busy} onClick={() => void letter.write.run()}>
              {t("cover_write")}
            </Button>
            {letter.write.busy ? <Spinner label={t("cover_writing")} /> : null}
            <ErrorNotice error={letter.write.error} fallback="error_readPage" />
          </Card>
        ) : null}
      </div>
      {letter.draft ? (
        <footer class="view-footer">
          <Button variant="primary" block iconAfter="forward" onClick={() => setTab("apply")}>
            {t("cover_next")}
          </Button>
        </footer>
      ) : null}
    </>
  );
}
