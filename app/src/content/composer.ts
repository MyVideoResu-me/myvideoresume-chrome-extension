/**
 * content-script-composer — types a prepared message into the message /
 * comment / reply box that is open on the page (LinkedIn message,
 * LinkedIn connection note, LinkedIn comment, X reply, or any focused
 * editable). Injected on demand by the service worker's `fillComposer`.
 *
 * It NEVER presses Send. Sending stays a human action — that keeps the
 * person in control and keeps us inside the sites' rules on automation.
 * Existing draft text is kept: we insert at the end, never replace.
 */
import { findComposer, insertIntoComposer } from "./composer-target";

declare global {
  interface Window {
    __hiredVideoComposerInstalled?: boolean;
  }
}

if (!window.__hiredVideoComposerInstalled) {
  window.__hiredVideoComposerInstalled = true;
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.action !== "fillComposer") return false;
    const target = findComposer(document);
    if (!target) {
      sendResponse({ ok: false, error: "no_composer" });
      return false;
    }
    const ok = insertIntoComposer(target.el, String(msg.text || ""));
    sendResponse(ok ? { ok: true, target: target.kind } : { ok: false, error: "insert_failed" });
    return false;
  });
}
