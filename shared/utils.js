/**
 * hired.video Chrome Extension - Shared Utilities
 *
 * Common helper functions used by both the Job Seeker and Recruiter
 * side panels. Loaded via <script> tag before the extension-specific
 * sidepanel.js.
 */

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
 * Authenticated API request for the side panel (built by hvApiFetch in
 * api-client.js). Returns the fetch Response; a 401 clears the stored
 * token and throws so the panel falls back to its signed-out state.
 */
async function apiFetch(url, options = {}) {
  const res = await hvApiFetch(url, options);
  if (res.status === 401) {
    chrome.storage.local.remove(JWT_STORAGE_KEY);
    throw new Error('Session expired — please sign in again');
  }
  return res;
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

// ---- Resume markdown renderer (ported from hired.video/shared/resume-markdown.ts) ----
//
// Plain-JS port so the extension can render a ResumeContent JSON blob
// (as returned by the tailor endpoint) without pulling in the TS shared
// module. Kept byte-compatible with the server-side renderer so the
// preview the user sees here is identical to what gets persisted.

function _joinTruthy(parts, sep) {
  return parts.filter((p) => p && String(p).trim().length > 0).join(sep || ' — ');
}
function _formatDateRange(startDate, endDate) {
  const start = (startDate || '').trim();
  const end = (endDate || '').trim() || 'Present';
  if (!start) return '';
  return `${start} – ${end}`;
}
function renderResumeAsMarkdown(resume) {
  if (!resume || typeof resume !== 'object') return '';
  const lines = [];
  const b = resume.basics;
  if (b) {
    if (b.name && b.name.trim()) lines.push(`# ${b.name.trim()}`);
    if (b.label && b.label.trim()) lines.push(`*${b.label.trim()}*`);
    const contact = [];
    if (b.email) contact.push(String(b.email));
    if (b.phone) contact.push(String(b.phone));
    if (b.url) contact.push(String(b.url));
    if (b.location) {
      const loc = [b.location.city, b.location.region, b.location.countryCode]
        .map((s) => (s || '').trim()).filter(Boolean);
      if (loc.length) contact.push(loc.join(', '));
    }
    if (contact.length) lines.push(contact.join(' · '));
    if (b.summary && b.summary.trim()) {
      lines.push('', '## Summary', b.summary.trim());
    }
  }
  for (const job of (resume.work || [])) {
    if (lines.length && lines[lines.length - 1] !== '## Experience') {
      if (!lines.includes('## Experience')) lines.push('', '## Experience');
    }
    const heading = _joinTruthy([job.position, job.name]);
    if (heading) lines.push(`### ${heading}`);
    const meta = _formatDateRange(job.startDate, job.endDate);
    if (meta) lines.push(`*${meta}*`);
    if (job.summary && job.summary.trim()) lines.push(job.summary.trim());
    for (const h of (job.highlights || [])) {
      if (h && h.trim()) lines.push(`- ${h}`);
    }
    lines.push('');
  }
  if ((resume.skills || []).length) {
    lines.push('## Skills');
    for (const s of resume.skills) {
      const name = (s.name || '').trim();
      const kw = (s.keywords || []).filter((k) => k && k.trim());
      if (name && kw.length) lines.push(`- **${name}**: ${kw.join(', ')}`);
      else if (name) lines.push(`- ${name}`);
      else if (kw.length) lines.push(`- ${kw.join(', ')}`);
    }
    lines.push('');
  }
  if ((resume.education || []).length) {
    lines.push('## Education');
    for (const e of resume.education) {
      const heading = _joinTruthy([e.institution, e.studyType, e.area]);
      if (heading) lines.push(`### ${heading}`);
      const meta = _formatDateRange(e.startDate, e.endDate);
      if (meta) lines.push(`*${meta}*`);
      if (e.score) lines.push(`Score: ${e.score}`);
      for (const c of (e.courses || [])) {
        if (c && c.trim()) lines.push(`- ${c}`);
      }
      lines.push('');
    }
  }
  if ((resume.projects || []).length) {
    lines.push('## Projects');
    for (const p of resume.projects) {
      if (p.name && p.name.trim()) lines.push(`### ${p.name.trim()}`);
      if (p.description && p.description.trim()) lines.push(p.description.trim());
      for (const h of (p.highlights || [])) {
        if (h && h.trim()) lines.push(`- ${h}`);
      }
      lines.push('');
    }
  }
  if ((resume.certificates || []).length) {
    lines.push('## Certifications');
    for (const c of resume.certificates) {
      const parts = [c.name, c.issuer, c.date].map((s) => (s || '').trim()).filter(Boolean);
      if (parts.length) lines.push(`- ${parts.join(' — ')}`);
    }
    lines.push('');
  }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

/**
 * Build a canonical tracked-job object from a raw API response or
 * detected payload. Keeps every call site consistent.
 */
function buildTrackedJobObj(raw, fallbacks = {}) {
  return {
    id: raw.id || raw.Id || fallbacks.id,
    title: raw.title || raw.Title || fallbacks.title || 'Untitled job',
    company: raw.company || raw.companyName || fallbacks.company || '',
    location: raw.location || fallbacks.location || '',
    sourceUrl: raw.sourceUrl || fallbacks.sourceUrl || '',
    applyUrl: raw.applyUrl || fallbacks.applyUrl || raw.sourceUrl || fallbacks.sourceUrl || '',
  };
}

// ---- Version footer -----------------------------------------------------
// Populates the footer version pill with the manifest version. The Web
// Store href is set in the HTML per extension (jobseeker / recruiter have
// different listing slugs); we only fall back to a runtime-derived URL
// when the HTML didn't supply one.
function setupVersionFooter() {
  const el = document.getElementById('versionFooter');
  if (!el) return;
  try {
    const manifest = chrome.runtime.getManifest();
    el.textContent = `v${manifest.version}`;
    const current = el.getAttribute('href');
    if (!current || current === '#') {
      el.href = `https://chromewebstore.google.com/detail/${chrome.runtime.id}`;
    }
  } catch (e) {
    el.textContent = '';
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupVersionFooter);
  } else {
    setupVersionFooter();
  }
}
