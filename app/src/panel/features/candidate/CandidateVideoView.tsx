/**
 * Recruiter · Promote: the candidate's résumé (built from their profile),
 * tailored to the paired job, as an unlisted video for the hiring manager
 * — named or anonymized for a blind shortlist. Never posted publicly: that
 * needs the candidate's consent, which the platform has no flow for yet.
 */
import { useState } from "preact/hooks";
import { previewTailorContent } from "../../api/match";
import { jobDescriptionText } from "../../domain/job-text";
import { anonymizeResume, profileToResume, resumeToText } from "../../domain/resume-docs";
import { pairStore, setCandidateResume } from "../../state/pair";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { NeedsCandidatePair } from "./NeedsCandidatePair";
import { Button, Card, Segmented } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { useAction } from "../../ui/useAction";
import { VideoBuilder } from "../video/VideoBuilder";
import type { VideoSpec } from "../video/useVideoProject";

type Visibility = "named" | "anonymized";

export function CandidateVideoView() {
  const { candidate, job, candidateResume } = useStore(pairStore, (s) => s);
  const [visibility, setVisibility] = useState<Visibility>("named");
  const tailor = useAction(async () => {
    if (!candidate || !job) return;
    const out = await previewTailorContent({ jobId: job.id }, profileToResume(candidate.profile));
    setCandidateResume(out.tailoredResume);
  });

  if (!candidate || !job) {
    return (
      <EmptyView title={t("candidateVideo_title")}>
        <NeedsCandidatePair />
      </EmptyView>
    );
  }

  const anonymous = visibility === "anonymized";
  const spec: VideoSpec = {
    purpose: "resume",
    name: anonymous
      ? t("candidateVideo_nameAnon", { job: job.title })
      : t("candidateVideo_name", { name: candidate.profile.name, job: job.title }),
    targetDuration: 45,
    unlisted: true,
    source: async () => {
      const base = candidateResume ?? profileToResume(candidate.profile);
      const content = anonymous ? anonymizeResume(base, t("candidateVideo_anonName")) : base;
      return {
        resumeText: resumeToText(content),
        jobDescription: jobDescriptionText(job),
        prompt: t("candidateVideo_prompt", { job: job.title, company: job.company }),
      };
    },
  };

  return (
    <>
      <ViewHeader
        title={t("candidateVideo_title")}
        subtitle={t("candidateVideo_for", { name: candidate.profile.name, job: job.title })}
      />
      <div class="view-body">
        <Card>
          <ul class="checklist">
            <li class="line-ok">
              <span class="fill-dot" aria-hidden="true">
                <Icon name="check" size={11} />
              </span>
              {t("candidateVideo_extracted")}
            </li>
            <li class="line-ok">
              <span class="fill-dot" aria-hidden="true">
                <Icon name="check" size={11} />
              </span>
              {t("candidateVideo_built")}
            </li>
            <li class={candidateResume ? "line-ok" : "line-need"}>
              <span class="fill-dot" aria-hidden="true">
                {candidateResume ? <Icon name="check" size={11} /> : "3"}
              </span>
              {candidateResume ? t("candidateVideo_tailored") : t("candidateVideo_tailor")}
              {candidateResume ? null : (
                <Button size="sm" busy={tailor.busy} onClick={() => void tailor.run()}>
                  {t("candidateVideo_tailorBtn")}
                </Button>
              )}
            </li>
          </ul>
          <ErrorNotice error={tailor.error} />
        </Card>

        <Segmented
          label={t("candidateVideo_who")}
          value={visibility}
          options={[
            { value: "named", label: t("candidateVideo_named") },
            { value: "anonymized", label: t("candidateVideo_anonymized") },
          ]}
          onChange={setVisibility}
        />
        <p class="muted small">{anonymous ? t("candidateVideo_anonymizedHint") : t("candidateVideo_namedHint")}</p>

        <VideoBuilder key={visibility} spec={spec} shareOnly />
      </div>
    </>
  );
}
