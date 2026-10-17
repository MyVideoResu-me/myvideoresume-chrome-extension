/** Strengthen: review the tailoring for this job, then save it as a version and go on to Target. */
import { useState } from "preact/hooks";
import { ApiError } from "../../api/http";
import { resumeToText } from "../../domain/resume-docs";
import { navigate } from "../../state/nav";
import { activeResume, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { useIsPro } from "../../state/session";
import { settingsStore } from "../../state/settings";
import { useAutoRun } from "../../ui/useAutoRun";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioResumeUrl } from "../../platform/web-links";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card, Meter, Segmented, Spinner } from "../../ui/controls";
import { ErrorNotice, InfoNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { PreviewSheet } from "../../ui/PreviewSheet";
import { NeedsResume } from "../resumes/NeedsResume";
import { ResumeCheckCard } from "../resumes/ResumeCheck";
import { NeedsJob } from "../job/NeedsJob";
import { useJobContext } from "../job/useTrackedJob";
import { changeLabel } from "./change-label";
import { KeywordsTab } from "./KeywordsTab";
import { ChangeItem, GapItem } from "./ReviewItems";
import { isRevertible, useTailorReview } from "./useTailorReview";

type Tab = "fixes" | "keywords" | "tools";


export function StrengthenView() {
  const resume = useStore(resumesStore, activeResume);
  const { detected, job, ensure } = useJobContext();
  const flow = useTailorReview(resume, ensure);
  const autoTailor = useStore(settingsStore, (s) => s.settings.autoTailor);
  const isPro = useIsPro();
  useAutoRun(autoTailor && isPro && !!resume && !!(job || detected), flow.start.run);
  const [tab, setTab] = useState<Tab>("fixes");
  const [previewing, setPreviewing] = useState(false);
  const { review } = flow;
  const noChanges = flow.start.error instanceof ApiError && flow.start.error.code === "NO_APPLICABLE_CHANGES";
  const preview = previewing ? flow.draft() : null;
  // The version name sits bold inside the sentence, wherever the language puts it.
  const savesAs = t("strengthen_savesAs").split("{title}");

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
              <div class="row">
                <span class="strong grow">{t("strengthen_fit")}</span>
                <span class="score muted">{review.preview.oldScore}</span>
                <span class="score">{flow.score}</span>
              </div>
              <Meter
                value={review.preview.oldScore}
                ghost={flow.score}
                label={t("strengthen_fitLabel", { from: review.preview.oldScore, to: flow.score })}
              />
              <div class="small text-3">{t("strengthen_fitCaption", { count: flow.keptCount })}</div>
            </Card>

            <Segmented
              label={t("strengthen_tabs")}
              value={tab}
              options={[
                { value: "fixes", label: t("strengthen_tabFixes", { count: review.preview.changes.length + flow.openGaps.length }) },
                { value: "keywords", label: t("strengthen_tabKeywords") },
                { value: "tools", label: t("strengthen_tabTools") },
              ]}
              onChange={setTab}
            />

            {tab === "fixes" ? (
              <div class="stack-sm">
                {flow.openGaps.map((g) => (
                  <GapItem key={g.id} gap={g} onAnswer={(has) => flow.answerGap(g, has)} />
                ))}
                {review.preview.changes.map((c, i) => (
                  <ChangeItem
                    key={i}
                    change={c}
                    label={changeLabel(c, review.original)}
                    kept={!flow.reverted.has(i)}
                    fixed={!isRevertible(c)}
                    onToggle={() => flow.toggleChange(i)}
                  />
                ))}
                {flow.confirmed.length ? (
                  <p class="small">{t("strengthen_addingSkills", { skills: flow.confirmed.join(", ") })}</p>
                ) : null}
              </div>
            ) : tab === "keywords" ? (
              <KeywordsTab matched={review.preview.matchedKeywords ?? []} gaps={review.preview.gaps} />
            ) : resume ? (
              <ResumeCheckCard key={resume.id} resumeId={resume.id} title={resume.title} />
            ) : null}
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
                <Button variant="primary" block iconAfter="forward" onClick={() => navigate("target")}>
                  {t("strengthen_next")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <div class="small text-3 row">
                <Icon name="file" />
                <span>
                  {savesAs[0]}
                  <b class="text-strong">{flow.versionTitle}</b>
                  {savesAs[1]}
                </span>
              </div>
              <div class="row">
                <Button icon="eye" onClick={() => setPreviewing(true)}>
                  {t("strengthen_preview")}
                </Button>
                <Button
                  variant="primary"
                  block
                  iconAfter="forward"
                  busy={flow.save.busy}
                  onClick={() => void flow.save.run().then((ok) => ok && navigate("target"))}
                >
                  {t("strengthen_saveContinue")}
                </Button>
              </div>
              <ErrorNotice error={flow.save.error} />
            </>
          )}
        </footer>
      ) : null}

      {preview ? (
        <PreviewSheet title={flow.versionTitle} onClose={() => setPreviewing(false)}>
          <div class="doc-preview">{resumeToText(preview)}</div>
        </PreviewSheet>
      ) : null}
    </>
  );
}
