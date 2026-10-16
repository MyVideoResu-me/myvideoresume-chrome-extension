/** Where a message goes, and that channel's rules. Data, not branches. */
import type { MessageKey } from "../../platform/i18n";

export type ChannelId = "email" | "linkedinNote" | "linkedinMessage" | "reply";

export type ChannelDef = {
  labelKey: MessageKey;
  /** Hard cap the destination enforces (LinkedIn connection notes: 300). */
  maxChars?: number;
  /** "fill" types into the page's open box; "email" opens the mail app. */
  deliver: "fill" | "email";
  fillLabelKey: MessageKey;
};

export const CHANNELS: Record<ChannelId, ChannelDef> = {
  email: { labelKey: "channel_email", deliver: "email", fillLabelKey: "message_openEmail" },
  linkedinNote: { labelKey: "channel_linkedinNote", maxChars: 300, deliver: "fill", fillLabelKey: "message_fillBox" },
  linkedinMessage: { labelKey: "channel_linkedinMessage", deliver: "fill", fillLabelKey: "message_fillBox" },
  reply: { labelKey: "channel_reply", deliver: "fill", fillLabelKey: "message_fillReply" },
};

/** Append the video link unless the text already carries it. */
export function withLink(body: string, link: string | null | undefined): string {
  if (!link || body.includes(link)) return body;
  return `${body.trimEnd()}\n\n${link}`;
}
