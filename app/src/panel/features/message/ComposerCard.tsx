/** The message: channel, the text (written by AI, edited by the person), its cap. */
import type { ComponentChildren } from "preact";
import { t } from "../../platform/i18n";
import { Button, Segmented, Spinner, TextArea } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { CHANNELS } from "./channels";
import type { Composer } from "./useComposeMessage";

export function ComposerCard({
  composer,
  label,
  children,
}: {
  composer: Composer;
  /** The text box label (default "Message"). */
  label?: string;
  /** Shown between the channel picker and the message (e.g. "Personalized from"). */
  children?: ComponentChildren;
}) {
  const { def, write } = composer;
  return (
    <div class="stack-sm">
      {composer.channels.length > 1 ? (
        <Segmented
          label={t("message_channel")}
          value={composer.channel}
          options={composer.channels.map((c) => ({ value: c, label: t(CHANNELS[c].labelKey) }))}
          onChange={composer.setChannel}
        />
      ) : null}
      {children}
      {composer.body ? (
        <>
          <TextArea
            id="message-body"
            label={label ?? t("message_label")}
            rows={7}
            value={composer.body}
            onInput={composer.setBody}
            hint={
              def.maxChars != null ? (
                <span class="composer-hint">
                  <span>{def.capCaptionKey ? t(def.capCaptionKey, { max: def.maxChars }) : null}</span>
                  <span class={composer.over ? "text-warn" : "text-ok"}>
                    {t("message_count", { count: composer.text.length, max: def.maxChars })}
                  </span>
                </span>
              ) : undefined
            }
          />
          <Button size="sm" busy={write.busy} onClick={() => void write.run()}>
            {t("message_rewrite")}
          </Button>
        </>
      ) : (
        <>
          <Button block icon="pen" busy={write.busy} onClick={() => void write.run()}>
            {t("message_write")}
          </Button>
          {def.capCaptionKey && def.maxChars != null ? (
            <p class="muted small">{t(def.capCaptionKey, { max: def.maxChars })}</p>
          ) : null}
        </>
      )}
      {write.busy ? <Spinner label={t("message_writing")} /> : null}
      <ErrorNotice error={write.error} />
    </div>
  );
}
