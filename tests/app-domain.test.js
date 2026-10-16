/**
 * Pure domain logic of the unified app: lens availability + defaults,
 * page-entity normalisation, tailoring review, anonymising, message links,
 * tracked-job URL matching, and the pill's action table.
 *
 * Run: node --test tests/app-domain.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTs, ROOT } = require("./helpers/load-ts");

const lenses = loadTs("app/src/panel/domain/lenses.ts");
const entities = loadTs("app/src/panel/domain/entities.ts");
const docs = loadTs("app/src/panel/domain/resume-docs.ts");
const channels = loadTs("app/src/panel/features/message/channels.ts");
const pill = loadTs("app/src/content/pill-actions.ts");
const roles = loadTs("../hired.video/shared/user-roles.ts");

describe("lenses", () => {
  it("job seeker + sales are open to everyone", () => {
    const ids = lenses.availableLenses("job_seeker").map((l) => l.id);
    assert.ok(ids.includes("jobSeeker"));
    assert.ok(ids.includes("sales"));
  });

  it("hiring is on", () => {
    assert.equal(roles.HIRING_PERSONAS_ENABLED, true);
  });

  it("a hiring role gets the recruiter lens and starts in it", () => {
    for (const role of ["recruiter", "employer"]) {
      const ids = lenses.availableLenses(role).map((l) => l.id);
      assert.ok(ids.includes("recruiter"), role);
      assert.equal(lenses.resolveLens(null, role).id, "recruiter", role);
      assert.equal(lenses.resolveLens("sales", role).id, "sales", role);
    }
  });

  it("admins may use the recruiter lens but start as a job seeker", () => {
    assert.ok(lenses.availableLenses("admin").some((l) => l.id === "recruiter"));
    assert.equal(lenses.resolveLens(null, "admin").id, "jobSeeker");
  });

  it("a job seeker never gets the recruiter lens", () => {
    const ids = lenses.availableLenses("job_seeker").map((l) => l.id);
    assert.ok(!ids.includes("recruiter"));
    assert.equal(lenses.resolveLens(null, "job_seeker").id, "jobSeeker");
  });

  it("a job seeker on a profile can improve their résumé from it", () => {
    const seeker = lenses.LENSES.find((l) => l.id === "jobSeeker");
    assert.ok(seeker.actions.profile.includes("profileImport"));
  });

  it("a saved lens the account may not use falls back to the role default", () => {
    assert.equal(lenses.resolveLens("recruiter", "job_seeker").id, "jobSeeker");
    assert.equal(lenses.resolveLens("sales", "job_seeker").id, "sales");
    assert.equal(lenses.resolveLens(null, "job_seeker").id, "jobSeeker");
  });

  it("every lens offers a list for every page kind", () => {
    for (const lens of lenses.LENSES) {
      for (const kind of ["job", "profile", "post", "none"]) assert.ok(Array.isArray(lens.actions[kind]), `${lens.id}.${kind}`);
    }
  });
});

describe("page entities", () => {
  it("normalises detections and rejects empty ones", () => {
    assert.equal(entities.toDetectedJob(null), null);
    assert.equal(entities.toDetectedJob({ title: "  " }), null);
    const job = entities.toDetectedJob({ title: " PM ", sourceUrl: "https://x.test/j/1" });
    assert.deepEqual(job, { kind: "job", title: "PM", company: "", location: "", sourceUrl: "https://x.test/j/1", applyUrl: "https://x.test/j/1" });
    assert.equal(entities.toDetectedPost({ text: "a".repeat(5000) }).text.length, 4000);
  });

  it("never treats hired.video as a page entity", () => {
    assert.equal(entities.isOwnSite("https://hired.video/jobs"), true);
    assert.equal(entities.isOwnSite("https://www.linkedin.com/jobs/view/1"), false);
    assert.equal(entities.isOwnSite("not a url"), false);
  });
});

describe("tailoring review", () => {
  const original = {
    basics: { name: "Ana", label: "Engineer" },
    skills: [{ name: "Go", level: "", keywords: [] }],
  };
  const tailored = {
    basics: { name: "Ana", label: "Platform Engineer" },
    skills: [{ name: "Go", level: "", keywords: [] }],
  };
  const changes = [{ section: "basics", path: "basics.label", before: "Engineer", after: "Platform Engineer", why: "JD" }];

  it("keeps changes the person kept", () => {
    const out = docs.applyReviewedTailor(original, tailored, changes, new Set(), []);
    assert.equal(out.basics.label, "Platform Engineer");
  });

  it("restores the original value for a change turned off", () => {
    const out = docs.applyReviewedTailor(original, tailored, changes, new Set([0]), []);
    assert.equal(out.basics.label, "Engineer");
  });

  it("adds confirmed skills once", () => {
    const out = docs.applyReviewedTailor(original, tailored, changes, new Set(), ["Kubernetes", "go"]);
    assert.deepEqual(out.skills.map((s) => s.name), ["Go", "Kubernetes"]);
  });
});

describe("candidate résumés", () => {
  const profile = {
    name: "Jordan Rivera",
    title: "Staff Data Engineer",
    company: "Acme",
    location: "Denver",
    summary: "Streaming data.",
    skills: ["Kafka"],
    experience: [{ company: "Acme", title: "Staff Data Engineer", startDate: "2020-01" }],
    education: [{ school: "CSU", degree: "BS" }],
    email: "j@example.com",
  };

  it("builds a JSON Resume from an extracted profile", () => {
    const r = docs.profileToResume(profile);
    assert.equal(r.basics.name, "Jordan Rivera");
    assert.equal(r.work[0].name, "Acme");
    assert.equal(r.skills[0].name, "Kafka");
  });

  it("anonymising removes name, contact and employer names", () => {
    const r = docs.anonymizeResume(docs.profileToResume(profile), "The candidate");
    assert.equal(r.basics.name, "The candidate");
    assert.equal(r.basics.email, undefined);
    assert.equal(r.work[0].name, "");
    assert.equal(r.work[0].position, "Staff Data Engineer");
  });
});

describe("message links", () => {
  it("appends the video link once", () => {
    assert.equal(channels.withLink("Hi", "https://hired.video/m/x"), "Hi\n\nhttps://hired.video/m/x");
    assert.equal(channels.withLink("Hi https://hired.video/m/x", "https://hired.video/m/x"), "Hi https://hired.video/m/x");
    assert.equal(channels.withLink("Hi", null), "Hi");
  });

  it("LinkedIn connection notes cap at 300", () => {
    assert.equal(channels.CHANNELS.linkedinNote.maxChars, 300);
  });
});

describe("pill actions", () => {
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "app", "_locales", "en", "messages.json"), "utf8"));
  it("every lens has a labelled first action for every detected kind", () => {
    for (const [lens, byKind] of Object.entries(pill.PILL_ACTIONS)) {
      for (const kind of ["job", "profile", "post"]) {
        const actions = byKind[kind];
        assert.ok(actions.length > 0, `${lens}.${kind}`);
        for (const a of actions) assert.ok(en[a.labelKey], `${lens}.${kind}.${a.labelKey}`);
      }
    }
  });
});
