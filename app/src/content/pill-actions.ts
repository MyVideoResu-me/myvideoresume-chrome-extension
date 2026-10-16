/**
 * Which one-click intents the in-page pill offers, per lens and per kind
 * of thing detected. Data only; the panel maps each intent to a screen.
 */
import type { DetectedKind } from "../../../shared/detection-bus";
import type { LensId } from "../panel/domain/lenses";
import type { MessageKey } from "../panel/platform/i18n";
import type { PillIntent } from "../shared/intents";

export type PillAction = { intent: PillIntent["action"]; labelKey: MessageKey };

const PAGE_AND_ME: Record<DetectedKind, readonly PillAction[]> = {
  job: [
    { intent: "track", labelKey: "pill_track" },
    { intent: "strengthen", labelKey: "pill_tailor" },
  ],
  profile: [{ intent: "pitch", labelKey: "pill_pitch" }],
  post: [{ intent: "reply", labelKey: "pill_reply" }],
};

export const PILL_ACTIONS: Record<LensId, Record<DetectedKind, readonly PillAction[]>> = {
  jobSeeker: PAGE_AND_ME,
  sales: PAGE_AND_ME,
  recruiter: {
    job: [{ intent: "track", labelKey: "pill_track" }],
    profile: [{ intent: "candidate", labelKey: "pill_candidate" }],
    post: [{ intent: "reply", labelKey: "pill_reply" }],
  },
};

export const PILL_LABEL: Record<DetectedKind, MessageKey> = {
  job: "pill_jobDetected",
  profile: "pill_profileDetected",
  post: "pill_postDetected",
};
