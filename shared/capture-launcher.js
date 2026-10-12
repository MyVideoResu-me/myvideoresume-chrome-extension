/**
 * hired.video Capture Launcher
 * ----------------------------
 * Shared between the Job Seeker and Recruiter side panels. Opens the
 * web Studio in a new tab pre-armed for promo capture:
 *
 *   /studio?contentTemplate=tool-promo&capture=screen&new=1
 *
 * Studio reads `?contentTemplate=` to pre-select the "Tool Promo"
 * content template (one-scene 30s screen+webcam promo). The `capture`
 * param is forwarded for the future auto-arm-recorder pass tracked
 * as gap #454 — Studio honours it once that lands.
 *
 * NOTE: the actual screen recording happens IN the web app via
 * `getDisplayMedia` (already implemented in `WebcamRecorder.tsx`). The
 * extension does NOT need `desktopCapture` — its only job here is to
 * launch Studio with the right URL. Keeping the capture in the page
 * means the same `WebcamRecorder` powers extension-launched promos
 * AND in-Studio promos, no per-surface forks.
 *
 * Wiring:
 *   - Self-gates: if no `#launchPromoCaptureButton` is in the DOM the
 *     script does nothing.
 *   - Both sidepanel-global.html files include this script + the
 *     button. No per-extension JS edit required.
 *   - The dismiss (X) on the panel persists to chrome.storage.local
 *     under STUDIO_QUICK_LAUNCH_DISMISSED_KEY so the panel stays
 *     hidden across reopens until the user reinstalls or clears
 *     extension storage.
 */

(function () {
  const STUDIO_QUICK_LAUNCH_DISMISSED_KEY = 'studioQuickLaunchDismissed';

  /**
   * Open Studio in a new tab with promo capture pre-armed.
   * @param {{ toolId?: string, subjectKind?: 'resume'|'job'|'company', subjectId?: string }=} opts
   */
  function launchPromoCapture(opts) {
    const params = new URLSearchParams();
    params.set('contentTemplate', 'tool-promo');
    params.set('new', '1');
    // Forwarded for the future auto-arm-recorder pass (gap #454).
    // Studio currently no-ops on this — safe to send today.
    params.set('capture', 'screen');
    if (opts && opts.toolId) params.set('promoToolId', opts.toolId);
    if (opts && opts.subjectKind && opts.subjectId) {
      params.set('subject', `${opts.subjectKind}:${opts.subjectId}`);
    }

    // `buildWebUrl` is defined in shared/constants.js and returns the
    // configured webBase + path. Falls back to the production apex if
    // constants.js wasn't loaded for some reason.
    const path = '/studio?' + params.toString();
    const url = (typeof buildWebUrl === 'function')
      ? buildWebUrl(path)
      : 'https://hired.video' + path;

    chrome.tabs.create({ url, active: true });
  }

  // Expose globally so sidepanel.js can also trigger from elsewhere
  // (e.g. a context-specific "Record this candidate" button later).
  window.launchPromoCapture = launchPromoCapture;

  function wirePanel() {
    const btn = document.getElementById('launchPromoCaptureButton');
    if (!btn) return; // self-gating per the DRY rule
    btn.addEventListener('click', function () {
      launchPromoCapture();
    });

    const card = document.getElementById('studioQuickLaunch');
    const dismissBtn = document.getElementById('dismissPromoCaptureButton');
    if (!card || !dismissBtn) return;

    // Hide immediately if previously dismissed. chrome.storage.local is
    // async so a brief flash is possible on slow machines — acceptable
    // tradeoff vs. shipping a separate sync flag.
    chrome.storage.local.get(STUDIO_QUICK_LAUNCH_DISMISSED_KEY, (data) => {
      if (data && data[STUDIO_QUICK_LAUNCH_DISMISSED_KEY]) {
        card.classList.add('hidden');
      }
    });

    dismissBtn.addEventListener('click', function () {
      card.classList.add('hidden');
      chrome.storage.local.set({ [STUDIO_QUICK_LAUNCH_DISMISSED_KEY]: true });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wirePanel);
  } else {
    wirePanel();
  }
})();
