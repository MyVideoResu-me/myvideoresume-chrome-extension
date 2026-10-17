/**
 * Which Studio project a panel video flow made for a target (a job, a
 * résumé, a prospect, a post, a candidate × job), so running the flow again
 * for the same target UPDATES that one project instead of forking a copy.
 * Kept in extension storage across panel sessions; the oldest keys drop past
 * the cap. A remembered id the server no longer lets this account write
 * (deleted, or another account's) is simply replaced — see useVideoProject.
 */
import { storageGet, storageSet } from "../platform/chrome";

/** Per user: the session wipes it on an account switch (USER_SCOPED_KEYS). */
export const VIDEO_PROJECT_IDS_KEY = "videoProjectIds";
const KEY = VIDEO_PROJECT_IDS_KEY;
const MAX_KEYS = 200;

type IdMap = Record<string, string>;

async function readMap(): Promise<IdMap> {
  const map = await storageGet<IdMap>(KEY);
  return map && typeof map === "object" ? map : {};
}

export async function rememberedProjectId(reuseKey: string): Promise<string | null> {
  return (await readMap())[reuseKey] ?? null;
}

export async function rememberProjectId(reuseKey: string, projectId: string): Promise<void> {
  const map = await readMap();
  delete map[reuseKey]; // re-insert last so it is the newest
  map[reuseKey] = projectId;
  const keys = Object.keys(map);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_KEYS))) delete map[stale];
  await storageSet({ [KEY]: map });
}
