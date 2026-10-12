/**
 * Unit tests for row-scoped success/warning/info/error feedback
 * (gap #881). `showRowFeedback` lives in jobseeker/sidepanel.js and is
 * not exported — we extract the helper block and evaluate it against a
 * minimal DOM mock.
 *
 * Run: node --test tests/row-feedback.test.js
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SIDEPANEL = path.join(ROOT, "jobseeker", "sidepanel.js");
const STYLES = path.join(ROOT, "shared", "styles.css");

function extractHelpers(src) {
  const start = src.indexOf("function showRowFeedback");
  const end = src.indexOf("async function onTrackedJobAction");
  assert.ok(start >= 0, "showRowFeedback not found in sidepanel.js");
  assert.ok(end > start, "onTrackedJobAction not found after showRowFeedback");
  return src.slice(start, end);
}

class TokenList {
  constructor(initial) {
    this._set = new Set(initial || []);
  }
  add(...tokens) {
    for (const t of tokens) if (t) this._set.add(t);
  }
  remove(...tokens) {
    for (const t of tokens) this._set.delete(t);
  }
  contains(token) {
    return this._set.has(token);
  }
  toArray() {
    return [...this._set];
  }
}

function makeDom({ jobId = "job-1", withRow = true, withSlot = true } = {}) {
  const slot = withSlot
    ? {
        textContent: "",
        classList: new TokenList(["tracked-job-row-error", "hidden"]),
      }
    : null;
  const row = withRow
    ? {
        scrolled: false,
        querySelector(sel) {
          return sel.includes("tracked-job-row-error") ? slot : null;
        },
        scrollIntoView() {
          this.scrolled = true;
        },
      }
    : null;

  const document = {
    querySelector(sel) {
      if (!withRow) return null;
      if (!sel.includes(`[data-job-id="${jobId}"]`)) return null;
      if (sel.includes("tracked-job-row-error") && sel.includes(".tracked-job-row[")) {
        return slot;
      }
      if (sel.startsWith(".tracked-job-row[") && !sel.includes("tracked-job-row-error")) {
        return row;
      }
      if (sel.includes(".tracked-job-row-error")) return slot;
      return row;
    },
  };

  return { document, row, slot };
}

function loadHelpers(document, showQuickStatus) {
  const src = fs.readFileSync(SIDEPANEL, "utf8");
  const helpers = extractHelpers(src);
  const context = { document, showQuickStatus, console };
  vm.createContext(context);
  vm.runInContext(helpers, context);
  return context;
}

describe("showRowFeedback (gap #881)", () => {
  it("writes success/warning/info/error into the row slot, not the global banner", () => {
    const { document, row, slot } = makeDom();
    const global = [];
    const ctx = loadHelpers(document, (message, kind) => global.push({ message, kind }));

    ctx.showRowFeedback("job-1", "Already tailored — download instead", "success");
    assert.equal(slot.textContent, "Already tailored — download instead");
    assert.equal(slot.classList.contains("hidden"), false);
    assert.equal(slot.classList.contains("is-success"), true);
    assert.equal(row.scrolled, true);
    assert.equal(global.length, 0);

    ctx.showRowFeedback("job-1", "No tailored variation found yet", "warning");
    assert.equal(slot.classList.contains("is-success"), false);
    assert.equal(slot.classList.contains("is-warning"), true);

    ctx.showRowFeedback("job-1", "Page scanned — nothing new to save", "info");
    assert.equal(slot.classList.contains("is-warning"), false);
    assert.equal(slot.classList.contains("is-info"), true);

    ctx.showRowError("job-1", "Could not refresh this job.");
    assert.equal(slot.classList.contains("is-info"), false);
    assert.equal(slot.classList.contains("is-error"), true);
    assert.equal(slot.textContent, "Could not refresh this job.");
    assert.equal(global.length, 0);
  });

  it("falls back to showQuickStatus when the row is not in the DOM", () => {
    const { document } = makeDom({ withRow: false });
    const global = [];
    const ctx = loadHelpers(document, (message, kind) => global.push({ message, kind }));

    ctx.showRowFeedback("job-1", "Removed from your tracker.", "success");
    assert.deepEqual(global, [{ message: "Removed from your tracker.", kind: "success" }]);
  });

  it("falls back to showQuickStatus when jobId is missing", () => {
    const { document } = makeDom();
    const global = [];
    const ctx = loadHelpers(document, (message, kind) => global.push({ message, kind }));

    ctx.showRowFeedback(null, "Something went wrong.", "error");
    assert.deepEqual(global, [{ message: "Something went wrong.", kind: "error" }]);
  });

  it("clearRowError hides the slot and strips kind classes", () => {
    const { document, slot } = makeDom();
    const ctx = loadHelpers(document, () => {});
    ctx.showRowFeedback("job-1", "Updated 2 fields.", "success");
    ctx.clearRowError("job-1");
    assert.equal(slot.textContent, "");
    assert.equal(slot.classList.contains("hidden"), true);
    assert.equal(slot.classList.contains("is-success"), false);
  });
});

describe("row-action call sites (gap #881)", () => {
  const src = fs.readFileSync(SIDEPANEL, "utf8");

  const mustUseRowFeedback = [
    "Already tailored — click",
    "Page scanned — nothing new to save",
    "No tailored variation found for this job yet",
    "This job already has all its info — nothing to refresh",
    "No tailored resume found for this job",
    "Removed from your tracker",
    "Status updated to ${newStatus}",
  ];

  for (const needle of mustUseRowFeedback) {
    it(`routes "${needle.slice(0, 40)}…" through showRowFeedback`, () => {
      const idx = src.indexOf(needle);
      assert.ok(idx >= 0, `message not found: ${needle}`);
      const window = src.slice(Math.max(0, idx - 180), idx);
      assert.match(window, /showRowFeedback\s*\(/, `expected showRowFeedback near: ${needle}`);
      assert.doesNotMatch(window, /showQuickStatus\s*\(/);
    });
  }
});

describe("row feedback palette", () => {
  const css = fs.readFileSync(STYLES, "utf8");

  it("mirrors .alert-* tokens on .tracked-job-row-error.is-*", () => {
    for (const kind of ["success", "warning", "info", "error"]) {
      assert.match(css, new RegExp(`\\.tracked-job-row-error\\.is-${kind}\\s*\\{`));
    }
    assert.match(css, /var\(--success-light\)/);
    assert.match(css, /var\(--warning-light\)/);
    assert.match(css, /var\(--brand-blue-light\)/);
    assert.match(css, /var\(--error-light\)/);
  });
});
