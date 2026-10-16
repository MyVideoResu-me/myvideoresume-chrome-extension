/**
 * "We mark the job Applied when you do." After the panel fills a form,
 * the autofill content script reports the person's own submit
 * (`applicationSubmitted`); if it came from the page we filled, the job
 * moves to Applied. Nothing here submits anything.
 */
import { onRuntimeMessage } from "../platform/chrome";
import { changeJobStatus, jobsStore } from "./jobs";

let armed: { jobId: string; origin: string } | null = null;
let listening = false;

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

async function markApplied(jobId: string): Promise<void> {
  const job = jobsStore.get().saved.find((j) => j.id === jobId);
  // Never move a job backwards (an interview stays an interview).
  if (job?.pipelineStatus && job.pipelineStatus !== "tracked") return;
  await changeJobStatus(jobId, "applied");
}

export function watchForSubmit(jobId: string, pageUrl: string): void {
  armed = { jobId, origin: originOf(pageUrl) };
  if (listening) return;
  listening = true;
  onRuntimeMessage((msg) => {
    if (msg.action !== "applicationSubmitted" || !armed) return;
    if (originOf(String(msg.url ?? "")) !== armed.origin) return;
    const { jobId: id } = armed;
    armed = null;
    void markApplied(id).catch(() => undefined);
  });
}
