/** A saved cover letter as plain text (copy, preview). */
import { coverLetterToText, readCoverLetter } from "@shared/cover-letter";
import { longDate } from "../../platform/i18n";
import { resumeContent } from "../../state/resumes";

export async function savedLetterText(resumeId: string): Promise<string> {
  const content = await resumeContent(resumeId);
  const letter = readCoverLetter(content);
  if (!letter) return "";
  const dated = new Date(letter.date);
  return coverLetterToText(letter, content, longDate(Number.isNaN(dated.getTime()) ? new Date() : dated));
}
