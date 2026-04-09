/**
 * hired.video Auth Bridge
 * ------------------------
 * Runs on app.hired.video pages. The web app stores its JWT in
 * `localStorage.auth_token` after any successful login flow (email,
 * OAuth, magic link, 2FA, passkey, etc). This script forwards that
 * token to the extension's service worker so the side panel can
 * use it without forcing the user to log in twice.
 *
 * It also clears the extension's stored token if the web app logs
 * the user out (auth_token disappears).
 */

(function () {
  const TOKEN_KEY = 'auth_token';
  let lastSent = null;

  function syncToken() {
    let token = null;
    try {
      token = window.localStorage.getItem(TOKEN_KEY);
    } catch (e) {
      // localStorage may be inaccessible inside sandboxed iframes
      return;
    }

    if (token === lastSent) return;
    lastSent = token;

    chrome.runtime
      .sendMessage({ action: 'authTokenSync', token })
      .catch(() => {
        // Service worker may be asleep / extension reloading — ignore.
      });
  }

  // Initial sync, then poll for changes (storage events fire on
  // OTHER tabs but not the originating one, and the web app sets the
  // token from a useEffect on its own tab — so we need to poll).
  syncToken();
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY) syncToken();
  });
  setInterval(syncToken, 1500);
})();
