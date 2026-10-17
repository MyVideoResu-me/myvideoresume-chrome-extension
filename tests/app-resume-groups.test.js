/**
 * The "My résumés" list: masters newest first, versions folded under their
 * master, search keeps a matching version's master visible.
 *
 * Run: node --test tests/app-resume-groups.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts");

const { groupResumes } = loadTs("app/src/panel/domain/resume-groups.ts");

const r = (id, title, isMaster, masterId, updatedAt) => ({ id, title, isMaster, isActive: false, masterId, updatedAt });
const list = [
  r("m1", "Sean Hogg", true, "m1", "2026-09-01T00:00:00Z"),
  r("v1", "CIO - Macomb Community College", false, "m1", "2026-10-02T00:00:00Z"),
  r("v2", "Director of IT - Acme", false, "m1", "2026-10-05T00:00:00Z"),
  r("m2", "Sean Hogg Resume", true, "m2", "2026-10-10T00:00:00Z"),
  r("m3", "SEAN HOGG", true, "m3", null),
];

describe("groupResumes", () => {
  it("lists masters newest first, undated last, with versions newest first", () => {
    const groups = groupResumes(list);
    assert.deepEqual(groups.map((g) => g.master.id), ["m2", "m1", "m3"]);
    assert.deepEqual(groups[1].versions.map((v) => v.id), ["v2", "v1"]);
    assert.ok(groups.every((g) => !g.matchedVersion));
  });

  it("a version match keeps its master and only the matching versions, opened", () => {
    const [g, ...rest] = groupResumes(list, "macomb");
    assert.equal(rest.length, 0);
    assert.equal(g.master.id, "m1");
    assert.deepEqual(g.versions.map((v) => v.id), ["v1"]);
    assert.equal(g.matchedVersion, true);
  });

  it("a master match keeps all its versions; search is case-insensitive", () => {
    const groups = groupResumes(list, "sean hogg resume");
    assert.deepEqual(groups.map((x) => x.master.id), ["m2"]);
    assert.equal(groupResumes(list, "  SEAN  ").length, 3);
  });

  it("no match returns nothing", () => {
    assert.deepEqual(groupResumes(list, "nurse"), []);
  });
});
