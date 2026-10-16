/** Recruiter · Target: an intro to the candidate that shares the job. */
import { useState } from "preact/hooks";
import { logInteraction } from "../../api/recruiter";
import { navigate } from "../../state/nav";
import { pairStore } from "../../state/pair";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { NeedsCandidatePair } from "../candidate/NeedsCandidatePair";
import { Button } from "../../ui/controls";
import { MessageComposer } from "../message/MessageComposer";
import type { ChannelId } from "../message/channels";

const FOLLOW_UP_DAYS = 4;

function followUpDate(): string {
  return new Date(Date.now() + FOLLOW_UP_DAYS * 86_400_000).toISOString();
}

export function OutreachView() {
  const { candidate, job } = useStore(pairStore, (s) => s);
  const [logTouch, setLogTouch] = useState(true);
  const [remind, setRemind] = useState(true);

  if (!candidate || !job) {
    return (
      <EmptyView title={t("outreach_title")}>
        <NeedsCandidatePair />
      </EmptyView>
    );
  }

  const { profile, talentPoolId } = candidate;
  const onDelivered = (channel: ChannelId) => {
    if (!logTouch || !talentPoolId) return;
    void logInteraction({
      talentPoolId,
      type: channel === "email" ? "email" : "linkedin",
      subject: t("outreach_logSubject", { job: job.title }),
      followUpDate: remind ? followUpDate() : undefined,
    }).catch(() => undefined);
  };

  return (
    <>
      <ViewHeader title={t("outreach_title_to", { name: profile.name })} subtitle={t("outreach_sharing", { job: job.title })} />
      <div class="view-body">
        <MessageComposer
          channels={["linkedinNote", "linkedinMessage", "email"]}
          onDelivered={onDelivered}
          spec={{
            recipient: { name: profile.name, title: profile.title, company: profile.company, email: profile.email },
            jobTitle: job.title,
            tone: "professional",
            context: t("outreach_context", {
              job: job.title,
              company: job.company,
              location: job.location,
              skills: profile.skills.slice(0, 8).join(", "),
              summary: profile.summary.slice(0, 400),
            }),
          }}
        />
        {talentPoolId ? (
          <div class="stack-sm small">
            <label class="row">
              <input type="checkbox" checked={logTouch} onChange={(e) => setLogTouch(e.currentTarget.checked)} />
              {t("outreach_logTouch", { name: profile.name })}
            </label>
            <label class="row">
              <input
                type="checkbox"
                checked={remind}
                disabled={!logTouch}
                onChange={(e) => setRemind(e.currentTarget.checked)}
              />
              {t("outreach_remind", { days: FOLLOW_UP_DAYS })}
            </label>
          </div>
        ) : null}
        <Button size="sm" accent="promote" icon="video" onClick={() => navigate("candidateVideo")}>
          {t("outreach_videoInstead")}
        </Button>
      </div>
    </>
  );
}
