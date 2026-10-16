/**
 * Footer hand-over: Copy + fill the page's box (or open the mail app).
 * Never sends — the person presses Send. `primary` replaces the fill
 * button when a screen chains more into it (render, then fill).
 */
import type { ComponentChildren } from "preact";
import { t } from "../../platform/i18n";
import { Button } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { DailyCapError, NoComposerError, OverLimitError, type Composer } from "./useComposeMessage";

export function ComposerNotices({ composer }: { composer: Composer }) {
  const err = composer.deliver.error;
  if (err instanceof NoComposerError) return <InfoNotice>{t("message_noBox")}</InfoNotice>;
  if (err instanceof DailyCapError) return <p class="small text-warn" role="alert">{t("message_capReached")}</p>;
  if (err instanceof OverLimitError) return <p class="small text-warn" role="alert">{t("message_overLimit")}</p>;
  return <ErrorNotice error={err} />;
}

export function ComposerActions({
  composer,
  primary,
  note,
}: {
  composer: Composer;
  primary?: ComponentChildren;
  /** The line under the buttons (default: who presses Send). */
  note?: string;
}) {
  const { def, deliver } = composer;
  const ready = !!composer.body;
  return (
    <footer class="view-footer">
      <div class="row">
        {ready ? (
          <Button icon={composer.copied ? "check" : "clipboard"} onClick={composer.copy}>
            {composer.copied ? t("common_copied") : t("common_copy")}
          </Button>
        ) : null}
        {primary ?? (
          <Button
            variant="primary"
            block
            icon="message"
            busy={deliver.busy}
            disabled={!ready || composer.over || composer.blocked}
            onClick={() => void deliver.run()}
          >
            {t(def.fillLabelKey)}
          </Button>
        )}
      </div>
      <div class="muted small center">
        {note ?? (def.deliver === "fill" ? t("message_youSend") : t("message_youSendEmail"))}
      </div>
      <ComposerNotices composer={composer} />
    </footer>
  );
}
