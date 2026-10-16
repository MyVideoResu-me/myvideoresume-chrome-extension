/**
 * autofill-matcher — which résumé value goes in which application-form
 * field (imported by the unified app panel).
 *
 *   extractResumeBasics(resume)  → flat { firstName, email, city, … } map
 *   pickAutofillValue(field, p)  → { key, value } for one form field
 */

export type AutofillProfile = Record<string, string>;

export type AutofillField = {
  id: string;
  label?: string;
  name?: string;
  placeholder?: string;
};

type JsonObject = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));

function findResumeDoc(resume: unknown): JsonObject | null {
  if (!resume || typeof resume !== "object") return null;
  const r = resume as JsonObject;
  for (const c of [r.resumeData, r.content, r.data, r]) {
    if (c && typeof c === "object") {
      const o = c as JsonObject;
      if (o.basics || o.work || o.education) return o;
    }
    if (typeof c === "string") {
      try {
        const parsed = JSON.parse(c) as JsonObject;
        if (parsed && (parsed.basics || parsed.work || parsed.education)) return parsed;
      } catch {
        /* not JSON */
      }
    }
  }
  return null;
}

function parseDateToMonths(raw: unknown): number | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return null;
  return Number(m[1]) * 12 + (m[2] ? Number(m[2]) - 1 : 0);
}

function nowMonths(): number {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
}

/** Whole years across all dated work entries; null when none is dated. */
export function totalYearsOfExperience(work: JsonObject[]): number | null {
  let months = 0;
  let any = false;
  for (const job of work) {
    const start = parseDateToMonths(job.startDate);
    if (start == null) continue;
    const end = job.endDate ? parseDateToMonths(job.endDate) : nowMonths();
    if (end == null) continue;
    months += Math.max(0, end - start);
    any = true;
  }
  return any ? Math.max(0, Math.round(months / 12)) : null;
}

/**
 * Flatten a JSON Resume document (any of the shapes the API has returned)
 * into the keys AUTOFILL_PATTERNS routes.
 */
export function extractResumeBasics(resume: unknown): AutofillProfile {
  const doc = findResumeDoc(resume);
  if (!doc) return {};
  const out: AutofillProfile = {};
  const basics = (doc.basics ?? {}) as JsonObject;
  const name = str(basics.name);
  if (name) {
    out.fullName = name;
    const [first, ...rest] = name.split(/\s+/);
    out.firstName = first || "";
    out.lastName = rest.join(" ");
  }
  if (basics.email) out.email = str(basics.email);
  if (basics.phone) out.phone = str(basics.phone);
  if (basics.url) out.website = str(basics.url);
  if (basics.label) out.headline = str(basics.label);
  if (basics.summary) out.summary = str(basics.summary);

  const loc = basics.location as JsonObject | undefined;
  if (loc) {
    if (loc.city) out.city = str(loc.city);
    if (loc.region) out.state = str(loc.region);
    if (loc.postalCode) out.postalCode = str(loc.postalCode);
    if (loc.countryCode || loc.country) out.country = str(loc.countryCode || loc.country);
    if (loc.address) out.address = str(loc.address);
  }

  for (const p of Array.isArray(basics.profiles) ? (basics.profiles as JsonObject[]) : []) {
    const network = str(p.network).toLowerCase();
    const url = str(p.url);
    if (!url) continue;
    if (network.includes("linkedin")) out.linkedin = url;
    else if (network.includes("github")) out.github = url;
    else if (network.includes("twitter") || network.includes("x.com")) out.twitter = url;
    else if (network.includes("portfolio") || network.includes("website")) out.website ||= url;
  }

  const work = Array.isArray(doc.work) ? (doc.work as JsonObject[]) : [];
  if (work.length) {
    const current = work[0] ?? {};
    if (current.name || current.company) out.currentCompany = str(current.name || current.company);
    if (current.position) out.currentTitle = str(current.position);
    if (current.startDate) out.currentStartDate = str(current.startDate);
    if (current.endDate) out.currentEndDate = str(current.endDate);
    const yrs = totalYearsOfExperience(work);
    if (yrs != null) out.yearsExperience = String(yrs);
  }

  const education = Array.isArray(doc.education) ? (doc.education as JsonObject[]) : [];
  if (education.length) {
    const edu = education[0] ?? {};
    if (edu.institution) out.school = str(edu.institution);
    if (edu.studyType || edu.area) out.degree = [edu.studyType, edu.area].filter(Boolean).map(str).join(" in ");
    if (edu.area) out.fieldOfStudy = str(edu.area);
    const yr = str(edu.endDate).match(/\d{4}/);
    if (yr) out.graduationYear = yr[0];
    if (edu.score) out.gpa = str(edu.score);
  }

  const skills = Array.isArray(doc.skills) ? doc.skills : [];
  if (skills.length) {
    out.skills = skills
      .map((s) => (typeof s === "string" ? s : str((s as JsonObject)?.name)))
      .filter(Boolean)
      .join(", ");
  }
  const languages = Array.isArray(doc.languages) ? doc.languages : [];
  if (languages.length) {
    out.languages = languages
      .map((l) => (typeof l === "string" ? l : str((l as JsonObject)?.language)))
      .filter(Boolean)
      .join(", ");
  }
  return out;
}

