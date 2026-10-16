/**
 * "From their profile" — a few specifics a pitch can speak to, read from
 * the prospect's profile (parsed from the page). Context for MY message
 * only; nothing here goes into my résumé.
 */
import type { ResumeContent } from "@shared/resume";
import type { DetectedProfile } from "./entities";

const MAX_SIGNALS = 3;
const MAX_LEN = 120;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const clip = (s: string): string => (s.length > MAX_LEN ? `${s.slice(0, MAX_LEN - 1)}…` : s);

export function profileSignals(content: ResumeContent | null, detected: DetectedProfile): string[] {
  const out: string[] = [];
  const firstSentence = str(content?.basics?.summary).split(/(?<=[.!?])\s/)[0];
  if (firstSentence) out.push(clip(firstSentence));
  const current = (content?.work ?? [])[0] as Record<string, unknown> | undefined;
  const role = [str(current?.position) || detected.title, str(current?.name) || detected.company].filter(Boolean).join(" · ");
  if (role) out.push(clip(role));
  const skills = (content?.skills ?? []).map((s) => str(s.name)).filter(Boolean).slice(0, 4);
  if (skills.length) out.push(clip(skills.join(", ")));
  return out.slice(0, MAX_SIGNALS);
}
