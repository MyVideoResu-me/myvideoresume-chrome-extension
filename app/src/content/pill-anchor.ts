/**
 * Where the in-page pill sits. When the detector names a job title and we
 * can find that heading on the page, the pill rides on the heading's top
 * edge and a dashed outline marks what was detected; otherwise (no title,
 * heading not found, or scrolled out of view) it sits in the corner.
 */

const TITLE_SELECTOR = 'h1, h2, h3, [class*="title" i], [data-testid*="title" i]';
const OUTLINE_PAD = 12;
const EDGE = 8;

const norm = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The visible element whose text is the detected title, or null. */
export function findTitleElement(title: string | null | undefined): Element | null {
  const want = norm(title);
  if (!want) return null;
  for (const el of Array.from(document.querySelectorAll(TITLE_SELECTOR))) {
    const text = norm(el.textContent);
    if (!text || text.length > want.length * 2) continue;
    if (text !== want && !text.includes(want)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return el;
  }
  return null;
}

export type Placement =
  | { mode: "corner" }
  | { mode: "anchored"; top: number; left: number; outline: { top: number; left: number; width: number; height: number } };

/** Pill + outline coordinates for an anchor, given the pill's size. */
export function placeNear(anchor: Element | null, pill: { width: number; height: number }): Placement {
  if (!anchor?.isConnected) return { mode: "corner" };
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const outline = {
    top: r.top - OUTLINE_PAD,
    left: r.left - OUTLINE_PAD,
    width: r.width + OUTLINE_PAD * 2,
    height: r.height + OUTLINE_PAD * 2,
  };
  // Heading scrolled away → back to the corner so the pill stays reachable.
  if (outline.top + outline.height < 0 || outline.top > vh - pill.height) return { mode: "corner" };
  const top = Math.max(EDGE, outline.top - pill.height / 2);
  const left = Math.min(Math.max(EDGE, outline.left + outline.width - pill.width - 20), vw - pill.width - EDGE);
  return { mode: "anchored", top, left, outline };
}

/** Re-run `update` on scroll / resize, at most once a frame. Returns the stop function. */
export function followLayout(update: () => void): () => void {
  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  window.addEventListener("scroll", schedule, { passive: true, capture: true });
  window.addEventListener("resize", schedule, { passive: true });
  return () => {
    if (frame) cancelAnimationFrame(frame);
    window.removeEventListener("scroll", schedule, { capture: true });
    window.removeEventListener("resize", schedule);
  };
}
