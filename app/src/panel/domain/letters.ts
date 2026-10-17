/** The person's cover letters: each is saved on the tailored version it was written with. Pure. */
import type { ResumeSummary } from "../api/resumes";
import { matchesQuery, newestFirst } from "./search";

export type LetterItem = { resume: ResumeSummary; jobTitle: string; organization: string };

export function listLetters(list: readonly ResumeSummary[], query = ""): LetterItem[] {
  return list
    .filter((r) => r.letter)
    .map((r) => ({ resume: r, jobTitle: r.letter!.jobTitle || r.title, organization: r.letter!.organization }))
    .filter((l) => matchesQuery(query, l.jobTitle, l.organization, l.resume.title))
    .sort(newestFirst((l: LetterItem) => l.resume.updatedAt));
}
