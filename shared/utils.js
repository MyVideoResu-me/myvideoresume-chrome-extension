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
 * Make an authenticated API request. Returns the parsed JSON response
 * or throws on network/auth errors.
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
