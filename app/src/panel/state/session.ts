/**
 * Who is signed in. Signing in happens on hired.video or login.html; the
 * service worker / auth bridge write the JWT into chrome.storage, and this
 * store follows that key. When a different user signs in, user-scoped
 * panel state is wiped so nothing leaks between accounts.
 */
import { fetchMe, fetchSubscription, logout, type Me } from "../api/account";
import { JWT_KEY, clearSession, getToken } from "../api/http";
import { onStorageChange, storageGet, storageRemove, storageSet } from "../platform/chrome";
import { createStore, useStore } from "./store";

const LAST_USER_KEY = "lastUserId";
/** Everything the panel keeps per user. */
const USER_SCOPED_KEYS = ["selectedResumeId", "appLens", "currentTrackedJob", "jobScores", "jobTailorings"];

export type SessionState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "offline" }
  | { status: "signedIn"; me: Me; isPro: boolean };

export const sessionStore = createStore<{ session: SessionState }>({ session: { status: "loading" } });

async function load(): Promise<void> {
  const token = await getToken();
  if (!token) {
    sessionStore.set({ session: { status: "signedOut" } });
    return;
  }
  try {
    const me = await fetchMe();
    const lastUser = await storageGet<string>(LAST_USER_KEY);
    if (lastUser && lastUser !== me.id) await storageRemove(USER_SCOPED_KEYS);
    await storageSet({ [LAST_USER_KEY]: me.id });
    const isPro = await fetchSubscription()
      .then((s) => s.isPro === true)
      .catch(() => false);
    sessionStore.set({ session: { status: "signedIn", me, isPro } });
  } catch {
    // request() already cleared a dead token; anything else = offline.
    const still = await getToken();
    sessionStore.set({ session: still ? { status: "offline" } : { status: "signedOut" } });
  }
}

let started = false;

export function startSession(): void {
  if (started) return;
  started = true;
  void load();
  onStorageChange(JWT_KEY, () => void load());
}

export async function signOut(): Promise<void> {
  await logout();
  await storageRemove(USER_SCOPED_KEYS);
  await clearSession();
}

export function refreshSession(): void {
  void load();
}

const PRO_RECHECK_MS = 60_000;
let lastRecheck = 0;

/** Re-read Pro after the person upgrades in another tab (at most once a minute). */
export function recheckProIfStale(): void {
  if (Date.now() - lastRecheck < PRO_RECHECK_MS) return;
  lastRecheck = Date.now();
  void load();
}

function roleOf(state: { session: SessionState }): string {
  return state.session.status === "signedIn" ? String(state.session.me.role) : "";
}

/** The signed-in person's role ("" when signed out). */
export function useRole(): string {
  return useStore(sessionStore, roleOf);
}

