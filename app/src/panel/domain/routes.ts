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

/** A screen the panel can show. */
export type ScreenName =
  | "home"
  | "job"
  | "strengthen"
  | "target"
  | "promote"
  | "candidate"
  | "outreach"
  | "candidateVideo"
  | "prospect"
  | "postReply"
  | "pipeline"
  | "analytics"
  | "resumes"
  | "settings"
  | "profileImport";

/** The tabs of the "Target this job" screen. */
export const TARGET_TABS = ["resume", "cover", "apply"] as const;
export type TargetTab = (typeof TARGET_TABS)[number];

/**
 * Entry points that open one tab of a screen ("Cover letter" opens the
 * Target screen on its letter tab). Navigating to one is navigating to
 * its screen + tab.
 */
export const ROUTE_ALIASES = {
  coverLetter: { screen: "target", tab: "cover" },
  apply: { screen: "target", tab: "apply" },
} as const satisfies Record<string, { screen: ScreenName; tab: TargetTab }>;

export type RouteName = ScreenName | keyof typeof ROUTE_ALIASES;

export function resolveRoute(route: RouteName): { screen: ScreenName; tab: TargetTab | null } {
  if (route in ROUTE_ALIASES) {
    const alias = ROUTE_ALIASES[route as keyof typeof ROUTE_ALIASES];
    return { screen: alias.screen, tab: alias.tab };
  }
  return { screen: route as ScreenName, tab: null };
}

/**
 * `step: null` = no stepper (home, lists). `skips` = steps this flow
 * doesn't use. `appHeader` = the screen opens a flow from the page, so it
 * carries the app header (logo, lens, account) instead of back + title.
 */
export const ROUTE_STEP: Record<ScreenName, { step: Step | null; skips?: readonly Step[]; appHeader?: true }> = {
  home: { step: null, appHeader: true },
  job: { step: "create", appHeader: true },
  strengthen: { step: "strengthen" },
  target: { step: "target" },
  promote: { step: "promote" },
  candidate: { step: "create", appHeader: true },
  outreach: { step: "target" },
  candidateVideo: { step: "promote" },
  prospect: { step: "target", skips: ["strengthen"], appHeader: true },
  postReply: { step: "target", skips: ["strengthen"], appHeader: true },
  pipeline: { step: null },
  analytics: { step: null },
  resumes: { step: null },
  settings: { step: null },
  profileImport: { step: "strengthen" },
};
