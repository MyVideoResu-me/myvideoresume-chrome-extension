/**
 * The pill's brand font (Geist). @font-face inside a shadow root is ignored by
 * Chrome, so the bundled woff2 files (web_accessible_resources) are added
 * to the page's FontFaceSet under names no page uses. A page whose CSP
 * blocks extension fonts simply keeps the system-ui fallback.
 */
export const PILL_FONT = '"hiredvideo Geist", system-ui, -apple-system, "Segoe UI", sans-serif';

const FACES = [{ family: "hiredvideo Geist", file: "fonts/geist.woff2" }] as const;

let loaded = false;

export function loadPillFonts(): void {
  if (loaded || typeof FontFace === "undefined") return;
  loaded = true;
  for (const face of FACES) {
    try {
      const font = new FontFace(face.family, `url("${chrome.runtime.getURL(face.file)}") format("woff2")`, {
        weight: "200 800",
        display: "swap",
      });
      document.fonts.add(font);
      void font.load().catch(() => undefined);
    } catch {
      /* fallback stack */
    }
  }
}
