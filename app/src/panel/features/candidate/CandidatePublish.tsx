/** After the candidate approved: make the video public, then post it. (A consent refusal is handled by the hook — never shown as an error here.) */
import { t } from "../../platform/i18n";
import { Button } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { PlatformButtons } from "../video/PlatformButtons";
import { consentRefusal } from "../../domain/consent";
import type { CandidatePublish as Publish } from "./useCandidatePublish";

export function CandidatePublish({
  publish,
  projectId,
  rendered,
}: {
  publish: Publish;
  projectId: string;
  rendered: boolean;
}) {
  const { social, makePublic } = publish;
  if (!publish.isPublic) {
    return (
      <div class="stack-sm">
        <Button variant="promote" block icon="share" busy={makePublic.busy} onClick={() => void makePublic.run()}>
          {t("candidateVideo_makePublic")}
        </Button>
        {consentRefusal(makePublic.error) ? null : <ErrorNotice error={makePublic.error} />}
      </div>
    );
  }
  if (!rendered) return <p class="muted small">{t("candidateVideo_publicAfterRender")}</p>;
  return (
    <div class="stack-sm">
      <div class="strong">{t("video_postTo")}</div>
      <PlatformButtons social={social} projectId={projectId} />
      {consentRefusal(social.post.error) ? null : <ErrorNotice error={social.post.error ?? social.connect.error} />}
    </div>
  );
}
