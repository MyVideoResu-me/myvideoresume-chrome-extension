/**
 * Extension settings shared by the panel and the content scripts. Stored
 * under `settings` in chrome.storage.local (the key the legacy panel and
 * extension-telemetry.js read) and mirrored to the account under
 * `jobseeker` in /api/settings/extension-preferences (the web /settings
 * page edits the same object).
 */
export const SETTINGS_KEY = "settings";

export const DOWNLOAD_FORMATS = ["pdf", "docx", "md", "txt"] as const;
export type DownloadFormat = (typeof DOWNLOAD_FORMATS)[number];

export type ExtensionSettings = {
  /** Detect jobs / profiles / posts on pages. */
  autoDetect?: boolean;
  /** Draw the in-page pill when something is detected. */
  showPill?: boolean;
  /** Check my fit as soon as a job is detected. */
  autoScore?: boolean;
  /** Pro: start tailoring as soon as I open Strengthen. */
  autoTailor?: boolean;
  telemetryOptOut?: boolean;
  /** Pro for anything but pdf. */
  downloadFormat?: DownloadFormat;
};

export const DEFAULT_SETTINGS: Required<ExtensionSettings> = {
  autoDetect: true,
  showPill: true,
  autoScore: false,
  autoTailor: false,
  telemetryOptOut: false,
  downloadFormat: "pdf",
};

export function withDefaults(settings: ExtensionSettings | null | undefined): Required<ExtensionSettings> {
  return { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
}

/** The pill shows unless the person turned it (or auto-detect) off. */
export function readPillEnabled(settings: ExtensionSettings | null | undefined): boolean {
  const s = withDefaults(settings);
  return s.autoDetect && s.showPill;
}

/** Key the panel stores the chosen lens under (state/lens.ts writes it). */
export const LENS_KEY = "appLens";
