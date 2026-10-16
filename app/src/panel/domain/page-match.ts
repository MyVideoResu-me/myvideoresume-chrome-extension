/** Is the active tab still the page a flow started on? (origin + path; query/hash ignored) */
export function samePage(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    const path = (u: URL) => u.pathname.replace(/\/+$/, "");
    return x.origin === y.origin && path(x) === path(y);
  } catch {
    return false;
  }
}
