/**
 * Unit tests for content-script-jobs.js applyUrl extraction.
 *
 * These tests validate that detectJobOnPage() and genericJobExtract()
 * populate the `applyUrl` field in the job-detected payload.
 *
 * Run: node --test tests/content-script-applyUrl.test.js
 *
 * We use a lightweight mock DOM since the content script relies on
 * document.querySelectorAll and window.location. The tests exercise
 * the detection functions in isolation by loading the script source
 * and evaluating the relevant functions.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, "..", "shared", "content-script-jobs.js");

// ---------------------------------------------------------------------------
// Minimal DOM / chrome mocks
// ---------------------------------------------------------------------------

/** Build a minimal global environment that content-script-jobs.js expects */
function setupGlobals(htmlString, locationHref) {
  // Collected messages sent via chrome.runtime.sendMessage
  const sentMessages = [];

  const url = new URL(locationHref);

  // Minimal Element class
  class MockElement {
    constructor(tag, attrs = {}, innerHTML = "") {
      this.tagName = tag.toUpperCase();
      this.attributes = attrs;
      this.innerHTML = innerHTML;
      this.textContent = innerHTML.replace(/<[^>]+>/g, "");
      this.outerHTML = `<${tag}>${innerHTML}</${tag}>`;
      this.children = [];
      this.classList = { contains: () => false, add: () => {}, remove: () => {} };
    }
    getAttribute(name) {
      return this.attributes[name] ?? null;
    }
    querySelector(sel) {
      return findInTree(this, sel);
    }
    querySelectorAll(sel) {
      return findAllInTree(this, sel);
    }
    get content() {
      return this.attributes.content ?? "";
    }
  }

  // Parse the HTML into a simple tree we can query
  const jsonLdBlocks = [];
  const metaTags = [];
  let titleText = "";
  let h1Text = "";

  // Extract JSON-LD blocks
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = ldRegex.exec(htmlString)) !== null) {
    jsonLdBlocks.push(m[1]);
  }

  // Extract <title>
  const titleMatch = htmlString.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) titleText = titleMatch[1].trim();

  // Extract <h1>
  const h1Match = htmlString.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) h1Text = h1Match[1].trim();

  // Extract meta tags
  const metaRegex = /<meta\s+([^>]+)\/?>/gi;
  while ((m = metaRegex.exec(htmlString)) !== null) {
    const attrStr = m[1];
    const attrs = {};
    const attrPairRegex = /([\w-]+)=["']([^"']+)["']/g;
    let a;
    while ((a = attrPairRegex.exec(attrStr)) !== null) {
      attrs[a[1]] = a[2];
    }
    metaTags.push(new MockElement("meta", attrs));
  }

  function findInTree(el, selector) {
    const results = findAllInTree(el, selector);
    return results[0] || null;
  }

  function findAllInTree(el, selector) {
    // Handle 'script[type="application/ld+json"]'
    if (selector.includes("application/ld+json")) {
      return jsonLdBlocks.map(
        (content) =>
          new MockElement("script", { type: "application/ld+json" }, content)
      );
    }
    // Handle meta tag selectors
    if (selector.startsWith("meta[")) {
      return metaTags.filter((mt) => {
        if (selector.includes("og:title"))
          return mt.attributes.property === "og:title";
        if (selector.includes("og:site_name"))
          return mt.attributes.property === "og:site_name";
        if (selector.includes("og:description"))
          return mt.attributes.property === "og:description";
        if (selector.includes('name="description"'))
          return mt.attributes.name === "description";
        return false;
      });
    }
    // Handle h1/h2
    if (selector === "h1" || selector === "h1, h2") {
      return h1Text
        ? [new MockElement("h1", {}, h1Text)]
        : [];
    }
    // Handle #job-details
    if (selector === "#job-details") return [];
    // Handle data-testid location
    if (selector.includes("location")) return [];
    // Default: return empty
    return [];
  }

  const mockDocument = {
    title: titleText,
    documentElement: {
      outerHTML: htmlString,
    },
    body: new MockElement("body", {}, htmlString),
    querySelector(sel) {
      return findInTree(null, sel);
    },
    querySelectorAll(sel) {
      return findAllInTree(null, sel);
    },
  };

  const mockWindow = {
    location: {
      href: locationHref,
      hostname: url.hostname,
    },
    __hiredVideoFocusedPaneHtml: undefined,
  };

  const mockChrome = {
    runtime: {
      sendMessage: (msg) => {
        sentMessages.push(msg);
        return Promise.resolve();
      },
      onMessage: {
        addListener: () => {},
      },
    },
  };

  const mockHistory = {
    pushState: () => {},
    replaceState: () => {},
  };

  return {
    document: mockDocument,
    window: mockWindow,
    chrome: mockChrome,
    history: mockHistory,
    sentMessages,
    URL: globalThis.URL,
    setTimeout: globalThis.setTimeout,
    setInterval: () => {},
    clearInterval: () => {},
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
  };
}

