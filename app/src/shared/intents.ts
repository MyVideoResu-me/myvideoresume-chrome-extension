/**
 * What the in-page pill asks the side panel to do. Shared by the pill
 * (content/pill.ts), the service worker (app/service-worker.js parks it
 * under PENDING_INTENT_KEY — keep the key in step) and the panel.
 */
export const PENDING_INTENT_KEY = "pendingPanelIntent";

export type PillIntent = {
  action: "open" | "track" | "strengthen" | "candidate" | "pitch" | "reply";
};
