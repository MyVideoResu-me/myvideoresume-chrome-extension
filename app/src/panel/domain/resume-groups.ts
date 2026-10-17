/**
 * The résumé list as master → versions groups, newest first, filtered by a
 * search query. A version matching the query keeps its master visible (and
 * expanded) so it is never shown orphaned. Pure — no API or UI.
 */
import type { ResumeSummary } from "../api/resumes";

export type ResumeGroup = {
  master: ResumeSummary;
  versions: ResumeSummary[];
  /** True when the query matched a version, so the group should open. */
  matchedVersion: boolean;
};

const time = (r: ResumeSummary): number => (r.updatedAt ? Date.parse(r.updatedAt) || 0 : 0);
const newestFirst = (a: ResumeSummary, b: ResumeSummary): number => time(b) - time(a);

export function groupResumes(list: readonly ResumeSummary[], query = ""): ResumeGroup[] {
  const q = query.trim().toLowerCase();
  const matches = (r: ResumeSummary) => !q || r.title.toLowerCase().includes(q);
  const groups: ResumeGroup[] = [];
  for (const master of list.filter((r) => r.isMaster)) {
    const all = list.filter((r) => !r.isMaster && r.masterId === master.id).sort(newestFirst);
    const hits = all.filter(matches);
    if (!matches(master) && !hits.length) continue;
    groups.push({
      master,
      versions: matches(master) ? all : hits,
      matchedVersion: !!q && hits.length > 0,
    });
  }
  return groups.sort((a, b) => newestFirst(a.master, b.master));
}
