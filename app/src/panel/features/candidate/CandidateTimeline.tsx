/**
 * The candidate video's steps — extracted, résumé built, tailored, video —
 * each with what you can look at (View the résumé, Diff the tailoring, the
 * Script). One panel open at a time, under the steps.
 */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { ResumeContent } from "@shared/resume";
import type { TailorChange } from "@shared/resume-tailor";
import type { VideoScript } from "../../api/studio";
import { resumeToText } from "../../domain/resume-docs";
import { t, type MessageKey } from "../../platform/i18n";
import { Button } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { Icon } from "../../ui/Icon";
import { ScriptCard } from "../video/ScriptCard";

type PanelId = "view" | "diff" | "script";

function Step({
  n,
  done,
  current,
  children,
  panel,
  open,
  onToggle,
}: {
  n: number;
  done: boolean;
  current?: boolean;
  children: ComponentChildren;
  panel?: { id: PanelId; labelKey: MessageKey };
  open: PanelId | null;
  onToggle: (id: PanelId) => void;
}) {
  return (
    <li class={done ? "line-ok" : current ? "line-current" : "line-need"}>
      <span class="fill-dot" aria-hidden="true">
        {done ? <Icon name="check" size={11} /> : n}
      </span>
      <span class="fill-label">{children}</span>
      {panel ? (
        <Button size="sm" aria-expanded={open === panel.id} onClick={() => onToggle(panel.id)}>
          {t(panel.labelKey)}
        </Button>
      ) : null}
    </li>
  );
}

export function CandidateTimeline({
  resume,
  tailored,
  changes,
  tailor,
  script,
  seconds,
  rendered,
}: {
  /** The résumé the video is made from (tailored when done). */
  resume: ResumeContent;
  tailored: boolean;
  changes: readonly TailorChange[];
  tailor: { run: () => unknown; busy: boolean; error: unknown };
  script: VideoScript | null;
  seconds: number;
  rendered: boolean;
}) {
  const [open, setOpen] = useState<PanelId | null>(null);
  const toggle = (id: PanelId) => setOpen((cur) => (cur === id ? null : id));

  return (
    <div class="card">
      <ul class="checklist">
        <Step n={1} done open={open} onToggle={toggle}>
          {t("candidateVideo_extracted")}
        </Step>
        <Step n={2} done open={open} onToggle={toggle} panel={{ id: "view", labelKey: "candidateVideo_view" }}>
          {t("candidateVideo_built")}
        </Step>
        <Step
          n={3}
          done={tailored}
          open={open}
          onToggle={toggle}
          panel={tailored && changes.length ? { id: "diff", labelKey: "candidateVideo_diff" } : undefined}
        >
          {tailored ? t("candidateVideo_tailoredCount", { count: changes.length }) : t("candidateVideo_tailor")}
          {tailored ? null : (
            <Button size="sm" busy={tailor.busy} onClick={() => void tailor.run()}>
              {t("candidateVideo_tailorBtn")}
            </Button>
          )}
        </Step>
        <Step
          n={4}
          done={rendered}
          current={!rendered}
          open={open}
          onToggle={toggle}
          panel={script ? { id: "script", labelKey: "candidateVideo_script" } : undefined}
        >
          {t("candidateVideo_videoStep", { seconds })}
        </Step>
      </ul>
      <ErrorNotice error={tailor.error} />

      {open === "view" ? <pre class="timeline-panel pre-line">{resumeToText(resume)}</pre> : null}
      {open === "diff" ? (
        <ul class="timeline-panel recs">
          {changes.map((c, i) => (
            <li key={i}>
              {c.before ? <span class="diff-del">{c.before}</span> : null}
              <span class="diff-add">{c.after}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {open === "script" && script ? <ScriptCard script={script} /> : null}
    </div>
  );
}