/**
 * Load and evaluate content-script-jobs.js in a sandboxed scope,
 * returning the key functions for testing.
 */
function loadContentScript(globals) {
  const src = fs.readFileSync(SCRIPT_PATH, "utf-8");

  // We'll execute the script in a Function scope with our globals injected.
  // First strip the auto-executing code at the bottom (scheduleDetect, observers, etc.)
  // so the tests control when detection runs.

  // The content script declares top-level `let` variables and auto-runs
  // observers / timers. Strip those so we control execution.
  let modifiedSrc = src;

  // Remove the auto-executing tail: scheduleDetect(), MutationObserver,
  // history monkey-patches, setInterval, and the onMessage listener.
  // These start after the `genericJobExtract` function definition.
  const autoInitMarker = "// Run once on initial load";
  const autoInitIdx = modifiedSrc.indexOf(autoInitMarker);
  if (autoInitIdx > 0) {
    modifiedSrc = modifiedSrc.slice(0, autoInitIdx);
  }

  // Build a wrapper that exposes the inner functions
  const wrappedSrc = `
    "use strict";
    const document = __globals.document;
    const window = __globals.window;
    const chrome = __globals.chrome;
    const history = __globals.history;
    const URL = __globals.URL;
    const setTimeout = __globals.setTimeout;
    const setInterval = __globals.setInterval;
    const MutationObserver = __globals.MutationObserver;
    const navigator = { userAgent: "test" };

    ${modifiedSrc}

    return {
      detectJobOnPage,
      genericJobExtract,
      getCanonicalJobUrl,
      lastDetectedPayload: () => lastDetectedPayload,
    };
  `;

  // eslint-disable-next-line no-new-func
  const factory = new Function("__globals", wrappedSrc);
  return factory(globals);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("content-script-jobs.js — applyUrl in detected payload", () => {
  it("includes applyUrl from JSON-LD url field", () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Senior Engineer",
        hiringOrganization: { name: "Acme Corp" },
        url: "https://acme.com/careers/apply/senior-eng",
        jobLocation: { address: { addressLocality: "SF", addressRegion: "CA" } },
      })}</script>
    </head><body></body></html>`;

    const globals = setupGlobals(html, "https://acme.com/careers/senior-eng");
    const script = loadContentScript(globals);

    script.detectJobOnPage();
    const payload = script.lastDetectedPayload();

    assert.ok(payload, "Expected a detected job payload");
    assert.equal(payload.title, "Senior Engineer");
    assert.equal(payload.applyUrl, "https://acme.com/careers/apply/senior-eng");
    assert.equal(payload.sourceUrl, "https://acme.com/careers/senior-eng");
  });

  it("includes applyUrl from JSON-LD directApply field", () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "PM Role",
        hiringOrganization: { name: "BigCo" },
        directApply: "https://bigco.com/apply/pm-42",
        jobLocation: { address: { addressLocality: "NYC" } },
      })}</script>
    </head><body></body></html>`;

    const globals = setupGlobals(html, "https://bigco.com/jobs/pm-42");
    const script = loadContentScript(globals);

    script.detectJobOnPage();
    const payload = script.lastDetectedPayload();

    assert.ok(payload);
    assert.equal(payload.applyUrl, "https://bigco.com/apply/pm-42");
  });

  it("falls back to sourceUrl when JSON-LD has no url/directApply", () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "DevOps",
        hiringOrganization: { name: "CloudInc" },
        jobLocation: { address: { addressLocality: "Remote" } },
      })}</script>
    </head><body></body></html>`;

    const globals = setupGlobals(html, "https://www.linkedin.com/jobs/view/99999/");
    const script = loadContentScript(globals);

    script.detectJobOnPage();
    const payload = script.lastDetectedPayload();

    assert.ok(payload);
    // No explicit apply URL → should fall back to sourceUrl
    assert.equal(
      payload.applyUrl,
      "https://www.linkedin.com/jobs/view/99999/",
      "applyUrl should default to sourceUrl when no JSON-LD url is available"
    );
  });

  it("sends applyUrl in the chrome.runtime.sendMessage payload", () => {
    const html = `<html><head>
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Backend Dev",
        hiringOrganization: { name: "API Co" },
        url: "https://api.co/careers/backend/apply",
      })}</script>
    </head><body></body></html>`;

    const globals = setupGlobals(html, "https://api.co/careers/backend");
    const script = loadContentScript(globals);

    script.detectJobOnPage();

    // Check the message sent to the extension
    const jobMsg = globals.sentMessages.find((m) => m.action === "jobDetected");
    assert.ok(jobMsg, "Expected a jobDetected message");
    assert.equal(jobMsg.payload.applyUrl, "https://api.co/careers/backend/apply");
  });
});
