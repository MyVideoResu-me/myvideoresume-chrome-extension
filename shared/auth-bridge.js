/**
 * hired.video Auth Bridge
 * ------------------------
 * Runs on hired.video pages. Keeps the web app's `localStorage.auth_token`
 * in sync with the extension's `chrome.storage.local.jwtToken` in BOTH
 * directions, so the user only ever has to sign in once:
 *
 *   web → extension : if the user logs in on hired.video (via OAuth,
 *                     magic link, 2FA, passkey, or email/password) the
 *                     extension picks it up and the side panel goes
 *                     straight to the signed-in state.
 *
 *   extension → web : if the user logs in via the extension's own
 *                     email/password form, any open hired.video tab
 *                     receives the token and is signed in too.
 */

(function () {
  const TOKEN_KEY = 'auth_token';
  // Sentinel: must NOT be initialized to readWebToken() — if a fresh
  // page load already has a token in localStorage, the diff check
  // would think it's already been sent and skip the very first push.
  const UNSET = Symbol('unset');
  let lastWebToken = UNSET;
  let lastExtToken = UNSET;

  function readWebToken() {
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      return null; // sandboxed iframe
    }
  }

  function writeWebToken(token) {
    try {
      if (token) {
        window.localStorage.setItem(TOKEN_KEY, token);
      } else {
        window.localStorage.removeItem(TOKEN_KEY);
      }
    } catch (e) {
      // sandboxed iframe — ignore
    }
  }

  // ---- web → extension ------------------------------------------------
  function pushWebTokenToExtension() {
    const token = readWebToken();
    if (token === lastWebToken) return;
    lastWebToken = token;

    chrome.runtime.sendMessage({ action: 'authTokenSync', token }).catch(() => {
      // Service worker may be asleep / extension reloading — ignore.
    });
  }

  pushWebTokenToExtension();
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY) pushWebTokenToExtension();
  });
  // The web app sets the token from a useEffect on its own tab so the
  // browser's `storage` event won't fire here — poll as a fallback.
  setInterval(pushWebTokenToExtension, 1500);

  // ---- extension → web ------------------------------------------------
  // Mirror the extension's token into localStorage whenever it changes.
  function pullExtensionToken() {
    chrome.storage.local.get('jwtToken', (data) => {
      const token = data?.jwtToken || null;
      if (token === lastExtToken) return;
      lastExtToken = token;

      // Only mirror if the values diverged — avoids fighting the
      // web → extension push above.
      const current = readWebToken();
      if (token !== current) {
        writeWebToken(token);
        // The web app reads localStorage on a useEffect, but a fresh
        // mount needs a hint — emitting a same-tab storage event lets
        // any listeners react immediately.
        try {
          window.dispatchEvent(new StorageEvent('storage', {
            key: TOKEN_KEY,
            newValue: token,
            oldValue: current,
            storageArea: window.localStorage,
          }));
        } catch {
          // Some browsers don't allow constructing StorageEvent from
          // user code — soft-failing is fine, the next route change
          // will pick it up.
        }
      }
    });
  }

  pullExtensionToken();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.jwtToken) pullExtensionToken();
  });
})();
