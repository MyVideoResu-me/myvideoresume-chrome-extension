/** Recruiter · Create: capture the candidate on this page and pair them with a job. */
import type { ComponentChildren } from "preact";
import { navigate } from "../../state/nav";
import { pageStore } from "../../state/page";
import { pairStore } from "../../state/pair";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Button, Card, Eyebrow } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { JobPicker } from "./JobPicker";
import { useCandidateFor, useCaptureCandidate } from "./useCandidate";

function Line({ ok, children }: { ok: boolean; children: ComponentChildren }) {
  return (
    <li class={ok ? "line-ok" : "line-need"}>
      <span class="fill-dot" aria-hidden="true">
        {ok ? <Icon name="check" size={11} /> : "!"}
      </span>
      {children}
    </li>
  );
}

export function CandidateView() {
  const profile = useStore(pageStore, (s) => (s.entity?.kind === "profile" ? s.entity : null));
  const candidate = useCandidateFor(profile);
  const job = useStore(pairStore, (s) => s.job);
  const { capture, findEmail } = useCaptureCandidate();
  const name = candidate?.profile.name || profile?.name || t("candidate_none");

  return (
    <>
      <ViewHeader title={t("candidate_title")} />
      <div class="view-body">
        <Eyebrow>{t("candidate_onPage")}</Eyebrow>
        <Card>
          <div class="detected-row">
            <span class="entity-icon entity-person">
              <Icon name="user" />
            </span>
            <div class="detected-text">
              <div class="detected-title">{name}</div>
              <div class="muted small">
                {[candidate?.profile.title || profile?.title, candidate?.profile.location || profile?.location]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
            {candidate ? null : (
              <Button variant="primary" size="sm" busy={capture.busy} disabled={!profile} onClick={() => void capture.run()}>
                {t("candidate_save")}
              </Button>
            )}
          </div>
          {candidate ? (
            <ul class="checklist">
              <Line ok>{t("candidate_roles", { count: candidate.profile.experience.length })}</Line>
              <Line ok>{t("candidate_skills", { count: candidate.profile.skills.length })}</Line>
              <Line ok>{t("candidate_resumeDrafted")}</Line>
              <Line ok={!!candidate.profile.email}>
                {candidate.profile.email ?? t("candidate_noEmail")}
                {candidate.profile.email ? null : (
                  <Button size="sm" busy={findEmail.busy} onClick={() => void findEmail.run()}>
                    {t("candidate_findEmail")}
                  </Button>
                )}
              </Line>
            </ul>
          ) : null}
          {findEmail.error ? <ErrorNotice error={findEmail.error} /> : null}
          <ErrorNotice error={capture.error} fallback="error_readPage" />
        </Card>

        {candidate ? (
          <>
            <Eyebrow>{t("candidate_pairJob")}</Eyebrow>
            <JobPicker />
          </>
        ) : null}
      </div>
      {candidate ? (
        <footer class="view-footer">
          <Button variant="primary" block iconAfter="forward" disabled={!job} onClick={() => navigate("outreach")}>
            {t("action_outreach")}
          </Button>
          <Button block accent="promote" icon="video" disabled={!job} onClick={() => navigate("candidateVideo")}>
            {t("action_candidateVideo")}
          </Button>
        </footer>
      ) : null}
    </>
  );
}
