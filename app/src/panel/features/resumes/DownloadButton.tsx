/** "Download PDF" for one résumé. */
import { t } from "../../platform/i18n";
import { Button } from "../../ui/controls";
import { ErrorNotice } from "../../ui/ErrorNotice";
import { useAction } from "../../ui/useAction";
import { downloadResume, useDownloadFormat } from "./useDownload";

export function DownloadButton({ resumeId, title, size }: { resumeId: string; title: string; size?: "md" | "sm" }) {
  const format = useDownloadFormat();
  const download = useAction(() => downloadResume(resumeId, title, format));
  return (
    <>
      <Button icon="download" size={size} busy={download.busy} onClick={() => void download.run()}>
        {t("resumes_download", { format: format.toUpperCase() })}
      </Button>
      <ErrorNotice error={download.error} />
    </>
  );
}
