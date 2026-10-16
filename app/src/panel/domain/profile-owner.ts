/**
 * Is the profile on the page the signed-in person's own? Profile pages don't
 * say whose account is viewing, so this is a best guess (LinkedIn's /in/me
 * alias, else the same first + last name). The import screen lets the person
 * correct it either way.
 */
import type { DetectedProfile } from "./entities";

const SELF_URL = /linkedin\.com\/in\/me(\/|$|\?)/i;

function nameTokens(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

export function isOwnProfile(
  profile: Pick<DetectedProfile, "name" | "sourceUrl">,
  me: { name: string | null } | null,
): boolean {
  if (SELF_URL.test(profile.sourceUrl)) return true;
  const theirs = nameTokens(profile.name);
  const mine = nameTokens(me?.name ?? "");
  if (theirs.length < 2 || mine.length < 2) return theirs.length > 0 && theirs.join(" ") === mine.join(" ");
  return theirs[0] === mine[0] && theirs[theirs.length - 1] === mine[mine.length - 1];
}

/** "Jordan Rivera" → "JR"; one word → its first two letters. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}
