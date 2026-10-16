/**
 * Put the working résumé (the version tailored to this job) into the
 * form's file input. Only a real PDF is attached; when the export isn't
 * one, the row offers "Download" so the person attaches it themselves.
 */
import { exportResume } from "../../api/resumes";
import { sendToWorker } from "../../platform/chrome";
import type { FillOutcome } from "./readiness";

async function resumePdf(resume: { id: string; title: string }): Promise<{ blob: Blob; filename: string } | null> {
  const out = await exportResume(resume.id, "pdf", resume.title || "resume");
  const file =
    out.kind === "file"
      ? { blob: out.blob, filename: out.filename }
      : await fetch(out.url).then(async (r) => (r.ok ? { blob: await r.blob(), filename: `${resume.title || "resume"}.pdf` } : null));
  if (!file) return null;
  const isPdf = file.blob.type.includes("pdf") || /\.pdf$/i.test(file.filename);
  return isPdf ? { blob: new Blob([file.blob], { type: "application/pdf" }), filename: file.filename.replace(/\.[^.]+$/, "") + ".pdf" } : null;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export async function attachResumeFile(resume: { id: string; title: string }, fieldId: string): Promise<FillOutcome> {
  const pdf = await resumePdf(resume).catch(() => null);
  if (!pdf) return "download";
  const reply = await sendToWorker<{ ok?: boolean }>({
    action: "attachFormFile",
    fieldId,
    name: pdf.filename,
    mime: "application/pdf",
    base64: toBase64(new Uint8Array(await pdf.blob.arrayBuffer())),
  });
  return reply?.ok ? "attached" : "download";
}
