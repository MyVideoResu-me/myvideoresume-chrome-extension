/**
 * content-script-pill — a small floating pill when a job, profile or post
 * is detected: "Job detected · Track · Tailor résumé · ✕". A click opens
 * the side panel with that intent (via the service worker's openPanel).
 * Lives in a closed Shadow DOM so the page's CSS can't touch it. On a job
 * page it rides on the detected title with a dashed outline (pill-anchor);
 * otherwise it sits in the corner. Off when the person turns it (or
 * auto-detect) off. The lens is resolved exactly like the panel's:
 * resolveLens(saved lens, account role).
 */
import { onDetection, type DetectedKind } from "../../../shared/detection-bus";
import { resolveLens, type LensId } from "../panel/domain/lenses";
import { t } from "../panel/platform/i18n";
import { ROLE_KEY } from "../panel/state/account-role";
import { LENS_KEY, SETTINGS_KEY, readPillEnabled, type ExtensionSettings } from "../shared/settings";
import { PILL_ACTIONS, PILL_LABEL } from "./pill-actions";
import { findTitleElement, followLayout, placeNear } from "./pill-anchor";
import { PILL_FONT, loadPillFonts } from "./pill-fonts";

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
  --pill-primary: #2563eb; --pill-dot: #4ade80; --pill-outline: #2563eb; --pill-outline-fill: rgba(37, 99, 235, 0.04);
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483646;
  display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 12px;
  border-radius: 999px; background: var(--pill-bg); color: var(--pill-text);
  font: 500 12.5px/1.2 ${PILL_FONT};
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.25); max-width: calc(100vw - 40px);
}
.pill.anchored { right: auto; bottom: auto; }
.outline {
  position: fixed; z-index: 2147483645; pointer-events: none; box-sizing: border-box;
  border: 2px dashed var(--pill-outline); border-radius: 14px; background: var(--pill-outline-fill);
}
@media (prefers-color-scheme: dark) {
  .pill { --pill-bg: #1e293b; --pill-line: #64748b; --pill-primary: #3b82f6; }
  .outline { --pill-outline: #60a5fa; --pill-outline-fill: rgba(96, 165, 250, 0.06); }
}
.logo { width: 18px; height: 18px; border-radius: 5px; flex: none; display: block; }
.dot { width: 8px; height: 8px; border-radius: 99px; background: var(--pill-dot); flex: none; }
.label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
button {
  font: inherit; cursor: pointer; min-height: 28px; padding: 0 12px; border-radius: 999px;
  border: 1px solid var(--pill-line); background: transparent; color: var(--pill-text); white-space: nowrap;
}
button.primary { background: var(--pill-primary); border-color: var(--pill-primary); }
button.close { padding: 0; width: 28px; border: 0; color: var(--pill-muted); font-size: 16px; }
button:focus-visible { outline: 2px solid var(--pill-text); outline-offset: 2px; }
`;

function isOwnSite(): boolean {
  return OWN_HOSTS.includes(window.location.hostname);
}

async function readPrefs(): Promise<{ enabled: boolean; lens: LensId }> {
  const data = await chrome.storage.local.get([SETTINGS_KEY, LENS_KEY, ROLE_KEY]);
  const saved = data[LENS_KEY] as LensId | undefined;
  const role = typeof data[ROLE_KEY] === "string" ? (data[ROLE_KEY] as string) : "";
  return {
    enabled: readPillEnabled(data[SETTINGS_KEY] as ExtensionSettings | undefined),
    lens: resolveLens(saved ?? null, role).id,
  };
}

function el(tag: string, cls?: string): HTMLElement {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

type ShowInput = { kind: DetectedKind; lens: LensId; title: string | null };

function mount(): { show: (input: ShowInput) => void; hide: () => void } {
  const host = document.createElement("div");
  host.setAttribute("data-hired-video", "pill");
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  root.appendChild(style);
  let pill: HTMLElement | null = null;
  let outline: HTMLElement | null = null;
  let stopFollowing: (() => void) | null = null;

  const hide = () => {
    stopFollowing?.();
    stopFollowing = null;
    pill?.remove();
    outline?.remove();
    pill = null;
    outline = null;
    host.remove();
  };

  /** Ride on the detected title while it is on screen; the corner otherwise. */
  const anchorTo = (anchor: Element | null) => {
    const update = () => {
      if (!pill || !outline) return;
      const place = placeNear(anchor, { width: pill.offsetWidth, height: pill.offsetHeight });
      if (place.mode === "corner") {
        pill.classList.remove("anchored");
        pill.style.top = pill.style.left = "";
        outline.hidden = true;
        return;
      }
      pill.classList.add("anchored");
      pill.style.top = `${place.top}px`;
      pill.style.left = `${place.left}px`;
      outline.hidden = false;
      Object.assign(outline.style, {
        top: `${place.outline.top}px`,
        left: `${place.outline.left}px`,
        width: `${place.outline.width}px`,
        height: `${place.outline.height}px`,
      });
    };
    update();
    if (anchor) stopFollowing = followLayout(update);
  };

  const show = ({ kind, lens, title }: ShowInput) => {
    stopFollowing?.();
    stopFollowing = null;
    pill?.remove();
    outline?.remove();
    loadPillFonts();

    outline = el("div", "outline");
    outline.hidden = true;
    outline.setAttribute("aria-hidden", "true");
    pill = el("div", "pill");
    pill.setAttribute("role", "region");
    pill.setAttribute("aria-label", t("pill_region"));

    // The extension's own icon (the hired.video mark), so the bar says whose it is.
    const logo = el("img", "logo") as HTMLImageElement;
    logo.src = chrome.runtime.getURL("icons/icon48.png");
    logo.alt = "";
    logo.onerror = () => logo.remove();
    const dot = el("span", "dot");
    dot.setAttribute("aria-hidden", "true");
    const label = el("span", "label");
    label.textContent = t(PILL_LABEL[kind]);
    pill.append(logo, dot, label);

    PILL_ACTIONS[lens][kind].forEach((action, i) => {
      const btn = el("button", i === 0 ? "primary" : undefined) as HTMLButtonElement;
      btn.type = "button";
      btn.textContent = t(action.labelKey);
      btn.addEventListener("click", () => {
        void chrome.runtime.sendMessage({ action: "openPanel", intent: { action: action.intent } }).catch(() => undefined);
      });
      pill!.appendChild(btn);
    });

    const close = el("button", "close") as HTMLButtonElement;
    close.type = "button";
    close.setAttribute("aria-label", t("pill_dismiss"));
    close.textContent = "×";
    close.addEventListener("click", () => {
      dismissedUrl = window.location.href;
      hide();
    });
    pill.appendChild(close);

    root.append(outline, pill);
    if (!host.isConnected) document.documentElement.appendChild(host);
    anchorTo(kind === "job" ? findTitleElement(title) : null);
  };

  return { show, hide };
}

let dismissedUrl: string | null = null;

if (!window.__hiredVideoPillInstalled && !isOwnSite() && window.top === window) {
  window.__hiredVideoPillInstalled = true;
  const ui = mount();
  onDetection((kind, payload) => {
    if (!kind) {
      ui.hide();
      return;
    }
    if (dismissedUrl === window.location.href) return;
    const title = typeof payload?.title === "string" ? payload.title : null;
    void readPrefs()
      .then(({ enabled, lens }) => (enabled ? ui.show({ kind, lens, title }) : ui.hide()))
      .catch(() => undefined);
  });
}
