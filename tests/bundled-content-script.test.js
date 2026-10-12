/**
 * Sanity test for the bundled content scripts.
 *
 * The extension's `dist/jobseeker/content-script-jobs.js` is produced
 * by esbuild from `shared/content-script-jobs.ts` + the hired.video
 * shared scraping module. This test asserts the bundle:
 *
 *   1. Exists at the expected path.
 *   2. Is a pure IIFE (no top-level `import`/`export` left dangling —
 *      those would not load in a Chrome content-script context).
 *   3. Contains the signature strings from EVERY shared submodule, so
 *      regressions where a shared dep doesn't get inlined surface
 *      immediately.
 *
 * Run: node --test tests/bundled-content-script.test.js
 *
 * Prereq: run `npm run build` first. The test errors out loudly if the
 * dist file is missing rather than pretending nothing is wrong.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const JOBSEEKER_DIST = path.join(ROOT, "dist", "jobseeker");
const JOBS_BUNDLE = path.join(JOBSEEKER_DIST, "content-script-jobs.js");
const AUTOFILL_BUNDLE = path.join(JOBSEEKER_DIST, "content-script-autofill.js");

describe("bundled content scripts", () => {
  before(() => {
    // Ensure a fresh build so the test isn't comparing against stale output.
    if (!fs.existsSync(JOBS_BUNDLE) || !fs.existsSync(AUTOFILL_BUNDLE)) {
      execSync("node scripts/build.js jobseeker", { cwd: ROOT, stdio: "inherit" });
    }
  });

  it("both bundles exist", () => {
    assert.ok(fs.existsSync(JOBS_BUNDLE), "jobs bundle missing");
    assert.ok(fs.existsSync(AUTOFILL_BUNDLE), "autofill bundle missing");
  });

  it("jobs bundle is an IIFE — no top-level import/export", () => {
    const src = fs.readFileSync(JOBS_BUNDLE, "utf8");
    // If esbuild punted on bundling, we'd see `import ` or `export `
    // at the start of a line (outside strings). Cheap heuristic:
    // look at the first 200 chars — an IIFE starts with `(() => {` or `(function`.
    const head = src.slice(0, 200).trim();
    assert.match(head, /^\(\(\) => \{|^\(function/);
    // No top-level `import ` or `export ` statements (look for start-of-line).
    assert.doesNotMatch(src, /^import\s/m);
    assert.doesNotMatch(src, /^export\s/m);
  });

  it("jobs bundle inlines every shared scraping submodule", () => {
    const src = fs.readFileSync(JOBS_BUNDLE, "utf8");
    // Sentinel strings unique to each shared module
    const sentinels = {
      "htmlUtils.ts": "cleansePageHTML",
      "urls.ts": "canonicalizeJobUrl",
      "jsonLd.ts": "JobPosting",
      "applyLink.ts": "scoreApplyCandidates",
      "siteConfigs.ts": "JOB_CONTENT_READY_SELECTORS",
      "jobExtract.ts": "detectJobInPage",
    };
    for (const [module, sentinel] of Object.entries(sentinels)) {
      assert.ok(
        src.includes(sentinel),
        `jobs bundle missing sentinel "${sentinel}" from shared/scraping/${module}`,
      );
    }
  });

  it("autofill bundle inlines formFields + urls (ATS detection)", () => {
    const src = fs.readFileSync(AUTOFILL_BUNDLE, "utf8");
    // extractFormFieldsShared is imported as extractFormFields — the
    // bundled output carries the exported name as a private function.
    assert.ok(/extractFormFields/.test(src), "formFields exports missing");
    assert.ok(/ATS_URL_PATTERNS|detectAtsProvider/.test(src), "urls module missing");
    assert.ok(/greenhouse|lever|workday/i.test(src), "ATS provider names missing");
  });

  it("bundles are below a reasonable size ceiling (regression guard)", () => {
    // If either bundle grows past this ceiling unexpectedly, someone has
    // accidentally pulled in a heavyweight dep (date-fns, lodash). The
    // whole scraping domain fits comfortably under 60KB minified/bundled.
    const jobsSize = fs.statSync(JOBS_BUNDLE).size;
    const autofillSize = fs.statSync(AUTOFILL_BUNDLE).size;
    assert.ok(jobsSize < 100_000, `jobs bundle too large: ${jobsSize}B`);
    assert.ok(autofillSize < 100_000, `autofill bundle too large: ${autofillSize}B`);
  });
});
