/**
 * Typed port over shared/extension-telemetry.js (loaded by the panel HTML
 * before this bundle): session events for the SuperAdmin extension viewer
 * and per-host learned picker selectors. Opt-out is enforced inside it.
 */
type TelemetryApi = {
  record: (kind: string, attrs?: { url?: string; host?: string; payload?: Record<string, unknown> }) => void;
  saveLearned: (host: string, mode: string, fields: Record<string, unknown>) => Promise<void>;
};

declare global {
  interface Window {
    HiredVideoTelemetry?: TelemetryApi;
  }
}

export function hostOf(url: string | null | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export function recordEvent(kind: string, url: string | null | undefined, payload?: Record<string, unknown>): void {
  window.HiredVideoTelemetry?.record(kind, { url: url ?? undefined, host: hostOf(url), payload });
}

export function saveLearnedSelectors(host: string, mode: string, fields: Record<string, unknown>): void {
  void window.HiredVideoTelemetry?.saveLearned(host, mode, fields).catch?.(() => undefined);
}
