/**
 * Every screen in the panel and where it sits on the four verbs:
 * Create → Strengthen → Target → Promote. The stepper reads `step`
 * from here; screens never hard-code it.
 */
import type { MessageKey } from "../platform/i18n";

export const STEPS = ["create", "strengthen", "target", "promote"] as const;
export type Step = (typeof STEPS)[number];

export const STEP_LABEL: Record<Step, MessageKey> = {
  create: "step_create",
  strengthen: "step_strengthen",
  target: "step_target",
  promote: "step_promote",
};

export type RouteName =
  | "home"
  | "job"
  | "strengthen"
  | "coverLetter"
  | "apply"
  | "promote"
  | "candidate"
  | "outreach"
  | "candidateVideo"
  | "prospect"
  | "postReply"
  | "pipeline"
  | "resumes";

/** `step: null` = no stepper (home, lists). `skips` = steps this flow doesn't use. */
export const ROUTE_STEP: Record<RouteName, { step: Step | null; skips?: readonly Step[] }> = {
  home: { step: null },
  job: { step: "create" },
  strengthen: { step: "strengthen" },
  coverLetter: { step: "target" },
  apply: { step: "target" },
  promote: { step: "promote" },
  candidate: { step: "create" },
  outreach: { step: "target" },
  candidateVideo: { step: "promote" },
  prospect: { step: "target", skips: ["strengthen"] },
  postReply: { step: "target", skips: ["strengthen"] },
  pipeline: { step: null },
  resumes: { step: null },
};
