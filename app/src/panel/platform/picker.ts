/**
 * The in-page manual picker (shared/content-script-picker.ts): when
 * auto-detection misses, the person clicks the title / company / … on the
 * page. Injected on demand; the result arrives as a `pickerResult` message.
 */
import { recordEvent } from "./telemetry";

export type PickerMode = "job" | "profile";

export type PickerResult = {
  mode: PickerMode | "company";
  host: string;
  sourceUrl: string;
  fields: Record<string, { value?: string; snippet?: string } | undefined>;
};

export async function launchPicker(mode: PickerMode): Promise<boolean> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || tab.url.startsWith("chrome")) return false;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (m: string) => {
        (window as unknown as Record<string, unknown>).__HIRED_VIDEO_PICKER_MODE__ = m;
      },
      args: [mode],
    });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script-picker.js"] });
    recordEvent("manual", tab.url, { kind: "picker_launched", mode });
    return true;
  } catch {
    return false;
  }
}
