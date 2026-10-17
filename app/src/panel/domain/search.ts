/** Filtering and ordering shared by every list in the panel. Pure. */

/** Case-insensitive "does any text contain the query". An empty query matches everything. */
export function matchesQuery(query: string, ...texts: ReadonlyArray<string | null | undefined>): boolean {
  const q = query.trim().toLowerCase();
  return !q || texts.some((s) => !!s && s.toLowerCase().includes(q));
}

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/** Sort comparator: newest `at(item)` first, undated last. */
export function newestFirst<T>(at: (item: T) => string | null | undefined): (a: T, b: T) => number {
  return (a, b) => time(at(b)) - time(at(a));
}
