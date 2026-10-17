/**
 * Extension settings. Same object the web /settings page edits (synced
 * through state/settings). Pro-only options show the Pro chip and open
 * the upgrade page instead of switching on.
 */
import { DOWNLOAD_FORMATS, type DownloadFormat, type ExtensionSettings } from "../../../shared/settings";
import { useIsPro } from "../../state/session";
import { settingsStore, updateSettings } from "../../state/settings";
import { useStore } from "../../state/store";
import { t, type MessageKey } from "../../platform/i18n";
import { ViewHeader } from "../../shell/ViewHeader";
import { Card, Chip, Toggle } from "../../ui/controls";
import { openUpgrade } from "../../ui/ErrorNotice";
import { IconAction } from "../../ui/items";
import { openTab } from "../../platform/chrome";
import { webSettingsUrl } from "../../platform/web-links";

type BoolKey = "autoDetect" | "showPill" | "autoScore" | "autoTailor" | "telemetryOptOut";

/** Each toggle is data: its key, its words, and whether it needs Pro. */
const TOGGLES: ReadonlyArray<{ key: BoolKey; labelKey: MessageKey; hintKey: MessageKey; pro?: boolean }> = [
  { key: "autoDetect", labelKey: "settings_autoDetect", hintKey: "settings_autoDetect_hint" },
  { key: "showPill", labelKey: "settings_showPill", hintKey: "settings_showPill_hint" },
  { key: "autoScore", labelKey: "settings_autoScore", hintKey: "settings_autoScore_hint" },
  { key: "autoTailor", labelKey: "settings_autoTailor", hintKey: "settings_autoTailor_hint", pro: true },
  { key: "telemetryOptOut", labelKey: "settings_telemetryOptOut", hintKey: "settings_telemetryOptOut_hint" },
];

const FORMAT_LABEL: Record<DownloadFormat, MessageKey> = {
  pdf: "format_pdf",
  docx: "format_docx",
  md: "format_md",
  txt: "format_txt",
};

export function SettingsView() {
  const settings = useStore(settingsStore, (s) => s.settings);
  const isPro = useIsPro();

  const set = (patch: ExtensionSettings, needsPro: boolean) => {
    if (needsPro && !isPro) openUpgrade();
    else void updateSettings(patch);
  };

  return (
    <>
      <ViewHeader
        title={t("settings_title")}
        subtitle={t("settings_subtitle")}
        actions={<IconAction icon="external" label={t("settings_openSite")} onClick={() => openTab(webSettingsUrl())} />}
      />
      <div class="view-body">
        <Card>
          {TOGGLES.map((item) => (
            <div key={item.key} class="setting-row">
              <div class="setting-text">
                <div class="row">
                  <span class="strong">{t(item.labelKey)}</span>
                  {item.pro && !isPro ? <Chip tone="pro">{t("common_pro")}</Chip> : null}
                </div>
                <div class="muted small">{t(item.hintKey)}</div>
              </div>
              <Toggle
                checked={settings[item.key]}
                label={t(item.labelKey)}
                onChange={(v) => set({ [item.key]: v }, !!item.pro && v)}
              />
            </div>
          ))}
          <label class="setting-row">
            <span class="setting-text">
              <span class="row">
                <span class="strong">{t("settings_downloadFormat")}</span>
                {isPro ? null : <Chip tone="pro">{t("common_pro")}</Chip>}
              </span>
              <span class="muted small">{t("settings_downloadFormat_hint")}</span>
            </span>
            <select
              class="select"
              value={settings.downloadFormat}
              onChange={(e) => {
                const v = e.currentTarget.value as DownloadFormat;
                set({ downloadFormat: v }, v !== "pdf");
                if (v !== "pdf" && !isPro) e.currentTarget.value = settings.downloadFormat;
              }}
            >
              {DOWNLOAD_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {t(FORMAT_LABEL[f])}
                </option>
              ))}
            </select>
          </label>
        </Card>
      </div>
    </>
  );
}
