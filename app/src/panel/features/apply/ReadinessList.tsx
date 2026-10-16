/** "Application form on this page · 9 of 11 ready": what we'll fill, what's yours to answer. */
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { setTab } from "../../state/nav";
import { t } from "../../platform/i18n";
import { Button, TextField } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { DownloadButton } from "../resumes/DownloadButton";
import type { ReadinessRow } from "./readiness";

function Line({ ok, children, action }: { ok: boolean; children: ComponentChildren; action?: ComponentChildren }) {
  return (
    <li class={ok ? "fill-filled" : "fill-need"}>
      <span class="fill-dot" aria-hidden="true">
        {ok ? <Icon name="check" size={11} /> : "!"}
      </span>
      <span class="fill-label">{children}</span>
      {action}
    </li>
  );
}

function AnswerRow({ row, onSave }: { row: Extract<ReadinessRow, { kind: "need" }>; onSave: (label: string, v: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(row.answer);
  const ok = !!row.answer && !row.failed;
  return (
    <>
      <Line
        ok={ok}
        action={
          editing ? null : (
            <Button size="sm" onClick={() => setEditing(true)}>
              {row.answer ? t("common_edit") : t("apply_answer")}
            </Button>
          )
        }
      >
        {row.label}
        {row.answer ? <span class="muted"> · {row.answer}</span> : null}
        {row.failed ? <span class="muted small"> · {t("apply_rowError")}</span> : null}
      </Line>
      {editing ? (
        <li class="fill-edit">
          <form
            class="row grow"
            onSubmit={(e) => {
              e.preventDefault();
              void onSave(row.label, value).then(() => setEditing(false));
            }}
          >
            <div class="grow">
              <TextField id={`answer-${row.fieldId}`} label={row.label} value={value} onInput={setValue} />
            </div>
            <Button size="sm" variant="primary" type="submit">
              {t("common_save")}
            </Button>
          </form>
        </li>
      ) : null}
    </>
  );
}

export function ReadinessList({
  rows,
  resume,
  onAnswer,
}: {
  rows: readonly ReadinessRow[];
  resume: { id: string; title: string; tailored: boolean };
  onAnswer: (label: string, value: string) => Promise<void>;
}) {
  return (
    <ul class="fill-list">
      {rows.map((row) => {
        switch (row.kind) {
          case "profile":
            return (
              <Line key="profile" ok>
                {row.labels.join(", ")}
              </Line>
            );
          case "resume": {
            const needsDownload = row.outcome === "download";
            return (
              <Line
                key={row.fieldId}
                ok={!needsDownload}
                action={needsDownload ? <DownloadButton resumeId={resume.id} title={resume.title} size="sm" /> : null}
              >
                {resume.tailored ? t("apply_resumeTailored") : t("apply_resumeFile", { resume: resume.title })}
                {row.outcome === "attached" ? <span class="muted small"> · {t("apply_attached")}</span> : null}
              </Line>
            );
          }
          case "letter":
            return (
              <Line
                key={row.fieldId}
                ok={row.ready}
                action={
                  row.ready ? null : (
                    <Button size="sm" onClick={() => setTab("cover")}>
                      {t("apply_writeLetter")}
                    </Button>
                  )
                }
              >
                {row.ready ? t("apply_usesLetter") : t("apply_noLetter")}
              </Line>
            );
          case "need":
            return <AnswerRow key={row.fieldId} row={row} onSave={onAnswer} />;
        }
      })}
    </ul>
  );
}
