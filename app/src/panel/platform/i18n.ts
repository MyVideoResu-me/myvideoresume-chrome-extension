/**
 * UI strings come from the extension's _locales/<lang>/messages.json via
 * chrome.i18n (Chrome picks the browser's language, falling back to the
 * manifest's default_locale "en"). `{name}` tokens are filled from `vars`.
 *
 * The key type is derived from the English catalog, so a typo or a key
 * missing from en fails the typecheck; tests/i18n-catalogs.test.js keeps
 * es + fr in step with en.
 */
type Catalog = typeof import("../../../_locales/en/messages.json");
export type MessageKey = keyof Catalog;

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = chrome.i18n.getMessage(key) || key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

/** Locale for Intl formatting (dates, numbers). */
export function uiLocale(): string {
  return chrome.i18n.getUILanguage() || "en";
}
