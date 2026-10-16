/** Extension preferences on the account (shared with the web /settings page). */
import type { ExtensionSettings } from "../../shared/settings";
import { request } from "./http";

/** The object lives under the `jobseeker` key for every lens (legacy name). */
const SCOPE = "jobseeker";

export async function fetchPreferences(): Promise<ExtensionSettings | null> {
  const out = await request<Record<string, ExtensionSettings | undefined>>("/api/settings/extension-preferences");
  return out?.[SCOPE] ?? null;
}

export function savePreferences(settings: ExtensionSettings): Promise<unknown> {
  return request("/api/settings/extension-preferences", { method: "PUT", body: { [SCOPE]: settings } });
}
