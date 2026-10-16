/**
 * The person's extension settings: local first (content scripts read the
 * same storage key), then reconciled with the account copy so the web
 * /settings page and the panel agree. Writes go to both.
 */
import { fetchPreferences, savePreferences } from "../api/preferences";
import { sendToWorker, storageGet, storageSet } from "../platform/chrome";
import { SETTINGS_KEY, withDefaults, type ExtensionSettings } from "../../shared/settings";
import { createStore } from "./store";

export const settingsStore = createStore<{ settings: Required<ExtensionSettings> }>({ settings: withDefaults(null) });

export async function loadSettings(): Promise<void> {
  const local = await storageGet<ExtensionSettings>(SETTINGS_KEY);
  settingsStore.set({ settings: withDefaults(local) });
  const server = await fetchPreferences().catch(() => null);
  if (!server) return;
  const merged = withDefaults({ ...local, ...server });
  settingsStore.set({ settings: merged });
  await storageSet({ [SETTINGS_KEY]: merged });
}

export async function updateSettings(patch: ExtensionSettings): Promise<void> {
  const next = { ...settingsStore.get().settings, ...patch };
  settingsStore.set({ settings: next });
  await storageSet({ [SETTINGS_KEY]: next });
  await savePreferences(next).catch(() => undefined);
  // An open web /settings tab re-reads.
  void sendToWorker({ action: "broadcastToWebApp", type: "settings-changed" });
}
