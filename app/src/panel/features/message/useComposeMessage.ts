/**
 * Write a personalized message (POST /api/messages/personalize) and hand
 * it over: type it into the page's open message/reply box, or open the
 * mail app. Sending is always the person's click.
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

export function useComposeMessage(spec: ComposeSpec) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

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
  });

  /** Resolves true once handed over (useAction yields undefined on failure). */
  const deliver = useAction(async (channel: ChannelId): Promise<true> => {
    const text = withLink(body, spec.link);
    if (CHANNELS[channel].deliver === "email") {
      const to = spec.recipient.email ?? "";
      openTab(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`);
      return true;
    }
    const res = await sendToWorker<{ ok: boolean; error?: string }>({ action: "fillComposer", text });
    if (!res?.ok) {
      await copyText(text);
      throw new NoComposerError();
    }
    return true;
  });

  return { subject, body, setBody, write, deliver };
}
