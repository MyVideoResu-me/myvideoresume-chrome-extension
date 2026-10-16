/**
 * content-script-pill — a small floating pill when a job, profile or post
 * is detected: "Job detected · Track · Tailor résumé · ✕". A click opens
 * the side panel with that intent (via the service worker's openPanel).
 * Lives in a closed Shadow DOM so the page's CSS can't touch it. Off when
 * the person turns it (or auto-detect) off in the panel's menu.
 */
import { onDetection, type DetectedKind } from "../../../shared/detection-bus";
import type { LensId } from "../panel/domain/lenses";
import { t } from "../panel/platform/i18n";
import { LENS_KEY, SETTINGS_KEY, readPillEnabled, type ExtensionSettings } from "../shared/settings";
import { PILL_ACTIONS, PILL_LABEL } from "./pill-actions";

declare global {
  interface Window {
    __hiredVideoPillInstalled?: boolean;
  }
}

const OWN_HOSTS = ["hired.video", "www.hired.video", "localhost"];

const STYLE = `
:host { all: initial; }
.pill {
  --pill-bg: #0f172a; --pill-text: #ffffff; --pill-muted: #cbd5e1; --pill-line: #475569;
  --pill-primary: #2563eb; --pill-dot: #4ade80;
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
  display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px;
  border-radius: 999px; background: var(--pill-bg); color: var(--pill-text);
  font: 500 12.5px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.3); max-width: calc(100vw - 40px);
}
@media (prefers-color-scheme: dark) {
  .pill { --pill-bg: #1e293b; --pill-line: #64748b; --pill-primary: #3b82f6; }
}
.dot { width: 8px; height: 8px; border-radius: 99px; background: var(--pill-dot); flex: none; }
.label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button {
  font: inherit; cursor: pointer; min-height: 30px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--pill-line); background: transparent; color: var(--pill-text); white-space: nowrap;
}
button.primary { background: var(--pill-primary); border-color: var(--pill-primary); }
button.close { padding: 0; width: 30px; border: 0; color: var(--pill-muted); font-size: 16px; }
button:focus-visible { outline: 2px solid var(--pill-text); outline-offset: 2px; }
`;

function isOwnSite(): boolean {
  return OWN_HOSTS.includes(window.location.hostname);
}

async function readPrefs(): Promise<{ enabled: boolean; lens: LensId }> {
  const data = await chrome.storage.local.get([SETTINGS_KEY, LENS_KEY]);
  const lens = data[LENS_KEY] as LensId | undefined;
  return {
    enabled: readPillEnabled(data[SETTINGS_KEY] as ExtensionSettings | undefined),
    lens: lens && lens in PILL_ACTIONS ? lens : "jobSeeker",
  };
}

function mount(): { show: (kind: DetectedKind, lens: LensId) => void; hide: () => void } {
  const host = document.createElement("div");
  host.setAttribute("data-hired-video", "pill");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  root.appendChild(style);
  let pill: HTMLElement | null = null;

  const hide = () => {
    pill?.remove();
    pill = null;
    host.remove();
  };

  const show = (kind: DetectedKind, lens: LensId) => {
    pill?.remove();
    pill = document.createElement("div");
    pill.className = "pill";
    pill.setAttribute("role", "region");
    pill.setAttribute("aria-label", t("pill_region"));

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = t(PILL_LABEL[kind]);
    pill.append(dot, label);

    PILL_ACTIONS[lens][kind].forEach((action, i) => {
      const btn = document.createElement("button");
      btn.type = "button";
      if (i === 0) btn.className = "primary";
      btn.textContent = t(action.labelKey);
      btn.addEventListener("click", () => {
        void chrome.runtime.sendMessage({ action: "openPanel", intent: { action: action.intent } }).catch(() => undefined);
      });
      pill!.appendChild(btn);
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.setAttribute("aria-label", t("pill_dismiss"));
    close.textContent = "×";
    close.addEventListener("click", () => {
      dismissedUrl = window.location.href;
      hide();
    });
    pill.appendChild(close);

    root.appendChild(pill);
    if (!host.isConnected) document.documentElement.appendChild(host);
  };

  return { show, hide };
}

let dismissedUrl: string | null = null;

if (!window.__hiredVideoPillInstalled && !isOwnSite() && window.top === window) {
  window.__hiredVideoPillInstalled = true;
  const ui = mount();
  onDetection((kind) => {
    if (!kind) {
      ui.hide();
      return;
    }
    if (dismissedUrl === window.location.href) return;
    void readPrefs()
      .then(({ enabled, lens }) => (enabled ? ui.show(kind, lens) : ui.hide()))
      .catch(() => undefined);
  });
}
