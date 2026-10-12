/**
 * content-script-autofill.ts — form-field extraction + autofill for job
 * application pages (Greenhouse, Lever, Workday, Ashby, generic).
 *
 * Pure extraction logic now lives in hired.video/shared/scraping/formFields.
 * This file owns:
 *   - the Chrome message contract (extractFormFields, fillFormFields,
 *     getFormHtml)
 *   - the DOM-write side of autofill (native-property-setter shenanigans
 *     so React/Vue/Angular state updates correctly)
 *
 * Bundled by scripts/build.js via esbuild into plain IIFE JS.
 */

import { extractFormFields as extractFormFieldsShared } from "../../hired.video/shared/scraping/index.js";

(function hiredVideoAutofillContentScript() {
  const SENTINEL = "__HIRED_VIDEO_AUTOFILL_CS_LOADED__";
  const w = window as unknown as Record<string, unknown>;
  if (w[SENTINEL]) return;
  w[SENTINEL] = true;

  // -------------------------------------------------------------------------
  // Extraction — delegate to shared. The `getComputedStyle` wrapper is
  // the one DI hook the shared module exposes for visibility-testing
  // forms in jsdom (where layout isn't computed).
  // -------------------------------------------------------------------------

  function extractFormFields() {
    return extractFormFieldsShared(document as any, window.location.href, {
      getComputedStyle: (el: unknown) => {
        try {
          return window.getComputedStyle(el as Element);
        } catch {
          return { display: "block", visibility: "visible", opacity: "1" };
        }
      },
    });
  }

  // -------------------------------------------------------------------------
  // Label resolution reused by radio filling — we need it for matching
  // an answer to the right radio button.
  // -------------------------------------------------------------------------

  function resolveLabel(el: Element): string {
    const htmlEl = el as HTMLElement;
    const id = (htmlEl as any).id;
    if (id) {
      const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (label) {
        const text = (label.textContent || "").trim().replace(/\s+/g, " ");
        if (text) return text;
      }
    }
    const parentLabel = htmlEl.closest("label");
    if (parentLabel) {
      const clone = parentLabel.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("input, select, textarea").forEach((n) => n.remove());
      const t = (clone.textContent || "").trim().replace(/\s+/g, " ");
      if (t) return t;
    }
    const aria = htmlEl.getAttribute("aria-label");
    if (aria) return aria.trim();
    return (htmlEl as HTMLInputElement).name || "Unknown Field";
  }

  // -------------------------------------------------------------------------
  // Form filling — framework-compatible via native property setters.
  // -------------------------------------------------------------------------

  function setFieldValue(el: HTMLElement, value: string): boolean {
    const tag = el.tagName;

    if (tag === "SELECT") {
      const select = el as HTMLSelectElement;
      const options = Array.from(select.options);
      const exact = options.find(
        (o) => o.value === value || o.text.trim().toLowerCase() === value.toLowerCase(),
      );
      const fuzzy = options.find(
        (o) =>
          o.text.trim().toLowerCase().includes(value.toLowerCase()) ||
          value.toLowerCase().includes(o.text.trim().toLowerCase()),
      );
      const match = exact || fuzzy;
      if (match) {
        select.value = match.value;
      } else {
        return false;
      }
    } else if ((el as HTMLInputElement).type === "checkbox") {
      const input = el as HTMLInputElement;
      const shouldCheck = ["true", "yes", "1", "on"].includes(value.toLowerCase());
      if (input.checked !== shouldCheck) {
        input.click();
      }
      return true;
    } else if ((el as HTMLInputElement).type === "radio") {
      const input = el as HTMLInputElement;
      const name = input.name;
      if (name) {
        const allRadios = document.querySelectorAll<HTMLInputElement>(`input[name="${CSS.escape(name)}"]`);
        for (const radio of allRadios) {
          const radioLabel = resolveLabel(radio);
          if (
            radio.value === value ||
            radioLabel.toLowerCase().includes(value.toLowerCase()) ||
            value.toLowerCase().includes(radioLabel.toLowerCase())
          ) {
            radio.click();
            return true;
          }
        }
      }
      return false;
    } else {
      // Text, email, tel, url, textarea, number, date — use the native
      // property setter so React's synthetic event system sees the change.
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      const nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      )?.set;

      if (tag === "TEXTAREA" && nativeTextAreaValueSetter) {
        nativeTextAreaValueSetter.call(el, value);
      } else if (nativeInputValueSetter) {
        nativeInputValueSetter.call(el, value);
      } else {
        (el as HTMLInputElement).value = value;
      }
    }

    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }

  type FillResult = Record<string, "filled" | "skipped" | "error">;

  function fillFormFields(answersMap: Record<string, string>): FillResult {
    const results: FillResult = {};
    for (const [fieldId, answer] of Object.entries(answersMap)) {
      try {
        let el: HTMLElement | null = null;
        // 1. name
        el = document.querySelector<HTMLElement>(`[name="${CSS.escape(fieldId)}"]`);
        // 2. id
        if (!el) el = document.getElementById(fieldId);
        // 3. Workday data-automation-id
        if (!el) el = document.querySelector<HTMLElement>(`[data-automation-id="${CSS.escape(fieldId)}"]`);
        // 4. raw CSS selector
        if (!el && (fieldId.startsWith("#") || fieldId.startsWith("[") || fieldId.startsWith("."))) {
          try {
            el = document.querySelector<HTMLElement>(fieldId);
          } catch {
            /* invalid selector */
          }
        }

        if (!el) {
          results[fieldId] = "skipped";
          continue;
        }
        if ((el as HTMLInputElement).type === "file") {
          results[fieldId] = "skipped";
          continue;
        }
        results[fieldId] = setFieldValue(el, answer) ? "filled" : "skipped";
      } catch {
        results[fieldId] = "error";
      }
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Message contract — same as the legacy JS version so service worker
  // + side panel don't have to change.
  // -------------------------------------------------------------------------

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "extractFormFields") {
      try {
        sendResponse(extractFormFields());
      } catch (err) {
        sendResponse({
          fields: [],
          atsProvider: null,
          url: window.location.href,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return true;
    }

    if (request.action === "fillFormFields") {
      try {
        sendResponse({ results: fillFormFields(request.answers || {}) });
      } catch (err) {
        sendResponse({ results: {}, error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }

    if (request.action === "getFormHtml") {
      try {
        const forms = Array.from(document.querySelectorAll("form"));
        let best: Element | null = null;
        let bestCount = 0;
        for (const form of forms) {
          const c = form.querySelectorAll("input, select, textarea").length;
          if (c > bestCount) {
            bestCount = c;
            best = form;
          }
        }
        sendResponse({
          html: best ? best.outerHTML : (document.body.innerHTML || "").slice(0, 50_000),
        });
      } catch (err) {
        sendResponse({ html: "", error: err instanceof Error ? err.message : String(err) });
      }
      return true;
    }
  });
})();
