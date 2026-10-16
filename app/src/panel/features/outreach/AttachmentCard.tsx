/**
 * The link an intro carries — the job's page, or the candidate-for-job
 * video when one was made — with Change to pick another (or none).
 */
import { useState } from "preact/hooks";
import { ATTACHMENTS, type AttachmentKind } from "../../domain/outreach";
import { t } from "../../platform/i18n";
import { Button } from "../../ui/controls";
import { Icon } from "../../ui/Icon";

export type AttachmentOption = { kind: AttachmentKind; url: string | null };

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

export function AttachmentCard({
  value,
  available,
  title,
  onChange,
}: {
  value: AttachmentKind;
  /** The kinds that have a link right now ("none" always does). */
  available: ReadonlyArray<AttachmentOption>;
  title: string;
  onChange: (kind: AttachmentKind) => void;
}) {
  const [picking, setPicking] = useState(false);
  const current = available.find((a) => a.kind === value);
  const def = ATTACHMENTS.find((a) => a.id === value);

  return (
    <div class="attach-card">
      <div class="attach-row">
        <span class="video-thumb" aria-hidden="true">
          <Icon name={value === "none" ? "link" : "play"} size={14} />
        </span>
        <span class="attach-text">
          <b>{value === "none" ? t("outreach_attachNone") : t(def?.labelKey ?? "outreach_attachNone")}</b>
          <span class="muted small">{current?.url ? shortUrl(current.url) : title}</span>
        </span>
        <Button size="sm" aria-expanded={picking} aria-label={t("outreach_attachChangeLabel")} onClick={() => setPicking((p) => !p)}>
          {t("outreach_attachChange")}
        </Button>
      </div>
      {picking ? (
        <div class="stack-sm" role="radiogroup" aria-label={t("outreach_attachChangeLabel")}>
          {ATTACHMENTS.filter((a) => available.some((o) => o.kind === a.id)).map((a) => (
            <button
              type="button"
              key={a.id}
              role="radio"
              aria-checked={a.id === value}
              class={`job-opt ${a.id === value ? "on" : ""}`}
              onClick={() => {
                onChange(a.id);
                setPicking(false);
              }}
            >
              <b>{t(a.labelKey)}</b>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