/**
 * Field-label substring → profile key. Earlier entries win, so specific
 * forms (first name) come before generic ones (name). Data, not branches.
 */
export const AUTOFILL_PATTERNS: ReadonlyArray<{ key: string; matches: readonly string[] }> = [
  { key: "firstName", matches: ["first name", "firstname", "given name", "first_name", "forename"] },
  { key: "lastName", matches: ["last name", "lastname", "family name", "surname", "last_name"] },
  { key: "fullName", matches: ["full name", "your name", "legal name", "name (as", "preferred name"] },
  { key: "email", matches: ["email", "e-mail"] },
  { key: "phone", matches: ["phone", "mobile", "telephone", "cell"] },
  { key: "linkedin", matches: ["linkedin", "linked in"] },
  { key: "github", matches: ["github", "git hub"] },
  { key: "twitter", matches: ["twitter", "x.com profile", "x profile"] },
  { key: "website", matches: ["portfolio", "website", "personal site", "personal url", "personal web"] },
  { key: "address", matches: ["street address", "address line", "mailing address", "address 1"] },
  { key: "city", matches: ["city", "town"] },
  { key: "state", matches: ["state", "province", "region"] },
  { key: "postalCode", matches: ["postal code", "postcode", "zip code", "zip/postal", "zip"] },
  { key: "country", matches: ["country"] },
  {
    key: "currentCompany",
    matches: [
      "current company", "current employer", "most recent company", "most recent employer",
      "present company", "present employer", "company name", "employer",
    ],
  },
  {
    key: "currentTitle",
    matches: [
      "current title", "current position", "current role", "most recent title",
      "most recent position", "job title", "current job",
    ],
  },
  { key: "currentStartDate", matches: ["start date at", "start date in current", "date started current"] },
  { key: "yearsExperience", matches: ["years of experience", "years experience", "total experience", "years in", "how many years"] },
  { key: "school", matches: ["school", "university", "college", "institution"] },
  { key: "degree", matches: ["degree", "highest level of education", "education level"] },
  { key: "fieldOfStudy", matches: ["field of study", "major", "area of study", "discipline"] },
  { key: "graduationYear", matches: ["graduation year", "grad year", "year graduated", "year of graduation"] },
  { key: "gpa", matches: ["gpa", "grade point"] },
  { key: "skills", matches: ["skills", "key skills", "technical skills", "core competencies"] },
  { key: "languages", matches: ["languages spoken", "languages you speak", "spoken languages"] },
  // A written cover letter (when the panel has one) beats the summary.
  { key: "coverLetter", matches: ["cover letter", "covering letter"] },
  {
    key: "summary",
    matches: [
      "summary", "about you", "tell us about", "bio", "professional summary",
      "cover letter", "why are you interested", "why do you want",
    ],
  },
  { key: "headline", matches: ["headline", "professional headline", "tagline"] },
  // Generic 'name' last — otherwise it'd eat "first name" matches above.
  { key: "fullName", matches: ["name"] },
];

/** The profile value for one form field, or null when nothing fits. */
export function pickAutofillValue(
  field: AutofillField,
  profile: AutofillProfile,
): { key: string; value: string } | null {
  const haystack = [field.label, field.name, field.id, field.placeholder]
    .map((s) => s || "")
    .join(" ")
    .toLowerCase();
  if (!haystack.trim()) return null;
  for (const pat of AUTOFILL_PATTERNS) {
    if (pat.matches.some((m) => haystack.includes(m))) {
      const v = profile[pat.key];
      if (v) return { key: pat.key, value: v };
    }
  }
  return null;
}
