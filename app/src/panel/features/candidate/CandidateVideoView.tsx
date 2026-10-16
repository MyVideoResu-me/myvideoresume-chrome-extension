/**
 * Recruiter · Promote: the candidate's résumé (built from their profile),
 * tailored to the paired job, as a video for the hiring manager — a private
 * link, anonymized for a blind shortlist, or (only once the candidate
 * approves) a public post.
 */
import { useState } from "preact/hooks";
import type { Job } from "../../api/jobs";
import type { CapturedCandidate } from "../../api/recruiter";
import type { ResumeContent } from "@shared/resume";
import { profileToResume } from "../../domain/resume-docs";
import { videoTitle } from "../../domain/video-meta";
import { copyText, openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { studioProjectUrl } from "../../platform/web-links";
import { pairStore } from "../../state/pair";
import { useStore } from "../../state/store";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Spinner } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { RadioCards } from "../../ui/RadioCards";
import { RenderPreview, renderStageOf } from "../../ui/RenderPreview";
import { candidateWorkStore, pairKey } from "./candidate-store";
import { CandidatePublish } from "./CandidatePublish";
import { CandidateTimeline } from "./CandidateTimeline";
import { ConsentPanel, ConsentPill } from "./ConsentPanel";
import { NeedsCandidatePair } from "./NeedsCandidatePair";
import { useCandidatePublish } from "./useCandidatePublish";
import { CANDIDATE_VIDEO_SECONDS, useCandidateVideo, type Audience } from "./useCandidateVideo";
import { CandidateNotSavedError, useTailorCandidate } from "./useCandidate";
import { useConsent } from "./useConsent";

type Visibility = "named" | "anonymized" | "public";

const AUDIENCE: Record<Visibility, Audience> = { named: "named", anonymized: "anonymized", public: "named" };

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function CandidateVideoFlow({
  candidate,
  job,
  candidateResume,
  visibility,
  onVisibility,
}: {
  candidate: CapturedCandidate;
  job: Job;
  candidateResume: ResumeContent | null;
  visibility: Visibility;
  onVisibility: (v: Visibility) => void;
}) {
  const { spec, video, projectId, shareUrl } = useCandidateVideo(candidate, job, candidateResume, AUDIENCE[visibility]);
  const tailor = useTailorCandidate();
  const changes = useStore(candidateWorkStore, (s) =>
    s.tailorChanges?.key === pairKey(candidate, job.id) ? s.tailorChanges.changes : [],
  );
  const consent = useConsent(projectId, candidate);
  const publish = useCandidatePublish(projectId, spec.name, consent.refused);
  const [copied, setCopied] = useState(false);
  const name = firstName(candidate.profile.name);
  const stage = renderStageOf(video);

  const options = [
    { value: "named" as const, label: t("candidateVideo_named"), hint: t("candidateVideo_namedHint") },
    { value: "anonymized" as const, label: t("candidateVideo_anonymized"), hint: t("candidateVideo_anonymizedHint") },
    {
      value: "public" as const,
      label: t("candidateVideo_public"),
      hint: t("candidateVideo_publicHint", { name }),
      badge: <ConsentPill consent={consent.current} askAgain={!!consent.askAgain} />,
    },
  ];

  return (
    <>
      <div class="view-body">
        <RenderPreview title={videoTitle(video.script, spec.name)} stage={stage} videoUrl={video.videoUrl} />
        <CandidateTimeline
          resume={candidateResume ?? profileToResume(candidate.profile)}
          tailored={!!candidateResume}
          changes={changes}
          tailor={tailor}
          script={video.script}
          seconds={Math.round(video.script?.video.duration ?? CANDIDATE_VIDEO_SECONDS)}
          rendered={!!video.videoUrl}
        />
        <RadioCards
          name="candidate-visibility"
          legend={t("candidateVideo_who")}
          value={visibility}
          options={options}
          onChange={onVisibility}
        />
        {visibility === "public" ? (
          consent.approved && projectId ? (
            <CandidatePublish publish={publish} projectId={projectId} rendered={!!video.videoUrl} />
          ) : (
            <ConsentPanel
              consent={consent}
              name={name}
              poolEmail={candidate.poolEmail ?? null}
              defaultEmail={candidate.profile.email}
              hasProject={!!projectId}
              poolKnown={!!candidate.talentPoolId}
            />
          )
        ) : null}
        {video.write.busy ? <Spinner label={t("video_writing")} /> : null}
        {video.openInStudio.error instanceof CandidateNotSavedError ? (
          <p class="small text-warn" role="alert">
            {t("candidateVideo_saveFirst", { name: candidate.profile.name })}
          </p>
        ) : (
          <ErrorNotice error={video.write.error ?? video.openInStudio.error} fallback="error_readPage" />
        )}
      </div>

      <footer class="view-footer">
        {!video.script ? (
          <Button variant="promote" block icon="video" busy={video.write.busy} onClick={() => void video.write.run()}>
            {t("video_write")}
          </Button>
        ) : !projectId ? (
          <Button variant="promote" block icon="video" busy={video.openInStudio.busy} onClick={() => void video.openInStudio.run()}>
            {t("video_openStudio")}
          </Button>
        ) : (
          <div class="row">
            <Button icon="external" onClick={() => openTab(studioProjectUrl(projectId))}>
              {t("common_openStudio")}
            </Button>
            <Button
              variant="promote"
              block
              icon={copied ? "check" : "link"}
              disabled={!shareUrl}
              onClick={() => shareUrl && void copyText(shareUrl).then(setCopied)}
            >
              {copied ? t("common_copied") : t("candidateVideo_copyLink")}
            </Button>
          </div>
        )}
        <div class="muted small center">
          {video.videoUrl
            ? t("video_ready")
            : projectId
              ? t("video_waiting")
              : video.script
                ? t("candidateVideo_linkAfterSave")
                : t("video_rendersInBrowser")}
        </div>
      </footer>
    </>
  );
}

export function CandidateVideoView() {
  const { candidate, job, candidateResume } = useStore(pairStore, (s) => s);
  const [visibility, setVisibility] = useState<Visibility>("named");

  if (!candidate || !job) {
    return (
      <EmptyView title={t("candidateVideo_title")}>
        <NeedsCandidatePair />
      </EmptyView>
    );
  }

  return (
    <>
      <ViewHeader
        title={t("candidateVideo_title")}
        subtitle={t("candidateVideo_for", { name: candidate.profile.name, job: job.title })}
      />
      {/* Named vs anonymized are different videos; public shares the named one. */}
      <CandidateVideoFlow
        key={AUDIENCE[visibility]}
        candidate={candidate}
        job={job}
        candidateResume={candidateResume}
        visibility={visibility}
        onVisibility={setVisibility}
      />
    </>
  );
}
