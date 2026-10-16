/** Download a résumé in the person's format (non-PDF formats are Pro). */
import { exportResume } from "../../api/resumes";
import { useIsPro } from "../../state/session";
import { settingsStore } from "../../state/settings";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { Button } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function DownloadButton({ resumeId, title, size }: { resumeId: string; title: string; size?: "md" | "sm" }) {
  const isPro = useIsPro();
  const preferred = useStore(settingsStore, (s) => s.settings.downloadFormat);
  const format = isPro ? preferred : "pdf";
  const download = useAction(async () => {
    const out = await exportResume(resumeId, format, title || "resume");
    if (out.kind === "url") openTab(out.url);
    else saveBlob(out.blob, out.filename);
  });
  return (
    <>
      <Button icon="download" size={size} busy={download.busy} onClick={() => void download.run()}>
        {t("resumes_download", { format: format.toUpperCase() })}
      </Button>
      <ErrorNotice error={download.error} />
    </>
  );
}
