/**
 * hired.video Chrome Extension - Shared Utilities
 *
 * Common helper functions used by both the Job Seeker and Recruiter
 * side panels. Loaded via <script> tag before the extension-specific
 * sidepanel.js.
 */

// ---- Auth ---------------------------------------------------------------

async function getJwtToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(jwtTokenKey, (data) => resolve(data.jwtToken || null));
  });
}

// ---- DOM helpers --------------------------------------------------------

function showElement(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('hidden');
}

function hideElement(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

function showError(containerId, message) {
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
  }
}

// ---- Formatting ---------------------------------------------------------

function formatScore(score) {
  if (typeof score === 'number') return Math.round(score) + '%';
  return score + '%';
}

function applyScoreStyle(elementId, score) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.classList.remove('score-high', 'score-medium', 'score-low');
  const numScore = parseFloat(score);
  if (numScore >= 70) el.classList.add('score-high');
  else if (numScore >= 40) el.classList.add('score-medium');
  else el.classList.add('score-low');
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return '';
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function capitalizeFirst(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ---- API helpers --------------------------------------------------------

/**
 * Make an authenticated API request. Returns the fetch Response.
 * Handles 401 by clearing the stored token.
 */
async function apiFetch(url, options = {}) {
  const token = await getJwtToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    chrome.storage.local.remove('jwtToken');
    throw new Error('Session expired — please sign in again');
  }
  return res;
}

/**
 * Check a fetch Response for 429 USAGE_LIMIT_EXCEEDED. Renders
 * a usage bar + upgrade CTA into `targetId`. Returns true when
 * handled so the caller can short-circuit.
 *
 * Usage:  if (await check429(resp, 'quickStatus')) return;
 */
async function check429(response, targetId) {
  if (response.status !== 429) return false;
  try {
    const data = await response.json();
    const err = data?.error;
    if (err?.code !== 'USAGE_LIMIT_EXCEEDED') {
      showQuickStatus('Rate limit reached. Please wait and try again.', 'warning');
      return true;
    }
    const used = err?.usage?.used ?? 0;
    const limit = err?.usage?.limit ?? 10;
    const pct = Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
    const upgradeUrl = typeof buildWebUrl === 'function'
      ? buildWebUrl(err.upgradeUrl || '/pricing')
      : err.upgradeUrl || '/pricing';

    const container = document.getElementById(targetId);
    if (container) {
      container.innerHTML = `
        <div class="usage-limit-alert">
          <strong>⚠️ Free plan limit reached</strong>
          ${escapeHtml(err.message || 'Upgrade to keep using AI features.')}
          <div class="usage-limit-bar">
            <div class="usage-limit-bar-fill" style="width:${pct}%"></div>
          </div>
          <div class="text-xs text-muted">${used} / ${limit} requests used this month</div>
          <button class="btn btn-primary usage-limit-upgrade" data-url="${escapeHtml(upgradeUrl)}">⭐ Upgrade to Pro</button>
        </div>
      `;
      container.classList.remove('hidden');
      container.querySelector('.usage-limit-upgrade')?.addEventListener('click', () => {
        chrome.tabs.create({ url: upgradeUrl });
      });
    }
    return true;
  } catch {
    showQuickStatus('Rate limit reached. Please wait and try again.', 'warning');
    return true;
  }
}

// ---- Job context capture (DRY — used by all pipeline entry points) ----

/**
 * Capture focused-pane HTML from the content script. Preferred over
 * whole-page scraping — only gets the right-rail job pane on LinkedIn
 * collection pages, etc.
 *
 * Falls back to full-page capture + selector-based extraction when the
 * content script doesn't have a focused pane cached.
 *
 * Returns { html, originUrl } or null on failure.
 */
async function captureJobContext() {
  // 1. Try the focused-pane fast path
  const focused = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getFocusedPaneHTML' }, (response) => {
      resolve(response?.html ? response : null);
    });
  });
  if (focused?.html) {
    return { html: focused.html, originUrl: focused.originUrl || '' };
  }

  // 2. Fall back to full-page capture + selector-based pane extraction
  const page = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getHTML' }, (response) => {
      resolve(response?.html ? response : null);
    });
  });
  if (!page?.html) return null;

  const paneHtml = typeof extractJobPane === 'function'
    ? extractJobPane(page.html, page.originUrl)
    : page.html;

  return { html: paneHtml, originUrl: page.originUrl || '' };
}

// ---- Save variation (DRY — used by pipeline, rowTailor, wizard) ----

/**
 * Save a tailored resume as a variation under the user's master resume.
 *
 * @param {string} masterId  - The master resume ID (parentId fallback handled by caller)
 * @param {object} params    - { name, description, markdownResume, jobId?, sourceUrl? }
 * @returns {string|null}    - The new variation ID, or null on failure
 */
async function saveAsVariation(masterId, params) {
  const res = await apiFetch(buildResumeUrl(masterId, 'createvariation'), {
    method: 'POST',
    body: JSON.stringify({
      name: (params.name || 'Tailored Resume').slice(0, 200),
      description: params.description || '',
      resumeData: params.markdownResume || '',
      jobId: params.jobId,
      sourceUrl: params.sourceUrl,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data?.data || data?.result || data)?.id || null;
}

/**
 * Determine the master resume ID from the selected resume.
 */
function getMasterResumeId(resume) {
  if (!resume) return null;
  return resume.isMaster || !resume.parentId ? resume.id : resume.parentId;
}
