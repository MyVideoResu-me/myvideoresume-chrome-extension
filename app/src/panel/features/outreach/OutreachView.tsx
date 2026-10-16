/**
 * Recruiter · Target: an intro to the candidate that shares the job —
 * personalized from the facts left on, carrying a link, typed into the
 * page's box (or the mail app) for the recruiter to send.
 */
import { useState } from "preact/hooks";
import { logInteraction } from "../../api/recruiter";
import { chipFacts, personalizeChips, type AttachmentKind } from "../../domain/outreach";
import { publicJobUrl } from "../../platform/web-links";
import { t } from "../../platform/i18n";
import { navigate } from "../../state/nav";
import { pairStore } from "../../state/pair";
import { useStore } from "../../state/store";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { NeedsCandidatePair } from "../candidate/NeedsCandidatePair";
import { candidateWorkStore, pairKey } from "../candidate/candidate-store";
import { Button } from "../../ui/controls";
import { ComposerActions } from "../message/ComposerActions";
import { ComposerCard } from "../message/ComposerCard";
import type { ChannelId } from "../message/channels";
import { useMessageComposer } from "../message/useComposeMessage";
import { AttachmentCard, type AttachmentOption } from "./AttachmentCard";
import { PersonalizeChips } from "./PersonalizeChips";

const FOLLOW_UP_DAYS = 4;
const CHANNELS: readonly ChannelId[] = ["email", "linkedinNote", "linkedinMessage"];

function followUpDate(): string {
  return new Date(Date.now() + FOLLOW_UP_DAYS * 86_400_000).toISOString();
}

export function OutreachView() {
  const { candidate, job } = useStore(pairStore, (s) => s);
  const videoLink = useStore(candidateWorkStore, (s) => s.videoLink);
  const [logTouch, setLogTouch] = useState(true);
  const [remind, setRemind] = useState(true);
  const [chipsOff, setChipsOff] = useState<ReadonlySet<string>>(new Set());
  const [attachment, setAttachment] = useState<AttachmentKind | null>(null);

  const chips = candidate && job ? personalizeChips(candidate, job) : [];
  const chipsOn = new Set(chips.map((c) => c.id).filter((id) => !chipsOff.has(id)));
  const candidateVideoUrl = candidate && job && videoLink?.key === pairKey(candidate, job.id) ? videoLink.url : null;
  const available: AttachmentOption[] = [
    ...(candidateVideoUrl ? [{ kind: "candidateVideo" as const, url: candidateVideoUrl }] : []),
    ...(job ? [{ kind: "jobPage" as const, url: publicJobUrl(job.id) }] : []),
    { kind: "none", url: null },
  ];
  const chosen = attachment ?? available[0].kind;
  const link = available.find((a) => a.kind === chosen)?.url ?? null;

  const facts = chipFacts(chips, chipsOn);
  const composer = useMessageComposer({
    channels: CHANNELS,
    initialChannel: "linkedinNote",
    onDelivered: (channel) => {
      if (!logTouch || !candidate?.talentPoolId || !job) return;
      void logInteraction({
        talentPoolId: candidate.talentPoolId,
        type: channel === "email" ? "email" : "linkedin",
        subject: t("outreach_logSubject", { job: job.title }),
        followUpDate: remind ? followUpDate() : undefined,
      }).catch(() => undefined);
    },
    spec: {
      recipient: {
        name: candidate?.profile.name ?? "",
        title: candidate?.profile.title,
        company: candidate?.profile.company,
        email: candidate?.profile.email,
      },
      jobTitle: job?.title,
      tone: "professional",
      link,
      context: [
        t("outreach_contextBase", { job: job?.title ?? "", company: job?.company ?? "", location: job?.location ?? "" }),
        facts ? t("outreach_contextFacts", { facts }) : "",
      ]
        .filter(Boolean)
        .join(" "),
    },
  });

  if (!candidate || !job) {
    return (
      <EmptyView title={t("outreach_title")}>
        <NeedsCandidatePair />
      </EmptyView>
    );
  }

  const { profile, talentPoolId } = candidate;
  const toggleChip = (id: string) =>
    setChipsOff((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <ViewHeader title={t("outreach_title_to", { name: profile.name })} subtitle={t("outreach_sharing", { job: job.title })} />
      <div class="view-body">
        <ComposerCard composer={composer}>
          <PersonalizeChips chips={chips} on={chipsOn} onToggle={toggleChip} />
        </ComposerCard>
        <AttachmentCard value={chosen} available={available} title={job.title} onChange={setAttachment} />
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
      <ComposerActions composer={composer} />
    </>
  );
}
