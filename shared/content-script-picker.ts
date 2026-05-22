/**
 * content-script-picker.ts — Interactive job-element picker.
 *
 * Activated by the side panel when auto-detection fails (or when the
 * user clicks "Identify manually"). Two complementary modes per field:
 *
 *   1. Auto-suggest — runs the shared `detectJobInPage` heuristics for
 *      each field, paints a green outline around the guess, and shows
 *      a floating "Is this the JOB TITLE? ✓ Yes / ✗ No" prompt.
 *   2. Manual pick — when the user rejects the suggestion (or none was
 *      found) we enter hover-to-highlight mode. `mousemove` paints an
 *      outline around `document.elementFromPoint`; click captures.
 *
 * Fields stepped: title → company → location → description → applyUrl.
 *
 * Result is posted back to the side panel as a `pickerResult` message
 * containing both the human-readable text and a stable CSS selector
 * (chain of nth-of-type + id/class hashes). The side panel converts
 * the result into a normal `DetectedJob` (strategy: "manual"), persists
 * the per-host selector map for replay on future visits, and fires a
 * `picker_capture` telemetry event so the server can roll the selectors
 * into the next siteConfigs.ts update.
 *
 * Bundled by scripts/build.js → content-script-picker.js, loaded on
 * demand via chrome.scripting.executeScript (NOT in the manifest's
 * static content_scripts — we only inject when the user opts in).
 *
 * NOTE: zero React. The overlay is plain DOM in a Shadow DOM root so the
 * host page's CSS can't bleed in.
 */

import {
  detectJobInPage,
  canonicalizeJobUrl,
  buildSelector,
  type DetectedJob,
} from "../../hired.video/shared/scraping/index.js";

