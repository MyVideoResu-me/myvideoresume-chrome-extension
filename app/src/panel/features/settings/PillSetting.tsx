/**
 * "Show the hired.video pill on pages" — reads/writes the same `settings`
 * object the legacy panels used (`autoDetect`), plus `showPill`, which the
 * in-page pill (content/pill.ts) checks before drawing.
 */
import { useEffect, useState } from "preact/hooks";
import { storageGet, storageSet } from "../../platform/chrome";
import { t } from "../../platform/i18n";
import { Toggle } from "../../ui/controls";
import { SETTINGS_KEY, readPillEnabled, type ExtensionSettings } from "../../../shared/settings";

export function PillSetting() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    void storageGet<ExtensionSettings>(SETTINGS_KEY).then((s) => setEnabled(readPillEnabled(s)));
  }, []);

  const change = async (next: boolean) => {
    setEnabled(next);
    const current = (await storageGet<ExtensionSettings>(SETTINGS_KEY)) ?? {};
    await storageSet({ [SETTINGS_KEY]: { ...current, showPill: next } });
  };

  return (
    <div class="menu-item menu-toggle">
      <span>{t("menu_showPill")}</span>
      <Toggle checked={enabled} label={t("menu_showPill")} onChange={(v) => void change(v)} />
    </div>
  );
}
