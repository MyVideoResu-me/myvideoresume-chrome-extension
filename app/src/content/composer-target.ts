/**
 * Finding the open message box on a page and typing into it. Pure DOM —
 * unit-testable without Chrome.
 */

export type ComposerKind =
  | "focused"
  | "linkedin-message"
  | "linkedin-note"
  | "linkedin-comment"
  | "x-reply"
  | "dialog"
  | "textbox";

/** Ordered: the most specific composer wins. */
const COMPOSER_SELECTORS: ReadonlyArray<{ kind: ComposerKind; selector: string }> = [
  { kind: "linkedin-note", selector: "textarea#custom-message" },
  { kind: "linkedin-message", selector: '.msg-form__contenteditable[contenteditable="true"]' },
  { kind: "linkedin-comment", selector: ".comments-comment-box__form .ql-editor, .comments-comment-texteditor .ql-editor" },
  { kind: "x-reply", selector: '[data-testid="tweetTextarea_0"]' },
  { kind: "dialog", selector: '[role="dialog"] [contenteditable="true"], [role="dialog"] textarea' },
  { kind: "textbox", selector: '[role="textbox"][contenteditable="true"]' },
];

export function isEditable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return !el.disabled && !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.disabled && !el.readOnly && ["text", "search", ""].includes(el.type);
  }
  return el.isContentEditable;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function findComposer(doc: Document): { el: HTMLElement; kind: ComposerKind } | null {
  const active = doc.activeElement;
  if (isEditable(active)) return { el: active, kind: "focused" };
  for (const { kind, selector } of COMPOSER_SELECTORS) {
    const matches = Array.from(doc.querySelectorAll(selector)).filter(
      (el): el is HTMLElement => isEditable(el) && isVisible(el as HTMLElement),
    );
    // The last one is the newest (most recently opened) box.
    const el = matches[matches.length - 1];
    if (el) return { el, kind };
  }
  return null;
}

/** Insert `text` at the end of the composer's current draft. */
export function insertIntoComposer(el: HTMLElement, text: string): boolean {
  if (!text) return false;
  el.focus();
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const existing = el.value;
    const next = existing ? `${existing.replace(/\s+$/, "")}\n\n${text}` : text;
    // Native setter so React-controlled inputs see the change.
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, next);
    else el.value = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  // contenteditable editors (LinkedIn, X/Draft.js, Quill) only register
  // text typed through the editing pipeline, so go through execCommand.
  const selection = el.ownerDocument.getSelection();
  if (selection) {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  const prefix = (el.textContent || "").trim() ? "\n\n" : "";
  // eslint-disable-next-line deprecation/deprecation -- the only API editors listen to
  const inserted = el.ownerDocument.execCommand("insertText", false, prefix + text);
  if (inserted) return true;
  el.textContent = `${el.textContent || ""}${prefix}${text}`;
  el.dispatchEvent(new InputEvent("input", { bubbles: true }));
  return true;
}
