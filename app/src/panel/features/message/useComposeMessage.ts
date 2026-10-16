/**
 * Write a personalized message (POST /api/messages/personalize) and hand
 * it over: type it into the page's open message/reply box, or open the
 * mail app. Sending is always the person's click.
 *
 * One hook per screen; the screen renders ComposerCard (the message) in its
 * body and ComposerActions (copy / fill) in its footer.
 */
import { useState } from "preact/hooks";
import { personalizeMessage, type MessageTone } from "../../api/messages";
import { copyText, openTab, sendToWorker } from "../../platform/chrome";
import { sessionStore } from "../../state/session";
import { useAction } from "../../ui/useAction";
import { CHANNELS, withLink, type ChannelId } from "./channels";

export type Recipient = { name: string; title?: string; company?: string; email?: string | null };

export type ComposeSpec = {
  recipient: Recipient;
  jobTitle?: string;
  /** What makes this message specific (the post, the pitch angle, the job). */
  context: string;
  tone: MessageTone;
  link?: string | null;
};

export class NoComposerError extends Error {}
export class DailyCapError extends Error {}
/** The message (with its link) is longer than the channel allows. */
export class OverLimitError extends Error {}

export type ComposerOptions = {
  spec: ComposeSpec;
  channels: readonly ChannelId[];
  initialChannel?: ChannelId;
  /** After a successful hand-over (log a touch, count a send). */
  onDelivered?: (channel: ChannelId) => void;
  /** The daily cap is reached — hand-over is refused. */
  blocked?: boolean;
};

export function useMessageComposer({ spec, channels, initialChannel, onDelivered, blocked = false }: ComposerOptions) {
  const [channel, setChannel] = useState<ChannelId>(initialChannel ?? channels[0]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [copied, setCopied] = useState(false);
  const def = CHANNELS[channel];
  const text = withLink(body, spec.link);
  const over = def.maxChars != null && text.length > def.maxChars;

  const write = useAction(async () => {
    const session = sessionStore.get().session;
    const senderName = session.status === "signedIn" ? session.me.name || session.me.email : "";
    const out = await personalizeMessage({
      recipientName: spec.recipient.name,
      recipientTitle: spec.recipient.title,
      recipientCompany: spec.recipient.company,
      jobTitle: spec.jobTitle,
      senderName,
      context: spec.context,
      tone: spec.tone,
    });
    setSubject(out.subject);
    setBody(withLink(out.body, spec.link));
    setCopied(false);
  });

  /**
   * THE hand-over gate — the footer button and the render-and-fill chain
   * both go through `deliver`, so neither can hand over past the daily cap
   * or the channel's character limit.
   */
  const refusal = (): Error | null => (blocked ? new DailyCapError() : over ? new OverLimitError() : null);

  /** Resolves true once handed over (useAction yields undefined on failure). */
  const deliver = useAction(async (): Promise<true> => {
    const refused = refusal();
    if (refused) throw refused;
    const out = text;
    if (def.deliver === "email") {
      const to = spec.recipient.email ?? "";
      openTab(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(out)}`);
    } else {
      const res = await sendToWorker<{ ok: boolean; error?: string }>({ action: "fillComposer", text: out });
      if (!res?.ok) {
        await copyText(out);
        throw new NoComposerError();
      }
    }
    onDelivered?.(channel);
    return true;
  });

  const copy = () => void copyText(text).then(setCopied);

  return {
    channel,
    setChannel,
    channels,
    def,
    body,
    setBody,
    text,
    over,
    copied,
    copy,
    write,
    deliver,
    blocked,
  };
}

export type Composer = ReturnType<typeof useMessageComposer>;
