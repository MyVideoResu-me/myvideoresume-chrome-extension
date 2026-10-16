/**
 * Sales & social · Target + Promote: a short "promote your skills" video
 * made for the person on this profile, and a message carrying its link —
 * typed into LinkedIn's box for the person to send. One person at a time.
 */
import { useEffect, useState } from "preact/hooks";
import { resumeToText } from "../../domain/resume-docs";
import { pageStore } from "../../state/page";
import { activeResume, resumeContent, resumesStore } from "../../state/resumes";
import { useStore } from "../../state/store";
import { t } from "../../platform/i18n";
import { EmptyView } from "../../shell/EmptyView";
import { ViewHeader } from "../../shell/ViewHeader";
import { Card, Eyebrow } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { MessageComposer } from "../message/MessageComposer";
import { useDailyCount } from "../message/useDailyCount";
import { NeedsResume } from "../resumes/NeedsResume";
import { VideoBuilder } from "../video/VideoBuilder";
import type { VideoSpec } from "../video/useVideoProject";
import { SkillPicker, useResumeSkills } from "./SkillPicker";

export function ProspectView() {
  const prospect = useStore(pageStore, (s) => (s.entity?.kind === "profile" ? s.entity : null));
  const resume = useStore(resumesStore, activeResume);
  const skills = useResumeSkills(resume?.id ?? null);
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const sent = useDailyCount("pitch");

  useEffect(() => setPicked(skills.slice(0, 3)), [skills]);

  if (!prospect) {
    return <EmptyView title={t("prospect_title")}>{t("prospect_needProfile")}</EmptyView>;
  }

  const featured = picked.join(", ");
  const spec: VideoSpec = {
    purpose: "pitch",
    name: t("prospect_videoName", { name: prospect.name }),
    targetDuration: 40,
    source: async () => {
      if (!resume) throw new Error("no résumé");
      return {
        resumeText: resumeToText(await resumeContent(resume.id)),
        resumeId: resume.id,
        prompt: t("prospect_prompt", {
          name: prospect.name,
          title: prospect.title,
          company: prospect.company,
          skills: featured,
        }),
      };
    },
  };

  return (
    <>
      <ViewHeader title={t("prospect_title")} subtitle={t("prospect_for", { name: prospect.name })} />
      <div class="view-body">
        <NeedsResume />
        <Card>
          <div class="detected-row">
            <span class="entity-icon entity-promote">
              <Icon name="user" />
            </span>
            <div class="detected-text">
              <div class="detected-title">{prospect.name}</div>
              <div class="muted small">{[prospect.title, prospect.company].filter(Boolean).join(" · ")}</div>
            </div>
          </div>
        </Card>
        {resume ? (
          <>
            <Eyebrow>{t("prospect_skills")}</Eyebrow>
            <SkillPicker skills={skills} picked={picked} onChange={setPicked} />
            <VideoBuilder spec={spec} onShareUrl={setLink} />
            <MessageComposer
              channels={["linkedinMessage", "linkedinNote", "email"]}
              onDelivered={sent.increment}
              spec={{
                recipient: { name: prospect.name, title: prospect.title, company: prospect.company },
                tone: "friendly",
                link,
                context: t("prospect_context", { skills: featured, title: prospect.title, company: prospect.company }),
              }}
            />
            <p class="muted small row">
              <Icon name="clock" />
              {t("prospect_sentToday", { count: sent.count })}
            </p>
          </>
        ) : null}
      </div>
    </>
  );
}
