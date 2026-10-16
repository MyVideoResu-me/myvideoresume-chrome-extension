/**
 * Messages: AI-personalized outreach. One endpoint serves every message
 * the panel writes (candidate intro, prospect pitch, post reply); the
 * `context` field carries what makes each one specific.
 */
import { request } from "./http";

export type MessageTone = "professional" | "friendly" | "concise";

export type PersonalizeInput = {
  recipientName: string;
  recipientTitle?: string;
  recipientCompany?: string;
  jobTitle?: string;
  senderName: string;
  context?: string;
  tone?: MessageTone;
};

export type PersonalizedMessage = { subject: string; body: string; tier: string };

export async function personalizeMessage(input: PersonalizeInput): Promise<PersonalizedMessage> {
  const out = await request<{ subject?: string; body?: string; tier?: string }>("/api/messages/personalize", {
    method: "POST",
    body: { ...input, context: input.context?.slice(0, 2000) },
  });
  return { subject: out.subject ?? "", body: out.body ?? "", tier: out.tier ?? "" };
}
