/**
 * detection-bus — lets the detectors (jobs / profiles / posts) tell the
 * in-page pill what they found, inside the tab. All of an extension's
 * content scripts share one isolated world, so a window global is the
 * bus; each detector is its own bundle, which is why it can't be a module
 * singleton. content-script-profiles.js (plain JS) calls the same global.
 *
 * In builds without the pill (legacy jobseeker / recruiter) nobody
 * listens and announcing is a no-op.
 */

export type DetectedKind = "job" | "profile" | "post";
export type DetectionListener = (kind: DetectedKind | null, payload: Record<string, unknown> | null) => void;

type Bus = { listeners: DetectionListener[] };

declare global {
  interface Window {
    __hiredVideoDetectionBus?: Bus;
    /** Called by content-script-profiles.js. */
    __hiredVideoDetected?: (kind: DetectedKind, payload: Record<string, unknown>) => void;
  }
}

function bus(): Bus {
  if (!window.__hiredVideoDetectionBus) {
    const b: Bus = { listeners: [] };
    window.__hiredVideoDetectionBus = b;
    window.__hiredVideoDetected = (kind, payload) => b.listeners.forEach((l) => l(kind, payload));
  }
  return window.__hiredVideoDetectionBus;
}

export function announceDetected(kind: DetectedKind, payload: Record<string, unknown>): void {
  bus().listeners.forEach((l) => l(kind, payload));
}

/** The page changed (SPA navigation) — whatever was found is gone. */
export function announceCleared(): void {
  bus().listeners.forEach((l) => l(null, null));
}

export function onDetection(listener: DetectionListener): void {
  bus().listeners.push(listener);
}
