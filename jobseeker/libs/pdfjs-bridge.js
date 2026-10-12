// ES-module bridge that loads pdfjs-dist and exposes a plain-callable
// helper on `window` so the classic-script sidepanel.js can use it
// without being refactored into a module.
//
// Why a bridge: pdfjs-dist v4+ ships only ES modules. Sidepanel.js is
// loaded as a classic script (it relies on global chrome.*/shared util
// functions from constants.js, utils.js, etc.), so it can't `import`.
// This file runs as <script type="module">, imports pdfjs, and sets up
// `window.hiredVideoExtractPdfText` which the sidepanel can await.
//
// The worker URL has to point inside the extension — pdfjs refuses to
// spawn a cross-origin worker from a CDN under Chrome's MV3 CSP.

import * as pdfjs from "./pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
  "libs/pdf.worker.min.mjs",
);

/**
 * Extract plain text from a PDF's raw bytes using pdfjs-dist. Mirrors
 * the web UI's `extractTextFromPdf` in frontend/lib/extract-text.ts
 * so PDFs parse identically in both surfaces — same library, same
 * options, same output shape.
 *
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
async function extractPdfText(bytes) {
  const doc = await pdfjs.getDocument({
    data: bytes,
    // Side panel has no DOM for font rendering; skip to avoid warnings.
    disableFontFace: true,
    // Bundled standard font data would add ~1.5 MB for no benefit here —
    // we only want text content, not visual fidelity.
    useSystemFonts: false,
  }).promise;

  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const parts = [];
    for (const item of content.items) {
      if (!("str" in item)) continue;
      parts.push(item.str);
      if (item.hasEOL) parts.push("\n");
    }
    pages.push(parts.join(""));
  }

  return pages.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

window.hiredVideoExtractPdfText = extractPdfText;

// Signal readiness so consumers that loaded before this module finished
// evaluating can await initialisation deterministically if needed.
window.dispatchEvent(new CustomEvent("hired-video:pdfjs-ready"));
