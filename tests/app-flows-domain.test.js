/**
 * Pure domain logic behind the recruiter / sales flows and the profile
 * import: profile compare (suggestions only — never their facts), whose
 * profile it is, connector matching, the import review decisions, consent
 * rules, outreach chips, video meta, and same-page matching.
 *
 * Run: node --test tests/app-flows-domain.test.js
 */
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { loadTs } = require("./helpers/load-ts");

const compare = loadTs("app/src/panel/domain/profile-compare.ts");
const owner = loadTs("app/src/panel/domain/profile-owner.ts");
const connectors = loadTs("app/src/panel/domain/connectors.ts");
const review = loadTs("app/src/panel/domain/merge-review.ts");
const consent = loadTs("app/src/panel/domain/consent.ts");
const outreach = loadTs("app/src/panel/domain/outreach.ts");
const meta = loadTs("app/src/panel/domain/video-meta.ts");
const pageMatch = loadTs("app/src/panel/domain/page-match.ts");
const signals = loadTs("app/src/panel/domain/profile-signals.ts");

// A realistic master + someone else's parsed profile.
const mine = {
  basics: { name: "Ana Ruiz", label: "Data Engineer", summary: "" },
  work: [{ name: "Northwind", position: "Data Engineer", highlights: ["Built the ingestion pipeline", "Cut costs 30%"] }],
  skills: [{ name: "Python", level: "", keywords: ["SQL"] }, { name: "Kafka", level: "", keywords: [] }],
  certificates: [],
  projects: [],
};
const theirs = {
  basics: { name: "Jordan Rivera", label: "Staff Data Engineer · streaming at scale", summary: "I build streaming platforms." },
  work: [
    { name: "Acme Logistics", position: "Staff Data Engineer", startDate: "2019-01", highlights: ["Scaled Kafka to 2M msgs/s", "Led 6 engineers", "Saved $1.2M"] },
  ],
  skills: [{ name: "kafka", keywords: ["Spark", "sql"] }, { name: "dbt", keywords: [] }, { name: "Spark", keywords: [] }],
  certificates: [{ name: "AWS Data Analytics", issuer: "AWS" }],
  projects: [{ name: "Open-source CDC", highlights: [] }],
  volunteer: [],
};

describe("profile compare", () => {
  const c = compare.compareProfiles(mine, theirs);

  it("lists only the skills I lack, once each, case-insensitively", () => {
    assert.deepEqual(c.missingSkills, ["Spark", "dbt"]);
  });

  it("suggests sections they have and I don't", () => {
    assert.deepEqual(c.missingSections.map((s) => s.id), ["certificates", "projects"]);
  });

  it("compares headline, summary and quantified bullets", () => {
    assert.equal(c.headline.mine, "Data Engineer");
    assert.equal(c.headline.theirs, "Staff Data Engineer · streaming at scale");
    assert.equal(c.summary.mine, 0);
    assert.ok(c.summary.theirs > 0);
    assert.equal(c.density.theirs.quantified, 3);
    assert.equal(c.density.mine.quantified, 1);
    assert.equal(c.quantifyTip, true);
  });

  it("an empty profile suggests nothing", () => {
    const none = compare.compareProfiles(mine, {});
    assert.deepEqual(none.missingSkills, []);
    assert.deepEqual(none.missingSections, []);
    assert.equal(none.quantifyTip, false);
  });

  it("saves only what I confirmed — never their employers, titles, dates or bullets", () => {
    const out = compare.applyConfirmedSuggestions(mine, { skills: ["dbt"], headline: "Data Engineer · streaming" });
    assert.deepEqual(out.skills.map((s) => s.name), ["Python", "Kafka", "dbt"]);
    assert.equal(out.basics.label, "Data Engineer · streaming");
    assert.deepEqual(out.work, mine.work);
    const text = JSON.stringify(out);
    for (const fact of ["Acme Logistics", "Staff Data Engineer", "2019-01", "Scaled Kafka", "Jordan", "AWS Data Analytics"]) {
      assert.ok(!text.includes(fact), `leaked ${fact}`);
    }
  });

  it("an unchanged headline and no skills is no change", () => {
    assert.equal(compare.hasConfirmedChanges(mine, { skills: [], headline: " Data Engineer " }), false);
    assert.equal(compare.hasConfirmedChanges(mine, { skills: ["dbt"], headline: "" }), true);
    const same = compare.applyConfirmedSuggestions(mine, { skills: [], headline: "" });
    assert.equal(same.basics.label, "Data Engineer");
  });
});

