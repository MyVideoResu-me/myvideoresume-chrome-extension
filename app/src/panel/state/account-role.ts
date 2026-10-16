/**
 * The signed-in person's role, mirrored into chrome.storage.local so the
 * in-page pill (a content script with no session of its own) resolves the
 * same lens the panel does: resolveLens(saved, role). Written by the
 * session store; cleared with the other per-user keys.
 */
export const ROLE_KEY = "accountRole";
