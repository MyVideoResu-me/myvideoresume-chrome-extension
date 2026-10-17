/**
 * Video reuse keys (domain/video-reuse.ts): one Studio project per target —
 * stable across URL noise, distinct between targets.
 *
 * Run: node --test tests/app-video-reuse.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts");

const reuse = loadTs("app/src/panel/domain/video-reuse.ts");

describe("pageKey", () => {
  it("ignores query, hash and trailing slash", () => {
    assert.equal(reuse.pageKey("https://x.com/a/status/1?s=20#top"), reuse.pageKey("https://x.com/a/status/1/"));
  });

  it("collapses a LinkedIn profile's sub-pages to the person", () => {
    const base = reuse.pageKey("https://www.linkedin.com/in/Jane-Doe/");
    assert.equal(reuse.pageKey("https://www.linkedin.com/in/jane-doe/overlay/contact-info/?miniProfileUrn=x"), base);
    assert.equal(base, "www.linkedin.com/in/jane-doe");
  });

  it("keeps different pages apart", () => {
    assert.notEqual(reuse.pageKey("https://www.linkedin.com/in/a"), reuse.pageKey("https://www.linkedin.com/in/b"));
  });

  it("is empty for missing or broken URLs", () => {
    assert.equal(reuse.pageKey(""), "");
    assert.equal(reuse.pageKey(null), "");
    assert.equal(reuse.pageKey("not a url"), "");
  });
});

describe("textKey", () => {
  it("is stable across whitespace and case", () => {
    assert.equal(reuse.textKey("Hello   World\n"), reuse.textKey("hello world"));
  });

  it("tells two posts apart", () => {
    assert.notEqual(reuse.textKey("First post"), reuse.textKey("Second post"));
  });
});
