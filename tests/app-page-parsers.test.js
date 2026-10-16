/**
 * Page readers with a minimal fake DOM: post permalinks (post-parsers),
 * the shared autofill matcher, and tracked-job URL matching.
 *
 * Run: node --test tests/app-page-parsers.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts");

const posts = loadTs("app/src/content/post-parsers.ts");
const autofill = loadTs("shared/autofill-matcher.ts");
const jobs = loadTs("app/src/panel/state/jobs.ts");

/** A tiny element tree: { selector → node } lookups, text via textContent. */
function fakeNode(map) {
  return {
    querySelector: (sel) => {
      for (const part of sel.split(",").map((s) => s.trim())) if (map[part]) return map[part];
      return null;
    },
  };
}
const text = (t) => ({ textContent: t });

describe("post parsers", () => {
  const container = fakeNode({
    "[data-testid='tweetText']": text("Hiring managers: what made you skip the stack?"),
    "[data-testid='User-Name']": text("Marcus Lee\n@marcus"),
  });
  const doc = fakeNode({ "article[data-testid='tweet']": container });

  it("reads an X status page", () => {
    const post = posts.readPost(doc, { hostname: "x.com", pathname: "/marcus/status/123", href: "https://x.com/marcus/status/123" });
    assert.deepEqual(post, {
      author: "Marcus Lee",
      text: "Hiring managers: what made you skip the stack?",
      sourceUrl: "https://x.com/marcus/status/123",
      platform: "x",
    });
  });

  it("ignores feeds and unknown sites", () => {
    assert.equal(posts.readPost(doc, { hostname: "x.com", pathname: "/home", href: "https://x.com/home" }), null);
    assert.equal(posts.readPost(doc, { hostname: "example.com", pathname: "/a/status/1", href: "" }), null);
  });

  it("reads a LinkedIn post page", () => {
    const li = fakeNode({
      ".feed-shared-update-v2": fakeNode({
        ".update-components-text": text("We are hiring!"),
        ".update-components-actor__name": text("Priya Shah"),
      }),
    });
    const post = posts.readPost(li, {
      hostname: "www.linkedin.com",
      pathname: "/posts/priya_hiring-activity-1",
      href: "https://www.linkedin.com/posts/priya_hiring-activity-1",
    });
    assert.equal(post.author, "Priya Shah");
    assert.equal(post.platform, "linkedin");
  });
});

describe("autofill matcher (shared by app + legacy panel)", () => {
  const profile = autofill.extractResumeBasics({
    content: JSON.stringify({
      basics: { name: "Ana María López", email: "ana@example.com", location: { city: "Austin", region: "TX" } },
      work: [{ name: "Acme", position: "PM", startDate: "2019-01", endDate: "2021-01" }],
    }),
  });

  it("flattens a JSON-string résumé", () => {
    assert.equal(profile.firstName, "Ana");
    assert.equal(profile.lastName, "María López");
    assert.equal(profile.currentCompany, "Acme");
    assert.equal(profile.yearsExperience, "2");
  });

  it("specific labels win over generic ones", () => {
    assert.deepEqual(autofill.pickAutofillValue({ id: "f1", label: "First name" }, profile), { key: "firstName", value: "Ana" });
    assert.deepEqual(autofill.pickAutofillValue({ id: "n", label: "Name" }, profile), { key: "fullName", value: "Ana María López" });
  });

  it("a written cover letter fills the cover-letter field before the summary", () => {
    const p = { ...profile, summary: "Summary", coverLetter: "Dear team" };
    assert.equal(autofill.pickAutofillValue({ id: "c", label: "Cover letter" }, p).value, "Dear team");
    const noLetter = { ...profile, summary: "Summary" };
    assert.equal(autofill.pickAutofillValue({ id: "c", label: "Cover letter" }, noLetter).value, "Summary");
  });

  it("returns null when nothing fits", () => {
    assert.equal(autofill.pickAutofillValue({ id: "q", label: "Favourite colour" }, profile), null);
  });
});

describe("tracked job matching", () => {
  const saved = [
    { id: "1", sourceUrl: "https://www.linkedin.com/jobs/view/123/", applyUrl: "https://acme.wd1.myworkdayjobs.com/apply/9" },
  ];
  it("matches the listing across URL variants", () => {
    assert.equal(jobs.findTrackedJob(saved, "https://www.linkedin.com/jobs/view/123/?trk=abc")?.id, "1");
  });
  it("matches the apply page", () => {
    assert.equal(jobs.findTrackedJob(saved, "https://acme.wd1.myworkdayjobs.com/apply/9")?.id, "1");
  });
  it("misses other jobs", () => {
    assert.equal(jobs.findTrackedJob(saved, "https://www.linkedin.com/jobs/view/999/"), null);
  });
});
