/**
 * hired.video Chrome Extension — Self-Profile HTML Provider
 *
 * Cross-extension content script that exposes the focused profile pane
 * HTML on demand. Used by:
 *
 *   1. Recruiter side panel — for sourcing candidates from a profile the
 *      recruiter is currently viewing.
 *   2. Jobseeker → web bridge — when the user clicks "Sync from this tab"
 *      on /tools/vendor-sync, the service worker queries this script in
 *      the active profile tab and broadcasts the HTML back to the web app.
 *
 * Both flows rely on the SAME `getFocusedProfileHTML` message and the SAME
 * `findFocusedProfilePane()` helper from `profile-parsers.js`. Lifted out
 * of recruiter/content-script-profiles.js because the seeker side needed
 * the same listener without the auto-detect ceremony.
 *
 * IMPORTANT: load order — manifest must include `profile-parsers.js`
 * BEFORE this file so `findFocusedProfilePane` and `detectVendorConnector`
 * are in scope.
 */

(function () {
  // Defensive: bail if profile-parsers.js wasn't loaded for some reason.
  // The recruiter content-script-companies still imports common helpers
  // and we don't want a missing dependency to crash the entire chain.
  if (typeof findFocusedProfilePane !== 'function') return;

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action !== 'getFocusedProfileHTML') return false;

    let html = null;
    let connectorId = null;
    try {
      const focused = findFocusedProfilePane();
      if (focused?.el) {
        html = focused.el.outerHTML;
      }
      // Best-effort connector tag — the receiver may use it to skip an
      // extra detect call. Mirrors the registry ids on the backend.
      if (typeof detectVendorConnector === 'function') {
        connectorId = detectVendorConnector();
      }
    } catch (e) {
      // Cross-origin / sandbox — fall through to null.
    }

    sendResponse({
      html,
      connectorId,
      originUrl: window.location.href,
    });
    return true; // async-safe pattern; we already called sendResponse
  });
})();
