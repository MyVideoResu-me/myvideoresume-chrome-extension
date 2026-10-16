/** The person's job-search progress (GET /api/dashboard/extension-analytics). */
import { request } from "./http";

export type FunnelStage = "tracked" | "applied" | "interviewing" | "offered" | "accepted" | "rejected";

export type ExtensionAnalytics = {
  thisWeek: { tracked: number; applied: number; streak: number; trackedDelta: number; appliedDelta: number };
  funnel: Partial<Record<FunnelStage, number>>;
  conversion: { applyRate: number; interviewRate: number; offerRate: number };
  weeklyTrend: Array<{ week: string; tracked: number; applied: number }>;
  ghostRate: number;
  totals: { applied: number; offers: number };
};

type Obj = Record<string, unknown>;
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});

export async function fetchAnalytics(): Promise<ExtensionAnalytics> {
  const raw = obj(await request<unknown>("/api/dashboard/extension-analytics"));
  const week = obj(raw.thisWeek);
  const conv = obj(raw.conversion);
  const totals = obj(raw.totals);
  const funnel = obj(raw.funnel);
  return {
    thisWeek: {
      tracked: num(week.tracked),
      applied: num(week.applied),
      streak: num(week.streak),
      trackedDelta: num(week.trackedDelta),
      appliedDelta: num(week.appliedDelta),
    },
    funnel: Object.fromEntries(Object.entries(funnel).map(([k, v]) => [k, num(v)])),
    conversion: { applyRate: num(conv.applyRate), interviewRate: num(conv.interviewRate), offerRate: num(conv.offerRate) },
    weeklyTrend: (Array.isArray(raw.weeklyTrend) ? raw.weeklyTrend : []).map((w) => {
      const o = obj(w);
      return { week: String(o.week ?? ""), tracked: num(o.tracked), applied: num(o.applied) };
    }),
    ghostRate: num(raw.ghostRate),
    totals: { applied: num(totals.applied), offers: num(totals.offers) },
  };
}
