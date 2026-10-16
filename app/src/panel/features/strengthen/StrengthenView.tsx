/** Strengthen: review the tailoring for this job, then save it as a version. */
import { useState } from "preact/hooks";
import { ApiError } from "../../api/http";
import { navigate } from "../../state/nav";
import { activeResume, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { sessionStore } from "../../state/session";
import { settingsStore } from "../../state/settings";
import { useAutoRun } from "../../ui/useAutoRun";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioResumeUrl } from "../../platform/web-links";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card, Meter, Segmented, Spinner } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { NeedsResume } from "../resumes/NeedsResume";
import { NeedsJob } from "../job/NeedsJob";
import { useJobContext } from "../job/useTrackedJob";
import { ChangeItem, GapItem } from "./ReviewItems";
import { useTailorReview } from "./useTailorReview";

type Tab = "changes" | "questions";

export function StrengthenView() {
  const resume = useStore(resumesStore, activeResume);
  const { detected, job, ensure } = useJobContext();
  const flow = useTailorReview(resume, ensure);
  const autoTailor = useStore(
    settingsStore,
    (s) => s.settings.autoTailor,
  );
  const isPro = useStore(sessionStore, (s) => s.session.status === "signedIn" && s.session.isPro);
  useAutoRun(autoTailor && isPro && !!resume && !!(job || detected), flow.start.run);
  const [tab, setTab] = useState<Tab>("changes");
  const { review } = flow;
  const noChanges = flow.start.error instanceof ApiError && flow.start.error.code === "NO_APPLICABLE_CHANGES";

  return (
    <>
      <ViewHeader
        title={t("strengthen_title")}
        subtitle={t("strengthen_for", { job: review?.job.title ?? job?.title ?? detected?.title ?? "" })}
      />
      <div class="view-body">
        <NeedsResume />
        <NeedsJob />
        {!review && resume && (job || detected) ? (
          <Card>
            <p class="small">{t("strengthen_intro", { resume: resume.title })}</p>
            <Button variant="primary" block icon="target" busy={flow.start.busy} onClick={() => void flow.start.run()}>
              {t("strengthen_start")}
            </Button>
            {flow.start.busy ? <Spinner label={t("strengthen_working")} /> : null}
            {noChanges ? <InfoNotice>{t("strengthen_noChanges")}</InfoNotice> : <ErrorNotice error={flow.start.error} fallback="error_readPage" />}
          </Card>
        ) : null}

        {review ? (
          <>
            <Card>
              <div class="row between">
                <span class="strong">{t("strengthen_fit")}</span>
                <span class="row">
                  <span class="score muted">{review.preview.oldScore}</span>
                  <Icon name="forward" />
                  <span class="score">{review.preview.newScore}</span>
                </span>
              </div>
              <Meter
                value={review.preview.oldScore}
                ghost={review.preview.newScore}
                label={t("strengthen_fitLabel", { from: review.preview.oldScore, to: review.preview.newScore })}
              />
            </Card>

            <Segmented
              label={t("strengthen_tabs")}
              value={tab}
              options={[
                { value: "changes", label: t("strengthen_tabChanges", { count: review.preview.changes.length }) },
                { value: "questions", label: t("strengthen_tabQuestions", { count: flow.openGaps.length }) },
              ]}
              onChange={setTab}
            />

            <div class="stack-sm">
              {tab === "changes"
                ? review.preview.changes.map((c, i) => (
                    <ChangeItem key={i} change={c} kept={!flow.reverted.has(i)} onToggle={() => flow.toggleChange(i)} />
                  ))
                : flow.openGaps.map((g) => <GapItem key={g.id} gap={g} onAnswer={(has) => flow.answerGap(g, has)} />)}
              {tab === "questions" && !flow.openGaps.length ? <p class="muted small">{t("strengthen_noQuestions")}</p> : null}
              {flow.confirmed.length ? (
                <p class="small">{t("strengthen_addingSkills", { skills: flow.confirmed.join(", ") })}</p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      {review ? (
        <footer class="view-footer">
          {flow.saved ? (
            <>
              <InfoNotice>{t("strengthen_saved", { title: flow.saved.title })}</InfoNotice>
              <div class="row">
                <Button onClick={() => openTab(studioResumeUrl(flow.saved!.resumeId))} icon="external">
                  {t("common_openStudio")}
                </Button>
                <Button variant="primary" block iconAfter="forward" onClick={() => navigate("coverLetter")}>
                  {t("strengthen_next")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div class="muted small row">
                <Icon name="file" />
                {t("strengthen_savesAs")}
              </div>
              <Button variant="primary" block busy={flow.save.busy} onClick={() => void flow.save.run()}>
                {t("strengthen_save", { count: flow.keptCount })}
              </Button>
              <ErrorNotice error={flow.save.error} />
            </>
          )}
        </footer>
      ) : null}
    </>
  );
}
