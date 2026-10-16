/**
 * Lenses — one extension, three ways of looking at a page. A lens is DATA:
 * which actions it offers for each kind of page entity, and who may use
 * it. Adding a lens = adding an entry here.
 *
 * The recruiter lens is for hiring roles (recruiter, employer) and admins,
 * and follows the product's hiring switch (HIRING_PERSONAS_ENABLED in
 * hired.video/shared/user-roles.ts) — one switch, no extension flag.
 */
import { HIRING_PERSONAS_ENABLED, USER_ROLES, isHiringRole } from "@shared/user-roles";
import type { MessageKey } from "../platform/i18n";
import type { IconName } from "../ui/Icon";
import type { ActionId } from "./actions";
import type { PageKind } from "./entities";

export type LensId = "jobSeeker" | "recruiter" | "sales";

/** What the pair tray pairs: the page with my résumé, or a candidate with a job. */
export type Pairing = "pageAndMe" | "candidateAndJob";

export type LensDef = {
  id: LensId;
  pairing: Pairing;
  labelKey: MessageKey;
  descKey: MessageKey;
  icon: IconName;
  actions: Record<PageKind, readonly ActionId[]>;
  isAvailable: (role: string) => boolean;
};

const always = () => true;
const isAdmin = (role: string) => role === USER_ROLES.ADMIN || role === USER_ROLES.SUPER_ADMIN;

export const LENSES: readonly LensDef[] = [
  {
    id: "jobSeeker",
    pairing: "pageAndMe",
    labelKey: "lens_jobSeeker",
    descKey: "lens_jobSeeker_desc",
    icon: "user",
    actions: {
      job: ["strengthen", "coverLetter", "apply", "promoteFit"],
      profile: ["profileImport", "pitch"],
      post: ["postReply"],
      none: ["promoteResume"],
    },
    isAvailable: always,
  },
  {
    id: "recruiter",
    pairing: "candidateAndJob",
    labelKey: "lens_recruiter",
    descKey: "lens_recruiter_desc",
    icon: "users",
    actions: {
      job: ["trackJob"],
      profile: ["candidate", "outreach", "candidateVideo"],
      post: ["postReply"],
      none: [],
    },
    isAvailable: (role) => HIRING_PERSONAS_ENABLED && (isHiringRole(role) || isAdmin(role)),
  },
  {
    id: "sales",
    pairing: "pageAndMe",
    labelKey: "lens_sales",
    descKey: "lens_sales_desc",
    icon: "send",
    actions: {
      job: ["promoteFit"],
      profile: ["pitch"],
      post: ["postReply"],
      none: ["promoteResume"],
    },
    isAvailable: always,
  },
];

export function availableLenses(role: string): LensDef[] {
  return LENSES.filter((l) => l.isAvailable(role));
}

/** The lens to use: the saved choice if still allowed, else the role's default. */
export function resolveLens(saved: LensId | null | undefined, role: string): LensDef {
  const allowed = availableLenses(role);
  const savedLens = allowed.find((l) => l.id === saved);
  if (savedLens) return savedLens;
  return allowed.find((l) => l.id === (isHiringRole(role) ? "recruiter" : "jobSeeker")) ?? allowed[0];
}