describe("whose profile", () => {
  it("matches my first + last name, ignoring accents, case and middle names", () => {
    assert.equal(owner.isOwnProfile({ name: "José A. Ruiz", sourceUrl: "https://x.test/p" }, { name: "jose ruiz" }), true);
    assert.equal(owner.isOwnProfile({ name: "Ana Ruiz", sourceUrl: "https://x.test/p" }, { name: "Ana Lopez" }), false);
    assert.equal(owner.isOwnProfile({ name: "Ana", sourceUrl: "https://x.test/p" }, { name: null }), false);
  });

  it("LinkedIn's /in/me is always mine", () => {
    assert.equal(owner.isOwnProfile({ name: "Someone", sourceUrl: "https://www.linkedin.com/in/me/" }, null), true);
  });

  it("initials", () => {
    assert.equal(owner.initialsOf("Jordan Rivera"), "JR");
    assert.equal(owner.initialsOf("Priya"), "PR");
    assert.equal(owner.initialsOf("  "), "");
  });
});

describe("connector for a page", () => {
  const list = [
    { id: "linkedin", label: "LinkedIn", editProfileUrl: "https://www.linkedin.com/in/me/edit", supportsExtensionExtract: true },
    { id: "indeed", label: "Indeed", editProfileUrl: "https://profile.indeed.com/", supportsExtensionExtract: true },
    { id: "wellfound", label: "Wellfound", editProfileUrl: "https://wellfound.com/profile/edit", supportsExtensionExtract: true },
    { id: "personal-site", label: "Site", editProfileUrl: "https://example.com", supportsExtensionExtract: false },
  ];
  it("matches the site, subdomains and aliases", () => {
    assert.equal(connectors.connectorForUrl("https://www.linkedin.com/in/jordan", list).id, "linkedin");
    assert.equal(connectors.connectorForUrl("https://www.indeed.com/r/abc", list).id, "indeed");
    assert.equal(connectors.connectorForUrl("https://angel.co/u/jordan", list).id, "wellfound");
  });
  it("never picks a connector that can't read pages", () => {
    assert.equal(connectors.connectorForUrl("https://example.com/me", list), null);
    assert.equal(connectors.connectorForUrl("not a url", list), null);
  });
});

describe("import review", () => {
  const analysis = {
    basics: { conflicts: [{ field: "label", sourceValue: "Staff DE", targetValue: "DE" }], autoMerge: false },
    sectionMatches: [
      { sectionType: "work", sourceIndex: 0, targetIndex: 0, confidence: 0.9, matchReason: "", mergeAction: "auto", hasContentDifferences: true },
      { sectionType: "work", sourceIndex: 1, targetIndex: 2, confidence: 0.3, matchReason: "", mergeAction: "skip" },
      { sectionType: "skills", sourceIndex: 0, targetIndex: 1, confidence: 1, matchReason: "", mergeAction: "auto" },
    ],
    newSections: [
      { sectionType: "certificates", sourceIndex: 0, item: { name: "AWS" } },
      { sectionType: "volunteer", sourceIndex: 0, item: { organization: "Acme" }, crossSectionConflict: { suggestedSection: "work", reason: "" } },
    ],
    summary: { totalSections: 3, autoMerge: 2, manualReview: 0, skip: 1, newItems: 2 },
  };
  const shared = loadTs("../hired.video/shared/resume-merge-decisions.ts");

  it("asks only about matched entries that differ", () => {
    assert.deepEqual(review.reviewableMatches(analysis), [0]);
  });

  it("starts from the shared defaults", () => {
    assert.deepEqual(review.initialChoices(analysis), ["combine", "mine", "combine"]);
    assert.deepEqual(shared.buildBasicDecisions(analysis), { label: "target" });
    const items = shared.buildNewItemDecisions(analysis);
    assert.equal(items.get("certificates:0"), true);
    assert.equal(items.get("volunteer:0"), false);
  });

  it("turns choices into engine actions plus the included adds", () => {
    const items = shared.buildNewItemDecisions(analysis);
    const out = review.finalImportDecisions(analysis, ["profile", "mine", "combine"], items);
    assert.deepEqual(out.map((d) => d.action), ["replace", "skip", "merge", "add"]);
    assert.deepEqual(out[3], { sectionType: "certificates", sourceIndex: 0, targetIndex: null, action: "add" });
  });

  it("describes an entry in its own words", () => {
    assert.deepEqual(review.describeEntry({ name: "Acme", position: "Engineer" }), { label: "Acme", secondary: "Engineer" });
    assert.deepEqual(review.describeEntry({ Institution: "CSU", studyType: "BS" }), { label: "CSU", secondary: "BS" });
    assert.equal(review.fieldLabelKey("startDate"), "field_startDate");
    assert.equal(review.fieldLabelKey("whatever"), "field_other");
  });
});

