/**
 * Recruiter outreach, as data: the facts an intro can be personalized from
 * (each a toggle chip — only the ones left on reach the AI), and the
 * attachments a message can carry.
 */
import type { CapturedCandidate } from "../api/recruiter";
import type { Job } from "../api/jobs";
import type { MessageKey } from "../platform/i18n";

export type PersonalizeChip = {
  id: string;
  /** The chip text: the fact itself (a skill, a role) — data, not copy. */
  label: string;
  /** What the AI is told about it. */
  fact: string;
};

const MAX_SKILL_CHIPS = 3;

/** Chips from what we know about the candidate and the job. */
export function personalizeChips(candidate: CapturedCandidate, job: Job): PersonalizeChip[] {
  const { profile } = candidate;
  const chips: PersonalizeChip[] = profile.skills
    .slice(0, MAX_SKILL_CHIPS)
    .map((skill) => ({ id: `skill:${skill}`, label: skill, fact: skill }));
  const role = [profile.title, profile.company].filter(Boolean).join(" · ");
  if (role) chips.push({ id: "role", label: role, fact: role });
  if (profile.summary) {
    const first = profile.summary.split(/(?<=[.!?])\s/)[0].slice(0, 160);
    chips.push({ id: "summary", label: first.length > 40 ? `${first.slice(0, 40)}…` : first, fact: first });
  }
  if (job.location) chips.push({ id: "location", label: job.location, fact: job.location });
  return chips;
}

/** The facts of the chips left on, for the message context. */
export function chipFacts(chips: readonly PersonalizeChip[], on: ReadonlySet<string>): string {
  return chips
    .filter((c) => on.has(c.id))
    .map((c) => c.fact)
    .join("; ");
}

/** What an intro can link to. "none" = no link. */
export type AttachmentKind = "candidateVideo" | "jobPage" | "none";

export const ATTACHMENTS: ReadonlyArray<{ id: AttachmentKind; labelKey: MessageKey }> = [
  { id: "candidateVideo", labelKey: "outreach_attachCandidateVideo" },
  { id: "jobPage", labelKey: "outreach_attachJobPage" },
  { id: "none", labelKey: "outreach_attachNone" },
];

/** Daily cap on hand-sent pitches (LinkedIn flags bulk outreach). */
export const PITCH_DAILY_CAP = 20;
