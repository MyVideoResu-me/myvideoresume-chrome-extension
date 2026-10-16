/**
 * Intents from the in-page pill ("Track", "Tailor résumé", …). The service
 * worker parks the latest one in session storage (panel still booting) and
 * broadcasts it (panel already open); either way it becomes a route.
 */
import type { RouteName } from "../domain/routes";
import { onRuntimeMessage, takeSessionValue } from "../platform/chrome";
import { PENDING_INTENT_KEY, type PillIntent } from "../../shared/intents";
import { ensureTrackedJob } from "./job-capture";
import { navigate } from "./nav";
import { pageStore, scanPage } from "./page";

const INTENT_ROUTE: Record<PillIntent["action"], RouteName> = {
  open: "home",
  track: "job",
  strengthen: "strengthen",
  candidate: "candidate",
  pitch: "prospect",
  reply: "postReply",
};

async function apply(intent: PillIntent | undefined): Promise<void> {
  if (!intent?.action || !(intent.action in INTENT_ROUTE)) return;
  navigate(INTENT_ROUTE[intent.action]);
  await scanPage();
  // "Track" from the pill tracks right away; the job screen shows the result.
  const entity = pageStore.get().entity;
  if (intent.action === "track" && entity?.kind === "job") await ensureTrackedJob(entity).catch(() => undefined);
}

export function startIntents(): void {
  void takeSessionValue<PillIntent>(PENDING_INTENT_KEY).then((i) => apply(i));
  onRuntimeMessage((msg) => {
    if (msg.action === "panelIntent") {
      void apply(msg.intent as PillIntent);
      void takeSessionValue(PENDING_INTENT_KEY);
    }
  });
}
