/**
 * Extension settings shared by the panel and the content scripts. Stored
 * under `settings` in chrome.storage.local (the legacy panels' key).
 */
export const SETTINGS_KEY = "settings";

export type ExtensionSettings = {
  autoDetect?: boolean;
  showPill?: boolean;
};

/** The pill shows unless the person turned it (or auto-detect) off. */
export function readPillEnabled(settings: ExtensionSettings | null | undefined): boolean {
  return settings?.autoDetect !== false && settings?.showPill !== false;
}

/** Key the panel stores the chosen lens under (state/lens.ts writes it). */
export const LENS_KEY = "appLens";
