/** Download a résumé in the person's format (non-PDF formats are Pro). */
import type { DownloadFormat } from "../../../shared/settings";
import { exportResume } from "../../api/resumes";
import { useIsPro } from "../../state/session";
import { settingsStore } from "../../state/settings";
import { useStore } from "../../state/store";
import { openTab } from "../../platform/chrome";

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

/** The format "Download" saves in for this person. */
export function useDownloadFormat(): DownloadFormat {
  const isPro = useIsPro();
  const preferred = useStore(settingsStore, (s) => s.settings.downloadFormat);
  return isPro ? preferred : "pdf";
}

export async function downloadResume(resumeId: string, title: string, format: DownloadFormat): Promise<void> {
  const out = await exportResume(resumeId, format, title || "resume");
  if (out.kind === "url") openTab(out.url);
  else saveBlob(out.blob, out.filename);
}