(function hiredVideoPicker() {
  const SENTINEL = "__HIRED_VIDEO_PICKER_LOADED__";
  const w = window as unknown as Record<string, unknown>;
  if (w[SENTINEL]) {
    // Re-activate: tear down any existing overlay and rebuild.
    try {
      (w[SENTINEL] as { teardown: () => void }).teardown();
    } catch {
      /* ignore */
    }
  }

  type FieldKey = "title" | "company" | "location" | "description" | "applyUrl";

  interface CapturedField {
    value: string;
    selector: string;
    snippet?: string; // outerHTML, capped — useful for the SA viewer
    rect?: { x: number; y: number; w: number; h: number };
    source: "auto" | "manual";
  }

  type Captured = Partial<Record<FieldKey, CapturedField>>;

  const STEPS: { key: FieldKey; label: string; hint: string }[] = [
    { key: "title", label: "Job title", hint: "Click the job title heading on the page." },
    { key: "company", label: "Company", hint: "Click the company name." },
    { key: "location", label: "Location", hint: "Click the location text (city/remote)." },
    {
      key: "description",
      label: "Description",
      hint: "Click anywhere inside the job description body.",
    },
    {
      key: "applyUrl",
      label: "Apply button",
      hint: "Click the apply button or link. (Optional — Skip is OK.)",
    },
  ];

  // ── Shadow-DOM-isolated overlay ─────────────────────────────────────────

  const overlayHost = document.createElement("div");
  overlayHost.id = "hired-video-picker-host";
  overlayHost.style.cssText =
    "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
  document.documentElement.appendChild(overlayHost);
  const shadow = overlayHost.attachShadow({ mode: "open" });

  const STYLE = document.createElement("style");
  STYLE.textContent = `
    :host, .hv-root { all: initial; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .hv-root { position: fixed; inset: 0; pointer-events: none; }
    .hv-highlight {
      position: fixed; pointer-events: none;
      border: 2px solid #2563eb; background: rgba(37, 99, 235, 0.08);
      box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.15);
      transition: top 60ms, left 60ms, width 60ms, height 60ms;
      z-index: 1;
    }
    .hv-highlight.hv-auto { border-color: #16a34a; background: rgba(22, 163, 74, 0.12); }
    .hv-toolbar {
      position: fixed; right: 16px; bottom: 16px;
      width: 320px; max-width: calc(100vw - 32px);
      background: #fff; color: #111; border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08);
      padding: 14px 14px 12px; pointer-events: auto;
      font-size: 13px; line-height: 1.4; z-index: 2;
      border: 1px solid #e5e7eb;
    }
    .hv-toolbar h4 { font-size: 13px; margin: 0 0 4px; font-weight: 600; color: #111; display: flex; align-items: center; gap: 6px; }
    .hv-toolbar .hv-step { color: #6b7280; font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; }
    .hv-toolbar .hv-hint { color: #4b5563; margin: 0 0 10px; }
    .hv-toolbar .hv-suggest {
      background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px;
      padding: 8px 10px; margin: 0 0 10px; color: #14532d; font-size: 12px;
    }
    .hv-toolbar .hv-suggest .hv-suggest-text {
      font-weight: 500; word-break: break-word; max-height: 60px; overflow: hidden;
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
    }
    .hv-toolbar .hv-progress { display: flex; gap: 4px; margin-bottom: 8px; }
    .hv-toolbar .hv-progress-dot {
      flex: 1; height: 3px; border-radius: 2px; background: #e5e7eb;
    }
    .hv-toolbar .hv-progress-dot.done { background: #16a34a; }
    .hv-toolbar .hv-progress-dot.active { background: #2563eb; }
    .hv-toolbar .hv-actions { display: flex; gap: 6px; flex-wrap: wrap; }
    .hv-toolbar button {
      flex: 1; min-width: 64px;
      padding: 7px 10px; border: 1px solid transparent; border-radius: 6px;
      background: #f3f4f6; color: #111; cursor: pointer; font: inherit;
      font-size: 12px; font-weight: 500;
    }
    .hv-toolbar button:hover { background: #e5e7eb; }
    .hv-toolbar button.hv-primary { background: #2563eb; color: #fff; }
    .hv-toolbar button.hv-primary:hover { background: #1d4ed8; }
    .hv-toolbar button.hv-success { background: #16a34a; color: #fff; }
    .hv-toolbar button.hv-success:hover { background: #15803d; }
    .hv-toolbar button.hv-danger { background: #fff; color: #b91c1c; border-color: #fecaca; }
    .hv-toolbar button.hv-ghost { background: transparent; color: #6b7280; }
    .hv-toolbar .hv-footer { margin-top: 8px; font-size: 11px; color: #9ca3af; display: flex; justify-content: space-between; }
    .hv-toolbar .hv-footer button { font-size: 11px; padding: 2px 6px; background: transparent; color: #6b7280; }
    .hv-toolbar.hv-trying { background: linear-gradient(180deg, #fafbff 0%, #fff 100%); }
    .hv-toolbar .hv-spinner {
      display: inline-block; width: 12px; height: 12px;
      border: 2px solid #c7d2fe; border-top-color: #2563eb; border-radius: 50%;
      animation: hv-spin 0.7s linear infinite; vertical-align: -2px;
    }
    @keyframes hv-spin { to { transform: rotate(360deg); } }
  `;
  shadow.appendChild(STYLE);

  const root = document.createElement("div");
  root.className = "hv-root";
  shadow.appendChild(root);

  const highlight = document.createElement("div");
  highlight.className = "hv-highlight";
  highlight.style.display = "none";
  root.appendChild(highlight);

  const toolbar = document.createElement("div");
  toolbar.className = "hv-toolbar";
  root.appendChild(toolbar);

  // ── State ────────────────────────────────────────────────────────────────

  let stepIdx = 0;
  let mode: "auto" | "manual" = "auto";
  let hoverEl: Element | null = null;
  let suggestion: { el: Element | null; text: string } | null = null;
  const captured: Captured = {};
  let teardownFns: (() => void)[] = [];
  let teardown = () => {
    teardownFns.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
    teardownFns = [];
    overlayHost.remove();
    delete w[SENTINEL];
  };

  w[SENTINEL] = { teardown };

  // ── Helpers ──────────────────────────────────────────────────────────────

  function paintHighlight(el: Element | null, autoMode = false) {
    if (!el) {
      highlight.style.display = "none";
      return;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      highlight.style.display = "none";
      return;
    }
    highlight.style.display = "block";
    highlight.classList.toggle("hv-auto", autoMode);
    highlight.style.left = `${rect.left}px`;
    highlight.style.top = `${rect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
  }

  // CSS selector construction delegates to the shared
  // hired.video/shared/scraping/selector.ts implementation that
  // formFields.ts (autofill) also uses — single source of truth, tested
  // in __tests__/selector.test.ts.

  function textOf(el: Element): string {
    if (el.tagName === "A" || el.tagName === "BUTTON") {
      const href = el.getAttribute("href");
      const text = (el.textContent || "").replace(/\s+/g, " ").trim();
      // For apply step we'd rather have the URL than the label.
      if (currentStep().key === "applyUrl" && href) {
        try {
          return new URL(href, window.location.href).href;
        } catch {
          return href;
        }
      }
      return text;
    }
    return (el.textContent || "").replace(/\s+/g, " ").trim();
  }

  function captureSnippet(el: Element): string {
    const html = (el as HTMLElement).outerHTML || "";
    return html.length > 8000 ? `${html.slice(0, 8000)}…` : html;
  }

  function currentStep() {
    return STEPS[stepIdx];
  }

  function commit(el: Element | null, value: string, source: "auto" | "manual") {
    const step = currentStep();
    if (!value || !value.trim()) return;
    const fieldVal: CapturedField = {
      value: value.trim(),
      selector: el ? buildSelector(document as unknown as { body: Element }, el as unknown as Parameters<typeof buildSelector>[1]) : "",
      snippet: el ? captureSnippet(el) : undefined,
      rect: el
        ? (() => {
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
          })()
        : undefined,
      source,
    };
    captured[step.key] = fieldVal;
    stepIdx += 1;
    if (stepIdx >= STEPS.length) return finish();
    enterStep();
  }

  function skip() {
    stepIdx += 1;
    if (stepIdx >= STEPS.length) return finish();
    enterStep();
  }

  function back() {
    if (stepIdx === 0) return;
    stepIdx -= 1;
    delete captured[currentStep().key];
    enterStep();
  }

  // ── Auto-suggest pipeline ────────────────────────────────────────────────
  //
  // For the first three fields we lean on the existing `detectJobInPage`
  // result if it returned one. For description we fall back to the
  // longest plausible text block. ApplyUrl gets the DOM apply-link
  // scorer's first hit (or skip).
  //
  // The suggestion is rendered with a green outline + "Is this right?"
  // chips. Confirming commits it; rejecting drops into manual mode.

  let autoDetected: DetectedJob | null = null;
  try {
    autoDetected = detectJobInPage(document as any, window.location.href);
  } catch (err) {
    autoDetected = null;
  }

  function autoSuggestFor(key: FieldKey): { el: Element | null; text: string } | null {
    if (key === "title" && autoDetected?.title) {
      const el = bestElementForText(autoDetected.title, ["h1", "h2", "h3"]);
      return { el, text: autoDetected.title };
    }
    if (key === "company" && autoDetected?.company) {
      const el = bestElementForText(autoDetected.company, ["a", "div", "span"]);
      return { el, text: autoDetected.company };
    }
    if (key === "location" && autoDetected?.location) {
      const el = bestElementForText(autoDetected.location, ["div", "span", "li"]);
      return { el, text: autoDetected.location };
    }
    if (key === "description") {
      // Longest text-heavy block. Stops descending when a child is "too
      // long" — picks the closest wrapping container.
      let best: { el: Element; len: number } | null = null;
      const candidates = Array.from(document.querySelectorAll("article, section, div, main"));
      for (const c of candidates) {
        const txt = (c.textContent || "").trim();
        if (txt.length < 400 || txt.length > 50_000) continue;
        const r = c.getBoundingClientRect();
        if (r.width < 200 || r.height < 100) continue;
        if (!best || txt.length > best.len) best = { el: c, len: txt.length };
      }
      if (best) return { el: best.el, text: (best.el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 4000) };
      return null;
    }
    if (key === "applyUrl" && autoDetected?.applyUrl && autoDetected.applyUrl !== autoDetected.sourceUrl) {
      const a = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).find(
        (anc) => anc.href === autoDetected!.applyUrl,
      );
      return { el: a ?? null, text: autoDetected.applyUrl };
    }
    return null;
  }

  function bestElementForText(needle: string, tags: string[]): Element | null {
    const norm = needle.replace(/\s+/g, " ").trim().toLowerCase();
    if (!norm) return null;
    for (const tag of tags) {
      const els = Array.from(document.querySelectorAll(tag));
      for (const el of els) {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
        if (t === norm || (t.length < 300 && t.includes(norm))) return el;
      }
    }
    return null;
  }

  // ── Hover / click handlers (active in manual mode) ───────────────────────

  function onMouseMove(ev: MouseEvent) {
    if (mode !== "manual") return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!el || el === hoverEl) return;
    // Ignore our own overlay
    if (overlayHost.contains(el)) return;
    hoverEl = el;
    paintHighlight(el);
  }

  function onClickCapture(ev: MouseEvent) {
    if (mode !== "manual") return;
    const target = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!target || overlayHost.contains(target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const value = textOf(target);
    if (!value) {
      // Empty pick — flash the toolbar and let them try again.
      toolbar.animate(
        [{ outline: "2px solid #b91c1c" }, { outline: "2px solid transparent" }],
        { duration: 700 },
      );
      return;
    }
    commit(target, value, "manual");
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      cancel();
    } else if (ev.key === "ArrowLeft" && (ev.metaKey || ev.ctrlKey)) {
      ev.preventDefault();
      back();
    }
  }

  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClickCapture, true);
  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("scroll", () => suggestion && suggestion.el && paintHighlight(suggestion.el, true), true);
  window.addEventListener("resize", () => suggestion && suggestion.el && paintHighlight(suggestion.el, true), true);
  teardownFns.push(() => {
    document.removeEventListener("mousemove", onMouseMove, true);
    document.removeEventListener("click", onClickCapture, true);
    document.removeEventListener("keydown", onKeydown, true);
  });

  // ── Render ────────────────────────────────────────────────────────────────

  function renderToolbar(busy = false) {
    const step = currentStep();
    const progress = STEPS.map((_, i) => {
      let cls = "hv-progress-dot";
      if (i < stepIdx) cls += " done";
      else if (i === stepIdx) cls += " active";
      return `<div class="${cls}"></div>`;
    }).join("");
    let suggestBlock = "";
    if (busy) {
      suggestBlock = `<div class="hv-suggest"><span class="hv-spinner"></span> Scanning page for ${escapeHtml(step.label.toLowerCase())}…</div>`;
    } else if (suggestion && mode === "auto") {
      suggestBlock = `<div class="hv-suggest">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.04em;color:#16a34a;margin-bottom:2px;">My guess</div>
        <div class="hv-suggest-text">${escapeHtml(suggestion.text)}</div>
      </div>`;
    }
    const actions =
      mode === "auto" && suggestion
        ? `<button class="hv-success" data-act="confirm">✓ Yes, that's right</button>
           <button class="hv-danger" data-act="reject">✗ Pick manually</button>`
        : `<button class="hv-ghost" data-act="skip">Skip</button>`;
    toolbar.classList.toggle("hv-trying", busy);
    toolbar.innerHTML = `
      <div class="hv-progress">${progress}</div>
      <div class="hv-step">Step ${stepIdx + 1} of ${STEPS.length}</div>
      <h4>${escapeHtml(step.label)}</h4>
      <p class="hv-hint">${escapeHtml(step.hint)}</p>
      ${suggestBlock}
      <div class="hv-actions">${actions}</div>
      <div class="hv-footer">
        <button data-act="back" ${stepIdx === 0 ? "disabled" : ""}>← Back</button>
        <button data-act="cancel">Cancel (Esc)</button>
      </div>
    `;
  }

  function escapeHtml(s: string): string {
    return s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  toolbar.addEventListener("click", (ev) => {
    const act = (ev.target as HTMLElement).closest("[data-act]")?.getAttribute("data-act");
    if (!act) return;
    if (act === "confirm" && suggestion) {
      commit(suggestion.el, suggestion.text, "auto");
    } else if (act === "reject") {
      mode = "manual";
      suggestion = null;
      paintHighlight(null);
      renderToolbar();
    } else if (act === "skip") {
      skip();
    } else if (act === "back") {
      back();
    } else if (act === "cancel") {
      cancel();
    }
  });

  function enterStep() {
    mode = "auto";
    suggestion = null;
    paintHighlight(null);
    renderToolbar(true);
    // Defer one frame so the spinner paints before the heavy work.
    requestAnimationFrame(() => {
      const guess = autoSuggestFor(currentStep().key);
      if (guess && guess.text) {
        suggestion = guess;
        if (guess.el) paintHighlight(guess.el, true);
        renderToolbar(false);
      } else {
        // No suggestion — go straight to manual mode.
        mode = "manual";
        renderToolbar(false);
      }
    });
  }

  function finish() {
    paintHighlight(null);
    const sourceUrl = canonicalizeJobUrl(window.location.href);
    const payload = {
      action: "pickerResult",
      result: {
        host: window.location.hostname.toLowerCase(),
        sourceUrl,
        fields: captured,
      },
    };
    try {
      (chrome.runtime.sendMessage(payload) as any)?.catch?.(() => {});
    } catch {
      /* ignore */
    }
    teardown();
  }

  function cancel() {
    paintHighlight(null);
    try {
      (chrome.runtime.sendMessage({ action: "pickerCancelled" }) as any)?.catch?.(() => {});
    } catch {
      /* ignore */
    }
    teardown();
  }

  // Kick off the first step.
  enterStep();
})();
