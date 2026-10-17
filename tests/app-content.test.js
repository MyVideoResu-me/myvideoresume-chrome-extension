/**
 * My content: which tabs each lens sees, the cover letters list (letters
 * live on tailored versions), the videos list, and the shared search.
 *
 * Run: node --test tests/app-content.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts");

const { contentTabsFor, defaultContentTab } = loadTs("app/src/panel/domain/content-tabs.ts");
const { listLetters } = loadTs("app/src/panel/domain/letters.ts");
const { listVideos, canWatch } = loadTs("app/src/panel/domain/videos.ts");
const { matchesQuery } = loadTs("app/src/panel/domain/search.ts");

const resume = (id, title, letter, updatedAt) => ({ id, title, isMaster: !letter, isActive: false, masterId: "m1", updatedAt, letter });

describe("content tabs", () => {
  it("job seekers see their résumés, letters, videos and jobs — not candidates", () => {
    assert.deepEqual(contentTabsFor("jobSeeker"), ["resumes", "letters", "videos", "jobs"]);
    assert.equal(defaultContentTab("jobSeeker"), "resumes");
  });
  it("recruiters also see candidates, and open on them", () => {
    assert.ok(contentTabsFor("recruiter").includes("candidates"));
    assert.equal(defaultContentTab("recruiter"), "candidates");
  });
});

describe("listLetters", () => {
  const list = [
    resume("m1", "Sean Hogg", null, "2026-10-01T00:00:00Z"),
    resume("v1", "CIO - Macomb", { jobTitle: "Chief Information Officer", organization: "Macomb Community College" }, "2026-10-05T00:00:00Z"),
    resume("v2", "Director - Acme", { jobTitle: "", organization: "Acme" }, "2026-10-09T00:00:00Z"),
    resume("v3", "No letter version", null, "2026-10-10T00:00:00Z"),
  ];
  it("lists only versions with a saved letter, newest first, titled by the job", () => {
    const out = listLetters(list);
    assert.deepEqual(out.map((l) => l.resume.id), ["v2", "v1"]);
    assert.equal(out[1].jobTitle, "Chief Information Officer");
    assert.equal(out[0].jobTitle, "Director - Acme", "falls back to the version title");
  });
  it("searches the job, the organisation and the version title", () => {
    assert.deepEqual(listLetters(list, "macomb").map((l) => l.resume.id), ["v1"]);
    assert.deepEqual(listLetters(list, "ACME").map((l) => l.resume.id), ["v2"]);
    assert.deepEqual(listLetters(list, "nurse"), []);
  });
});

describe("listVideos", () => {
  const p = (id, mediaKind, status, updatedAt, videoUrl = null) => ({
    id, title: `Video ${id}`, status, mediaKind, thumbnailUrl: null, videoUrl, slug: null, isPublic: false, updatedAt,
  });
  const projects = [
    p("a", "video", "Draft", "2026-10-01T00:00:00Z"),
    p("b", "podcast", "Completed", "2026-10-05T00:00:00Z"),
    p("c", "video", "Completed", "2026-10-07T00:00:00Z", "https://cdn/x.mp4"),
  ];
  it("keeps video projects only, newest first", () => {
    assert.deepEqual(listVideos(projects).map((v) => v.id), ["c", "a"]);
  });
  it("only a finished video with a file can be watched", () => {
    assert.equal(canWatch(projects[2]), true);
    assert.equal(canWatch(projects[0]), false);
  });
});

describe("matchesQuery", () => {
  it("is case-insensitive, trims, and an empty query matches", () => {
    assert.equal(matchesQuery("  acme ", "ACME Corp"), true);
    assert.equal(matchesQuery("", "anything"), true);
    assert.equal(matchesQuery("x", null, undefined, "abc"), false);
  });
});