describe("candidate consent", () => {
  const at = "2026-10-16T00:00:00Z";
  const c = (status) => ({ id: status, projectId: "p", candidateName: "J", candidateEmail: "j@x.test", status, requestedAt: at, respondedAt: null, expiresAt: at });

  it("only an approval unlocks public posting", () => {
    for (const s of ["pending", "declined", "expired", "revoked"]) assert.equal(consent.consentAllowsPublic(c(s)), false, s);
    assert.equal(consent.consentAllowsPublic(c("approved")), true);
    assert.equal(consent.consentAllowsPublic(null), false);
  });

  it("resend only while unanswered; never re-asks after a no", () => {
    assert.equal(consent.canResend(c("pending")), true);
    assert.equal(consent.canResend(c("expired")), true);
    assert.equal(consent.canResend(c("declined")), false);
    assert.equal(consent.canResend(c("revoked")), false);
  });

  it("the newest request counts", () => {
    assert.equal(consent.currentConsent([c("approved"), c("pending")]).status, "approved");
    assert.equal(consent.currentConsent([]), null);
  });

  it("every status has a label", () => {
    for (const s of ["pending", "approved", "declined", "expired", "revoked"]) assert.ok(consent.CONSENT_STATUS_VIEW[s].labelKey, s);
  });

  it("reads the server's refusal: content changed vs no longer valid", () => {
    assert.equal(consent.consentRefusal({ code: "CONSENT_REQUIRED", details: { reason: "content_changed" } }), "contentChanged");
    assert.equal(consent.consentRefusal({ code: "CONSENT_REQUIRED", details: null }), "invalid");
    assert.equal(consent.consentRefusal({ code: "PRO_REQUIRED" }), null);
    assert.equal(consent.consentRefusal(null), null);
  });

  it("asks again only while the refusal is about the current request, or after a withdrawal", () => {
    const approved = c("approved");
    assert.equal(consent.askAgainReason(approved, { consentId: "approved", reason: "contentChanged" }), "contentChanged");
    assert.equal(consent.askAgainReason(c("pending"), { consentId: "approved", reason: "invalid" }), null);
    assert.equal(consent.askAgainReason(c("revoked"), null), "invalid");
    assert.equal(consent.askAgainReason(approved, null), null);
    assert.equal(consent.askAgainReason(null, { consentId: null, reason: "invalid" }), "invalid");
  });

  it("checks the email", () => {
    assert.equal(consent.isEmail(" j@x.test "), true);
    assert.equal(consent.isEmail("j@x"), false);
  });
});

describe("outreach", () => {
  const candidate = {
    profile: { name: "Jordan", title: "Staff DE", company: "Acme", location: "", summary: "Streams data. Loves dbt.", skills: ["Kafka", "Spark", "dbt", "SQL"], experience: [], education: [], email: null },
    talentPoolId: "tp1",
    duplicate: false,
  };
  const job = { id: "j1", title: "Senior DE", company: "Contoso", location: "Remote", sourceUrl: "", applyUrl: "", description: "", pipelineStatus: null };

  it("offers chips from the candidate and job; only the ones left on reach the AI", () => {
    const chips = outreach.personalizeChips(candidate, job);
    assert.deepEqual(chips.map((c) => c.id), ["skill:Kafka", "skill:Spark", "skill:dbt", "role", "summary", "location"]);
    assert.equal(chips.find((c) => c.id === "summary").fact, "Streams data.");
    assert.equal(outreach.chipFacts(chips, new Set(["skill:Kafka", "location"])), "Kafka; Remote");
    assert.equal(outreach.chipFacts(chips, new Set()), "");
  });

  it("has a daily pitch cap", () => {
    assert.ok(outreach.PITCH_DAILY_CAP > 0);
  });
});

describe("video meta", () => {
  it("before a script: only the requested length", () => {
    assert.deepEqual(meta.videoMeta(null, 30), { aspectKey: null, seconds: 30, captions: null });
  });
  it("from the script: aspect, length, captions", () => {
    const script = { video: { duration: 31.6, aspect: "1:1", captions: { enabled: true } }, scenes: [{ id: "1", type: "t", duration: 3, title: "Hi" }] };
    assert.deepEqual(meta.videoMeta(script, 30), { aspectKey: "videoMeta_square", seconds: 32, captions: true });
    assert.equal(meta.videoTitle(script, "fallback"), "Hi");
    assert.equal(meta.videoTitle(null, "fallback"), "fallback");
  });
});

describe("same page", () => {
  it("ignores query, hash and trailing slash", () => {
    assert.equal(pageMatch.samePage("https://www.linkedin.com/in/a/?x=1#y", "https://www.linkedin.com/in/a"), true);
    assert.equal(pageMatch.samePage("https://www.linkedin.com/in/a", "https://www.linkedin.com/in/b"), false);
    assert.equal(pageMatch.samePage(null, "https://x.test"), false);
  });
});

describe("prospect signals", () => {
  const detected = { kind: "profile", name: "Priya", title: "Head of Talent", company: "Contoso", location: "", sourceUrl: "" };
  it("reads a sentence, the current role and top skills", () => {
    const out = signals.profileSignals(
      { basics: { summary: "Scaling hiring across 3 regions. Ex-Google." }, work: [{ name: "Contoso", position: "Head of Talent" }], skills: [{ name: "ATS" }] },
      detected,
    );
    assert.deepEqual(out, ["Scaling hiring across 3 regions.", "Head of Talent · Contoso", "ATS"]);
  });
  it("falls back to what the page showed", () => {
    assert.deepEqual(signals.profileSignals(null, detected), ["Head of Talent · Contoso"]);
  });
});
