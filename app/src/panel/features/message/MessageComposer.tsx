/** Write → edit → hand over a message on one of the given channels. */
import { useState } from "preact/hooks";
import { copyText } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { Button, Card, Segmented, Spinner, TextArea } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { CHANNELS, withLink, type ChannelId } from "./channels";
import { NoComposerError, useComposeMessage, type ComposeSpec } from "./useComposeMessage";

export function MessageComposer({
  spec,
  channels,
  onDelivered,
}: {
  spec: ComposeSpec;
  channels: readonly ChannelId[];
  /** After a successful hand-over (log a touch, count a send). */
  onDelivered?: (channel: ChannelId) => void;
}) {
  const [channel, setChannel] = useState<ChannelId>(channels[0]);
  const [copied, setCopied] = useState(false);
  const msg = useComposeMessage(spec);
  const def = CHANNELS[channel];
  const text = withLink(msg.body, spec.link);
  const over = def.maxChars != null && text.length > def.maxChars;
  const noBox = msg.deliver.error instanceof NoComposerError;

  const deliver = async () => {
    if (await msg.deliver.run(channel)) onDelivered?.(channel);
  };

  return (
    <Card>
      {channels.length > 1 ? (
        <Segmented
          label={t("message_channel")}
          value={channel}
          options={channels.map((c) => ({ value: c, label: t(CHANNELS[c].labelKey) }))}
          onChange={setChannel}
        />
      ) : null}
      {msg.body ? (
        <TextArea
          id="message-body"
          label={t("message_label")}
          rows={7}
          value={msg.body}
          onInput={msg.setBody}
          hint={
            def.maxChars != null ? (
              <span class={over ? "text-warn" : "text-ok"}>
                {t("message_count", { count: text.length, max: def.maxChars })}
              </span>
            ) : undefined
          }
        />
      ) : (
        <Button variant="primary" block icon="pen" busy={msg.write.busy} onClick={() => void msg.write.run()}>
          {t("message_write")}
        </Button>
      )}
      {msg.write.busy ? <Spinner label={t("message_writing")} /> : null}
      <ErrorNotice error={msg.write.error} />
      {msg.body ? (
        <>
          <div class="row">
            <Button busy={msg.write.busy} onClick={() => void msg.write.run()}>
              {t("message_rewrite")}
            </Button>
            <Button icon={copied ? "check" : "clipboard"} onClick={() => void copyText(text).then(setCopied)}>
              {copied ? t("common_copied") : t("common_copy")}
            </Button>
          </div>
          <Button variant="primary" block icon="message" busy={msg.deliver.busy} disabled={over} onClick={() => void deliver()}>
            {t(def.fillLabelKey)}
          </Button>
          <div class="muted small center">{def.deliver === "fill" ? t("message_youSend") : t("message_youSendEmail")}</div>
          {noBox ? <InfoNotice>{t("message_noBox")}</InfoNotice> : <ErrorNotice error={msg.deliver.error} />}
        </>
      ) : null}
    </Card>
  );
}
