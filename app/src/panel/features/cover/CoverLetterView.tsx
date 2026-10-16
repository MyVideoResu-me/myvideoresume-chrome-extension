/** Target: a cover letter for this job, in the person's chosen tone. */
import { COVER_LETTER_TONES, type CoverLetterTone } from "@shared/cover-letter";
import { useState } from "preact/hooks";
import { navigate } from "../../state/nav";
import { sessionStore } from "../../state/session";
import { useStore } from "../../state/store";
import { copyText } from "../../platform/chrome";
import { t, type MessageKey } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card, Chip, Spinner, TextArea } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { NeedsJob } from "../job/NeedsJob";
import { useJobContext } from "../job/useTrackedJob";
import { useWorkingResume } from "../job/useWorkingResume";
import { NeedsResume } from "../resumes/NeedsResume";
import { useCoverLetter } from "./useCoverLetter";

const TONE_LABEL: Record<CoverLetterTone, MessageKey> = {
  warm: "tone_warm",
  confident: "tone_confident",
  formal: "tone_formal",
  brief: "tone_brief",
};

export function CoverLetterView() {
  const { detected, job, ensure } = useJobContext();
  const resume = useWorkingResume(job?.id ?? null);
  const isPro = useStore(sessionStore, (s) => s.session.status === "signedIn" && s.session.isPro);
  const letter = useCoverLetter(resume?.id ?? null, ensure);
  const [copied, setCopied] = useState(false);

  return (
    <>
      <ViewHeader title={t("cover_title")} subtitle={resume ? t("cover_resume", { resume: resume.title }) : undefined} />
      <div class="view-body">
        <NeedsResume />
        <NeedsJob />
        {resume && (job || detected) ? (
          letter.draft ? (
            <>
              <div class="row wrap" role="group" aria-label={t("cover_tone")}>
                <span class="muted small">{t("cover_tone")}</span>
                {COVER_LETTER_TONES.map((tone) => (
                  <button
                    type="button"
                    key={tone}
                    class={`chip-btn ${letter.tone === tone ? "on" : ""}`}
                    aria-pressed={letter.tone === tone}
                    disabled={letter.retone.busy}
                    onClick={() => void letter.retone.run(tone)}
                  >
                    {t(TONE_LABEL[tone])}
                  </button>
                ))}
              </div>
              <TextArea id="cover-letter" label={t("cover_letter")} rows={14} value={letter.text} onInput={letter.edit} />
              <ErrorNotice error={letter.retone.error} />
              <div class="row">
                <Button block busy={letter.write.busy} onClick={() => void letter.write.run()}>
                  {t("cover_regenerate")}
                </Button>
                <Button
                  block
                  icon={copied ? "check" : "clipboard"}
                  onClick={() => void copyText(letter.text).then(setCopied)}
                >
                  {copied ? t("common_copied") : t("common_copy")}
                </Button>
              </div>
            </>
          ) : (
            <Card>
              <div class="row between">
                <span class="strong">{t("cover_intro_title")}</span>
                {isPro ? null : <Chip tone="pro">{t("common_pro")}</Chip>}
              </div>
              <p class="muted small">{t("cover_intro")}</p>
              <Button variant="primary" block icon="pen" busy={letter.write.busy} onClick={() => void letter.write.run()}>
                {t("cover_write")}
              </Button>
              {letter.write.busy ? <Spinner label={t("cover_writing")} /> : null}
              <ErrorNotice error={letter.write.error} fallback="error_readPage" />
            </Card>
          )
        ) : null}
      </div>
      {letter.draft ? (
        <footer class="view-footer">
          <Button variant="primary" block iconAfter="forward" onClick={() => navigate("apply")}>
            {t("cover_next")}
          </Button>
        </footer>
      ) : null}
    </>
  );
}
