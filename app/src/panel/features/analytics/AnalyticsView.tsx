/** My progress: this week, the funnel, conversion, and how many go quiet. */
import { useEffect, useState } from "preact/hooks";
import { fetchAnalytics, type ExtensionAnalytics, type FunnelStage } from "../../api/analytics";
import { t, uiLocale, type MessageKey } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Card, Meter, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";

const STAGES: ReadonlyArray<{ key: FunnelStage; labelKey: MessageKey }> = [
  { key: "tracked", labelKey: "status_tracked" },
  { key: "applied", labelKey: "status_applied" },
  { key: "interviewing", labelKey: "status_interviewing" },
  { key: "offered", labelKey: "status_offered" },
  { key: "accepted", labelKey: "status_accepted" },
  { key: "rejected", labelKey: "status_rejected" },
];

function Stat({ value, labelKey, delta }: { value: string | number; labelKey: MessageKey; delta?: number }) {
  return (
    <div class="stat">
      <div class="stat-value">{value}</div>
      <div class="muted small">{t(labelKey)}</div>
      {delta ? <div class={`small ${delta > 0 ? "text-ok" : "text-warn"}`}>{t("analytics_delta", { delta: delta > 0 ? `+${delta}` : String(delta) })}</div> : null}
    </div>
  );
}

export function AnalyticsView() {
  const [data, setData] = useState<ExtensionAnalytics | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    fetchAnalytics().then(setData, setError);
  }, []);
  const pct = (n: number) => new Intl.NumberFormat(uiLocale(), { style: "percent", maximumFractionDigits: 0 }).format(n / 100);
  const maxStage = data ? Math.max(1, ...STAGES.map((s) => data.funnel[s.key] ?? 0)) : 1;

  return (
    <>
      <ViewHeader title={t("analytics_title")} />
      <div class="view-body">
        <ErrorNotice error={error} />
        {!data && !error ? <Spinner label={t("common_loading")} /> : null}
        {data ? (
          <>
            <Card>
              <div class="strong">{t("analytics_thisWeek")}</div>
              <div class="stats">
                <Stat value={data.thisWeek.tracked} labelKey="analytics_tracked" delta={data.thisWeek.trackedDelta} />
                <Stat value={data.thisWeek.applied} labelKey="analytics_applied" delta={data.thisWeek.appliedDelta} />
                <Stat value={data.thisWeek.streak} labelKey="analytics_streak" />
              </div>
            </Card>
            <Card>
              <div class="strong">{t("analytics_funnel")}</div>
              {STAGES.map((s) => {
                const count = data.funnel[s.key] ?? 0;
                return (
                  <div key={s.key} class="funnel-row">
                    <span class="small funnel-label">{t(s.labelKey)}</span>
                    <Meter value={(count / maxStage) * 100} label={t("analytics_stageLabel", { stage: t(s.labelKey), count })} />
                    <span class="small strong">{count}</span>
                  </div>
                );
              })}
            </Card>
            <Card>
              <div class="strong">{t("analytics_conversion")}</div>
              <div class="stats">
                <Stat value={pct(data.conversion.applyRate)} labelKey="analytics_applyRate" />
                <Stat value={pct(data.conversion.interviewRate)} labelKey="analytics_interviewRate" />
                <Stat value={pct(data.conversion.offerRate)} labelKey="analytics_offerRate" />
              </div>
            </Card>
            {data.weeklyTrend.length ? (
              <Card>
                <div class="strong">{t("analytics_weekly")}</div>
                <ul class="checklist">
                  {data.weeklyTrend.map((w) => (
                    <li key={w.week}>
                      <span class="fill-label small">{w.week}</span>
                      <span class="muted small">{t("analytics_weekRow", { tracked: w.tracked, applied: w.applied })}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
            <Card>
              <div class="stats">
                <Stat value={pct(data.ghostRate)} labelKey="analytics_ghostRate" />
                <Stat value={data.totals.applied} labelKey="analytics_totalApplied" />
                <Stat value={data.totals.offers} labelKey="analytics_totalOffers" />
              </div>
            </Card>
          </>
        ) : null}
      </div>
    </>
  );
}
