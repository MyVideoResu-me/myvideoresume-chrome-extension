/**
 * The "make something" actions a lens offers for what's on the page.
 * Data only: a lens lists action ids; the home grid renders them.
 */
import type { MessageKey } from "../platform/i18n";
import type { IconName } from "../ui/Icon";
import type { RouteName } from "./routes";

export type ActionId =
  | "trackJob"
  | "strengthen"
  | "coverLetter"
  | "apply"
  | "promoteFit"
  | "promoteResume"
  | "candidate"
  | "outreach"
  | "candidateVideo"
  | "pitch"
  | "postReply"
  | "profileImport";

export type ActionDef = {
  labelKey: MessageKey;
  hintKey: MessageKey;
  icon: IconName;
  /** promote actions use the warm accent. */
  tone: "primary" | "promote";
  route: RouteName;
  /** Copy when the profile on the page is the person's own. */
  ownProfile?: { labelKey: MessageKey; hintKey: MessageKey };
};

export const ACTIONS: Record<ActionId, ActionDef> = {
  trackJob: { labelKey: "action_trackJob", hintKey: "action_trackJob_hint", icon: "bookmark", tone: "primary", route: "job" },
  strengthen: { labelKey: "action_strengthen", hintKey: "action_strengthen_hint", icon: "target", tone: "primary", route: "strengthen" },
  coverLetter: { labelKey: "action_coverLetter", hintKey: "action_coverLetter_hint", icon: "pen", tone: "primary", route: "coverLetter" },
  apply: { labelKey: "action_apply", hintKey: "action_apply_hint", icon: "send", tone: "primary", route: "apply" },
  promoteFit: { labelKey: "action_promoteFit", hintKey: "action_promoteFit_hint", icon: "video", tone: "promote", route: "promote" },
  promoteResume: { labelKey: "action_promoteResume", hintKey: "action_promoteResume_hint", icon: "video", tone: "promote", route: "promote" },
  candidate: { labelKey: "action_candidate", hintKey: "action_candidate_hint", icon: "user", tone: "primary", route: "candidate" },
  outreach: { labelKey: "action_outreach", hintKey: "action_outreach_hint", icon: "message", tone: "primary", route: "outreach" },
  candidateVideo: { labelKey: "action_candidateVideo", hintKey: "action_candidateVideo_hint", icon: "video", tone: "promote", route: "candidateVideo" },
  pitch: { labelKey: "action_pitch", hintKey: "action_pitch_hint", icon: "video", tone: "promote", route: "prospect" },
  postReply: { labelKey: "action_postReply", hintKey: "action_postReply_hint", icon: "message", tone: "promote", route: "postReply" },
  profileImport: {
    labelKey: "action_profileImprove",
    hintKey: "action_profileImprove_hint",
    icon: "file",
    tone: "primary",
    route: "profileImport",
    ownProfile: { labelKey: "action_profileImportOwn", hintKey: "action_profileImportOwn_hint" },
  },
};

/** The label + hint to show for an action, given whose profile is on the page. */
export function actionCopy(id: ActionId, ctx: { ownProfile: boolean }): { labelKey: MessageKey; hintKey: MessageKey } {
  const def = ACTIONS[id];
  return ctx.ownProfile && def.ownProfile ? def.ownProfile : { labelKey: def.labelKey, hintKey: def.hintKey };
}
