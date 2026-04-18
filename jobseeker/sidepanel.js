/**
 * hired.video Chrome Extension - Side Panel
 *
 * Vision (April 2026):
 *   1. Sign in via any hired.video method (web-delegated for OAuth/2FA/magic).
 *   2. Navigate to any webpage. If it's a job posting, "Track this Job"
 *      extracts it via AI and saves it as a tracked Job in hired.video.
 *   3. Manage resumes: list, upload PDF/Word, set as Master.
 *   4. Score and tailor a resume against the tracked job.
 *   5. Save the AI-tailored resume as a variation of the master.
 *   6. Mark "I Used This Resume" — links the variation to the job
 *      via /api/jobs/:id/apply so the user can see in the tracker
 *      which resume went out for which application.
 */

// ---- Global state ---------------------------------------------------
// Note: `masterResumeGroups` (without the local-state suffix) is the API
// URL string defined in constants.js. We hold the loaded array in
// `resumeGroups` to avoid the redeclaration collision.
let resumeGroups = [];
let selectedResume = null;
let generatedResumeData = null;
let generatedVariationId = null; // set when "Save as Variation" succeeds
let currentJobHtml = null;
let currentJobUrl = null;
let currentJobOriginalHtml = null; // raw page HTML for the extract API
let trackedJob = null;             // { id, title, company, sourceUrl, applyUrl, ... }

// New for the two-tab redesign
let currentTab = 'jobs';
/** One-shot guard for applyDefaultTab() — we want the "open Resume tab
 *  when no master resume exists" rule to fire only on initial load, not
 *  on every subsequent resume list refresh (which would yank the user
 *  back to Resume while they're working elsewhere). */
let hasAppliedDefaultTab = false;
let isPremium = false;
let trackedJobsList = [];
let detectedPageJob = null; // { title, company, location, sourceUrl, applyUrl } from content script
let pipelineBusy = false;

// Per-job persisted caches. Both are jobId -> entry maps stored in
// chrome.storage.local so they survive reloads.
//   jobScores[jobId]   = { score, recommendations, scoredAt }
//   jobTailorings[jobId] = { variationId, masterResumeId, score, tailoredAt }
let jobScores = {};
let jobTailorings = {};

const JOB_SCORES_KEY = 'jobScores';
const JOB_TAILORINGS_KEY = 'jobTailorings';

// Shared SVG icons (14×14, Feather-style) used across rendered UI.
const ICON = {
  document: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  download: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
  externalLink: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  refresh: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  // Re-run an AI action (rotate-ccw, Feather). Distinct from `refresh`
  // (two arrows, used for reloading data lists) so the tailored-resume
  // row's "re-tailor" button reads as a different affordance.
  retailor: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  // Scan / inspect (Feather `search`). Used for the row-level "scan the
  // current page to backfill missing info" action — visually distinct
  // from the double-arrow `refresh` used to reload data lists.
  scan: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  // Edit pencil (Feather `edit-2`). Matches the pencil on the profile
  // card's active-resume row so the "edit" affordance reads the same
  // across the UI.
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="16 3 21 8 8 21 3 21 3 16 16 3"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
};

// Default user settings — persisted in chrome.storage.local under `settings`.
const DEFAULT_SETTINGS = {
  autoDetect: true,
  autoScore: false,
  autoTailor: false,   // PAID
  wizardMode: false,
  downloadFormat: 'pdf', // PAID for non-default values
};
let settings = { ...DEFAULT_SETTINGS };

// ---- Bootstrapping --------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  // Wire login buttons immediately, before anything else can throw,
  // so the user can always escape to the sign-in page even if the
  // rest of init breaks.
  wireLoginButtons();

  updateConfiguration();
  initializeApp();
  setupUrlChangeListener();
  setupAuthSyncListener();

  // Re-check premium status when the side panel regains visibility
  // (e.g. user returns from the pricing/upgrade page in another tab).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadTokenBudget();
    }
  });
});

/**
 * Wire both the header and the banner sign-in buttons. Defensive: uses
 * addEventListener so multiple calls can't accidentally clobber each
 * other, and runs before any storage / fetch / decode logic.
 */
function wireLoginButtons() {
  const open = (e) => {
    if (e) e.preventDefault();
    try {
      window.location.href = chrome.runtime.getURL('login.html');
    } catch (err) {
      console.error('[hired.video] failed to open login page', err);
    }
  };
  ['loginButton'].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.dataset.loginWired) {
      el.addEventListener('click', open);
      el.dataset.loginWired = '1';
    }
  });
}

// =====================================================================
// Tabs
// =====================================================================

function switchTab(name) {
  currentTab = name;
  document.querySelectorAll('.tab-button').forEach((btn) => {
    const active = btn.dataset.tab === name;
    btn.classList.toggle('tab-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-pane').forEach((pane) => {
    pane.classList.toggle('tab-pane-active', pane.id === `tab${cap(name)}`);
  });
  // Load analytics data when switching to the Analytics tab
  if (name === 'analytics') {
    loadAnalytics();
  }
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// =====================================================================
// Settings persistence
// =====================================================================

function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('settings', (data) => {
      settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      applySettingsToUI();
      resolve(settings);
    });
  });
}

function loadJobCaches() {
  return new Promise((resolve) => {
    chrome.storage.local.get([JOB_SCORES_KEY, JOB_TAILORINGS_KEY], (data) => {
      jobScores = data[JOB_SCORES_KEY] || {};
      jobTailorings = data[JOB_TAILORINGS_KEY] || {};
      resolve();
    });
  });
}

function saveJobScore(jobId, score, recommendations, resumeName) {
  jobScores[jobId] = {
    score,
    recommendations: recommendations || '',
    resumeName: resumeName || '',
    scoredAt: new Date().toISOString(),
  };
  chrome.storage.local.set({ [JOB_SCORES_KEY]: jobScores });
}

function saveJobTailoring(jobId, variationId, masterResumeId, score, variationName, masterResumeName) {
  jobTailorings[jobId] = {
    variationId,
    masterResumeId,
    score: score ?? null,
    variationName: variationName || '',
    masterResumeName: masterResumeName || '',
    tailoredAt: new Date().toISOString(),
  };
  chrome.storage.local.set({ [JOB_TAILORINGS_KEY]: jobTailorings });
}

function clearJobCaches(jobId) {
  delete jobScores[jobId];
  delete jobTailorings[jobId];
  chrome.storage.local.set({
    [JOB_SCORES_KEY]: jobScores,
    [JOB_TAILORINGS_KEY]: jobTailorings,
  });
}

function saveSettings() {
  chrome.storage.local.set({ settings });
}

function applySettingsToUI() {
  const toggles = {
    settingAutoDetect: 'autoDetect',
    settingAutoScore: 'autoScore',
    settingAutoTailor: 'autoTailor',
    settingWizardMode: 'wizardMode',
  };
  for (const [id, key] of Object.entries(toggles)) {
    const el = document.getElementById(id);
    if (el) el.checked = !!settings[key];
  }
  const fmt = document.getElementById('settingDownloadFormat');
  if (fmt) fmt.value = settings.downloadFormat || 'pdf';
  applyWizardMode();
}

function applyWizardMode() {
  const wizard = document.getElementById('wizardSection');
  if (!wizard) return;
  if (settings.wizardMode) wizard.classList.remove('hidden');
  else wizard.classList.add('hidden');
}

// =====================================================================
// Premium gating
// =====================================================================

/**
 * True when the user's role carries built-in premium entitlement.
 * Backend treats SuperAdmin/Admin as `isPremium: true` regardless of plan.
 */
function isPremiumRole(role) {
  if (!role) return false;
  const r = role.toString().toLowerCase();
  return r === 'superadmin' || r === 'admin' || r === 'pro' || r === 'premium';
}

function setPremium(value) {
  isPremium = !!value;
  document.body.classList.toggle('premium-unlocked', isPremium);

  // Unlock the gated controls when premium.
  document.querySelectorAll('.settings-toggle-locked input[type="checkbox"]').forEach((el) => {
    el.disabled = !isPremium;
  });
  document.querySelectorAll('.settings-locked').forEach((el) => {
    el.disabled = !isPremium;
  });
}

function openUpgradePage(e) {
  if (e) e.preventDefault();
  chrome.tabs.create({ url: buildWebUrl('/pricing') });
}

// =====================================================================
// AI token budget pill
// =====================================================================

const TOKEN_BUDGET_PATH = '/api/billing/token-budget';

// URL fragments of AI-metered endpoints. Any successful fetch against
// these triggers a debounced refresh of the token pill.
const AI_METERED_URL_FRAGMENTS = [
  '/api/jobs/extract',
  '/api/match/analyze',
  '/api/match/tailor',
  '/api/resumes/parse',
  '/api/resumes/createfromfile',
  '/api/resumes/createfromtext',
];

let tokenBudgetRefreshTimer = null;
let tokenBudgetFetchInFlight = false;

function formatTokenCount(n) {
  if (!Number.isFinite(n)) return '∞';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return String(n);
}

function renderTokenBudget(summary) {
  const pill = document.getElementById('tokenPill');
  const remainingEl = document.getElementById('tokenPillRemaining');
  const fillEl = document.getElementById('tokenPillFill');
  const usageEl = document.getElementById('tokenPillUsage');
  const resetEl = document.getElementById('tokenPillReset');
  if (!pill || !remainingEl || !fillEl || !usageEl || !resetEl) return;

  // Token-budget is authoritative for billing entitlement: Pro and
  // SuperAdmin/Admin both hide the upgrade CTA. Role-based premium is
  // set earlier by loadCurrentUser(); this reconciles for paid-plan users
  // whose role is "user".
  if (summary.isUnlimited || summary.isPro) {
    setPremium(true);
    hideElement('headerUpgradeButton');
  }

  pill.classList.remove('hidden', 'token-pill-warning', 'token-pill-exhausted', 'token-pill-unlimited');
  const href = summary.isUnlimited || summary.isPro ? '/settings?tab=billing' : '/pricing';
  pill.onclick = (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: buildWebUrl(href) });
  };

  if (summary.isUnlimited) {
    pill.classList.add('token-pill-unlimited');
    remainingEl.textContent = 'Unlimited';
    fillEl.style.width = '0%';
    usageEl.textContent = `${formatTokenCount(summary.monthly?.used ?? 0)} / Max`;
    resetEl.textContent = 'Unlimited';
    pill.title = 'Unlimited AI tokens (Admin)';
    return;
  }

  const monthlyLimit = summary.monthly?.limit ?? 0;
  const monthlyUsed = summary.monthly?.used ?? 0;
  const monthlyRemaining = summary.monthly?.remaining ?? Math.max(0, monthlyLimit - monthlyUsed);
  const packBalance = summary.pack?.balance ?? 0;
  const totalAvailable = summary.totalAvailable ?? (monthlyRemaining + packBalance);
  const percentUsed = monthlyLimit > 0 ? Math.min(100, Math.round((monthlyUsed / monthlyLimit) * 100)) : 0;

  const isExhausted = totalAvailable <= 0;
  const isWarning = !isExhausted && monthlyLimit > 0 && monthlyRemaining <= monthlyLimit * 0.1;

  if (isExhausted) pill.classList.add('token-pill-exhausted');
  else if (isWarning) pill.classList.add('token-pill-warning');

  remainingEl.textContent = `${formatTokenCount(totalAvailable)} left`;
  fillEl.style.width = `${percentUsed}%`;
  usageEl.textContent = `${formatTokenCount(monthlyUsed)} / ${formatTokenCount(monthlyLimit)}`;

  if (isExhausted) {
    resetEl.textContent = 'Buy more →';
  } else if (packBalance > 0) {
    resetEl.textContent = `+${formatTokenCount(packBalance)} packs`;
  } else if (summary.monthly?.resetAt) {
    try {
      resetEl.textContent = 'Resets ' + new Date(summary.monthly.resetAt).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric',
      });
    } catch {
      resetEl.textContent = '';
    }
  } else {
    resetEl.textContent = '';
  }
  pill.title = '';
}

function clearTokenBudget() {
  const pill = document.getElementById('tokenPill');
  if (pill) {
    pill.classList.add('hidden');
    pill.classList.remove('token-pill-warning', 'token-pill-exhausted', 'token-pill-unlimited');
  }
}

async function loadTokenBudget() {
  if (tokenBudgetFetchInFlight) return;
  const jwtToken = await getJwtToken();
  if (!jwtToken) {
    clearTokenBudget();
    return;
  }
  tokenBudgetFetchInFlight = true;
  try {
    const resp = await fetch(apiBase + TOKEN_BUDGET_PATH, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const summary = unwrapResponse(data);
    if (summary) renderTokenBudget(summary);
  } catch (err) {
    console.warn('[hired.video] loadTokenBudget failed', err);
  } finally {
    tokenBudgetFetchInFlight = false;
  }
}

/**
 * Debounced refresh — coalesces a burst of AI calls (e.g. the tailor
 * pipeline fires extract → analyze → tailor in quick succession) into
 * a single `/token-budget` fetch shortly after the last one completes.
 */
function scheduleTokenBudgetRefresh() {
  if (tokenBudgetRefreshTimer) clearTimeout(tokenBudgetRefreshTimer);
  tokenBudgetRefreshTimer = setTimeout(() => {
    tokenBudgetRefreshTimer = null;
    loadTokenBudget();
  }, 400);
}

/**
 * Intercept fetch to keep the token pill in sync after any AI-metered
 * endpoint completes. One-point install so every existing call site
 * (extract, analyze, tailor, resume parse) benefits without editing.
 *
 * Preferred path: AI responses now piggy-back the live `tokenBudget` DTO
 * on the envelope (see `attachTokenBudget` middleware on the API). When
 * present, we render directly off the response — zero extra round-trips.
 *
 * Fallback: on older API deploys that haven't shipped the envelope yet,
 * schedule a debounced /token-budget fetch to refresh the pill.
 */
(function installAIFetchInterceptor() {
  if (typeof window === 'undefined' || !window.fetch || window.__aiFetchIntercepted) return;
  window.__aiFetchIntercepted = true;
  const origFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const resp = await origFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (!url || !AI_METERED_URL_FRAGMENTS.some((f) => url.includes(f))) {
        return resp;
      }

      // Peek at the envelope without consuming the caller's body stream.
      // Only JSON responses carry the budget; bail quickly otherwise.
      const ct = (resp.headers.get('content-type') || '').toLowerCase();
      if (!resp.ok || !ct.includes('application/json')) {
        scheduleTokenBudgetRefresh();
        return resp;
      }

      let applied = false;
      try {
        const peek = await resp.clone().json();
        if (peek && typeof peek === 'object' && peek.tokenBudget) {
          renderTokenBudget(peek.tokenBudget);
          applied = true;
        }
      } catch {
        // Non-JSON or stream already locked — fall through to the fetch fallback.
      }

      if (!applied) scheduleTokenBudgetRefresh();
    } catch {}
    return resp;
  };
})();

// =====================================================================
// Active page banner & job detection
// =====================================================================

/**
 * Normalise a URL for comparison: strip trailing slashes, fragments,
 * and common tracking query params so that small variations still match.
 */
function normalizeUrlForMatch(raw) {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    // LinkedIn canonical: /jobs/view/12345/ vs ?currentJobId=12345
    if (u.hostname.includes('linkedin.com')) {
      const jobId = u.searchParams.get('currentJobId');
      if (jobId) return `https://www.linkedin.com/jobs/view/${jobId}/`;
      const m = u.pathname.match(/\/jobs\/view\/(\d+)/);
      if (m) return `https://www.linkedin.com/jobs/view/${m[1]}/`;
    }
    u.hash = '';
    // Remove common tracking params
    for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'ref', 'fbclid', 'gclid']) {
      u.searchParams.delete(p);
    }
    return u.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '').split('#')[0];
  }
}

/**
 * Find a tracked job whose sourceUrl OR applyUrl matches the given URL.
 * Returns { job, matchedBy: 'sourceUrl'|'applyUrl' } or null.
 *
 * Apply pages (e.g. a Workday form opened from a LinkedIn listing) have
 * a different URL than the source job listing. Matching both ensures the
 * same tracked job surfaces on either page instead of being treated as a
 * new job when the user clicks "Apply".
 */
function findMatchingTrackedJob(url) {
  if (!url || !trackedJobsList.length) return null;
  const norm = normalizeUrlForMatch(url);
  if (!norm) return null;

  // First pass: sourceUrl (the listing). This is the canonical match.
  const bySource = trackedJobsList.find((j) => {
    const jUrl = normalizeUrlForMatch(j.sourceUrl);
    return jUrl && jUrl === norm;
  });
  if (bySource) return { job: bySource, matchedBy: 'sourceUrl' };

  // Second pass: applyUrl. Only match when applyUrl is genuinely different
  // from sourceUrl — otherwise we'd re-match the same job and mis-flag the
  // listing page as an application page.
  const byApply = trackedJobsList.find((j) => {
    if (!j.applyUrl) return false;
    const aUrl = normalizeUrlForMatch(j.applyUrl);
    const sUrl = normalizeUrlForMatch(j.sourceUrl);
    if (!aUrl || aUrl === sUrl) return false;
    return aUrl === norm;
  });
  if (byApply) return { job: byApply, matchedBy: 'applyUrl' };

  return null;
}

/**
 * Ensure there is an active (selected) resume. Handles three states:
 *
 *  1. No resumes at all → returns 'none'
 *  2. Resumes exist but none is active → auto-activates master, returns 'auto-activated'
 *  3. A resume is already active → returns 'ok'
 *
 * After this call, `selectedResume` is either set or null (state 1).
 */
function ensureActiveResume() {
  if (selectedResume) return 'ok';

  // No resumes loaded at all
  if (!resumeGroups || resumeGroups.length === 0) return 'none';

  // Resumes exist — find a master and auto-activate it
  const allResumes = resumeGroups.flatMap(g => [g.masterResume, ...(g.variations || [])]);

  // Prefer a master resume
  const master = allResumes.find(r => r.isMaster);
  if (master) {
    console.log('[hired.video] ensureActiveResume — auto-activating master:', master.id, master.name || master.title);
    selectResume(master);
    // Persist on server (fire and forget)
    getJwtToken().then(token => {
      if (token) fetch(buildResumeUrl(master.id, 'setactive'), {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    });
    return 'auto-activated';
  }

  // No master — just pick the first resume
  const first = allResumes[0];
  if (first) {
    console.log('[hired.video] ensureActiveResume — auto-activating first resume:', first.id);
    selectResume(first);
    return 'auto-activated';
  }

  return 'none';
}

function handleJobDetected(payload) {
  if (!payload || !payload.title) {
    detectedPageJob = null;
    showElement('noJobBanner');
    hideElement('activePageBanner');
    highlightActiveTrackedJob(null);
    return;
  }
  detectedPageJob = payload;

  // Check if this job is already tracked — matches against both sourceUrl
  // and applyUrl so the application-form page reconciles back to the same
  // tracked job instead of looking like a brand-new listing.
  const match = findMatchingTrackedJob(payload.sourceUrl);
  const matched = match?.job || null;
  const onApplyPage = match?.matchedBy === 'applyUrl';

  document.getElementById('activePageTitle').textContent =
    matched?.title || payload.title;
  const meta = matched
    ? [matched.company, matched.location].filter(Boolean).join(' • ')
    : [payload.company, payload.location].filter(Boolean).join(' • ');
  document.getElementById('activePageMeta').textContent = meta;

  const eyebrow = document.querySelector('#activePageBanner .active-page-eyebrow');

  hideAllBannerActions();

  // "Already tracked" banner on the listing page is redundant — the
  // matched row already highlights green in the Tracked Jobs list below.
  // Hide the whole banner in that case; still show it for the apply-page
  // flow (autofill CTA) and for untracked jobs (Track CTA).
  const hideBannerBecauseTracked = matched && !onApplyPage;

  if (matched) {
    trackedJob = buildTrackedJobObj(matched);
    currentJobUrl = onApplyPage ? matched.applyUrl : matched.sourceUrl;
    if (onApplyPage) {
      if (eyebrow) eyebrow.textContent = '📝 Application page — tracked';
      // On the apply page, offer to autofill the form.
      showElement('quickAutofillButton');
      hideElement('quickStatus');
    }
    // For matched && !onApplyPage we fall through: banner is hidden
    // entirely below, so there's nothing to populate.
  } else {
    if (eyebrow) eyebrow.textContent = '📌 Job detected on this page';

    // Track is the only primary action on the banner now — Tailor / Score
    // are reached from the tracked-jobs list below once the job is saved.
    showElement('quickTrackButton');
    const resumeState = ensureActiveResume();
    if (resumeState === 'none') {
      showQuickStatus('Upload a resume on the Resume tab to enable tailoring.', 'warning');
    } else {
      hideElement('quickStatus');
    }
  }

  hideElement('noJobBanner');
  if (hideBannerBecauseTracked) {
    hideElement('activePageBanner');
  } else {
    showElement('activePageBanner');
  }
  highlightActiveTrackedJob(matched);

  if (!matched && selectedResume) {
    if (settings.autoTailor && isPremium) {
      runTailorAndSavePipeline({ track: true, silent: true }).catch((err) =>
        console.warn('[hired.video] auto-tailor failed', err),
      );
    } else if (settings.autoScore) {
      runScoreOnlyPipeline().catch((err) => console.warn('[hired.video] auto-score failed', err));
    }
  }
}

/**
 * Reset every action button in the activePageBanner to hidden. Callers
 * then showElement() exactly the buttons that apply to the current state
 * (listing / tracked / apply-page). Cheaper to centralise than to list
 * five hideElement() calls at every branch.
 */
function hideAllBannerActions() {
  hideElement('quickTrackButton');
  hideElement('quickApplyButton');
  hideElement('quickAutofillButton');
}

/**
 * Render the activePageBanner in "application page" mode for the given
 * tracked job. Factored out so the URL-change listener can call it even
 * when no payload exists.
 */
function showApplyPageBanner(job) {
  detectedPageJob = {
    title: job.title,
    company: job.company,
    location: job.location,
    sourceUrl: job.applyUrl || job.sourceUrl,
    applyUrl: job.applyUrl || job.sourceUrl,
  };
  trackedJob = buildTrackedJobObj(job);
  currentJobUrl = job.applyUrl || job.sourceUrl;

  document.getElementById('activePageTitle').textContent = job.title || 'Application';
  const meta = [job.company, job.location].filter(Boolean).join(' • ');
  document.getElementById('activePageMeta').textContent = meta;
  const eyebrow = document.querySelector('#activePageBanner .active-page-eyebrow');
  if (eyebrow) eyebrow.textContent = '📝 Application page — tracked';

  hideAllBannerActions();
  showElement('quickAutofillButton');
  hideElement('quickStatus');
  hideElement('noJobBanner');
  showElement('activePageBanner');
  highlightActiveTrackedJob(job);
}

/**
 * Highlight the tracked job row that matches the given job (or clear all
 * highlights when null). Also scrolls the highlighted row into view.
 */
function highlightActiveTrackedJob(matchedJob) {
  // Clear all existing highlights
  document.querySelectorAll('.tracked-job-row-active').forEach((el) =>
    el.classList.remove('tracked-job-row-active'),
  );
  if (!matchedJob) return;
  const id = matchedJob.id || matchedJob.Id;
  const row = document.querySelector(`.tracked-job-row[data-job-id="${id}"]`);
  if (row) {
    row.classList.add('tracked-job-row-active');
    row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function handleManualScan() {
  const ok = await requireAuth();
  if (!ok) return;
  await capturePageHtmlLegacy();
  if (!currentJobUrl) return;

  // Ask the content script to re-run detection for real title/company/location
  const detected = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'detectJob' }, (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[hired.video] detectJob message failed:', chrome.runtime.lastError.message);
        resolve(null);
        return;
      }
      resolve(response?.payload || null);
    });
  });

  // If the content script didn't respond (e.g. tab predates extension
  // install, or the script crashed), extract what we can from the HTML
  // we already captured via capturePageHtmlLegacy → getHTML fallback.
  const payload = detected || extractJobFromCapturedHtml() || {
    title: 'Detected page',
    company: '',
    location: '',
    sourceUrl: currentJobUrl,
  };
  console.log('[hired.video] handleManualScan — payload:', payload.title, '| source:', detected ? 'content-script' : (payload.title !== 'Detected page' ? 'html-parse' : 'fallback'));
  handleJobDetected(payload);

  // Only show the "click Tailor & Save" hint for new/untracked jobs
  if (!findMatchingTrackedJob(payload.sourceUrl)?.job) {
    showQuickStatus('Page scanned — click Tailor & Save to continue.', 'info');
  }
}

/**
 * Best-effort job extraction from the already-captured page HTML.
 * Used when the content script's detectJob message fails (e.g. tab
 * loaded before the extension was installed). Mirrors the content
 * script's genericJobExtract() but runs against a parsed HTML string
 * rather than the live DOM.
 */
function extractJobFromCapturedHtml() {
  const html = currentJobOriginalHtml;
  if (!html) return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  const NOISE = new Set([
    'home', 'careers', 'jobs', 'job openings', 'open positions',
    'search results', 'apply now', 'sign in', 'log in', 'menu',
  ]);

  let title = '';

  // 1. JSON-LD JobPosting (best signal)
  const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of ldScripts) {
    if (!script.textContent || !script.textContent.includes('JobPosting')) continue;
    try {
      const data = JSON.parse(script.textContent);
      const items = Array.isArray(data) ? data : data?.['@graph'] || [data];
      for (const item of items) {
        if ((item?.['@type'] || '').toString().toLowerCase() !== 'jobposting') continue;
        title = (item.title || '').toString().trim();
        const company = (item.hiringOrganization?.name || '').toString().trim();
        const loc = item.jobLocation?.address;
        const location = loc
          ? [loc.addressLocality, loc.addressRegion, loc.addressCountry].filter(Boolean).join(', ')
          : '';
        if (title) {
          return { title: title.slice(0, 250), company, location, sourceUrl: currentJobUrl, applyUrl: currentJobUrl };
        }
      }
    } catch (e) { /* malformed JSON-LD */ }
  }

  // 2. First h1 on the page
  const h1 = doc.querySelector('h1');
  if (h1) {
    const txt = h1.textContent.replace(/\s+/g, ' ').trim();
    if (txt && txt.length > 3 && txt.length < 200 && !NOISE.has(txt.toLowerCase())) {
      title = txt;
    }
  }

  // 3. <title> tag fallback
  if (!title) {
    const raw = (doc.title || '').replace(/\s+/g, ' ').trim();
    const cleaned = raw
      .replace(/\s*[-|–—•]\s*(Careers|Jobs|Hiring|Apply|Company|Recruit|Job Board|Openings).*$/i, '')
      .trim();
    if (cleaned && cleaned.length > 3 && cleaned.length < 200 && !NOISE.has(cleaned.toLowerCase())) {
      title = cleaned;
    }
  }

  if (!title) return null;

  // Company from og:site_name
  let company = '';
  const ogSiteName = doc.querySelector('meta[property="og:site_name"]');
  if (ogSiteName) company = (ogSiteName.getAttribute('content') || '').trim();

  // Location from common selectors
  let location = '';
  const locEl = doc.querySelector('[data-testid*="location"], [class*="job-location"], [class*="jobLocation"]');
  if (locEl) location = locEl.textContent.replace(/\s+/g, ' ').trim();

  console.log('[hired.video] extractJobFromCapturedHtml — title:', title, '| company:', company);
  return {
    title: title.slice(0, 250),
    company,
    location,
    sourceUrl: currentJobUrl,
    applyUrl: currentJobUrl,
  };
}

/**
 * Ask the active tab's content script to re-run job detection and
 * surface the result in the banner. Used after tab switches and
 * initial panel open.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.force] - Skip the autoDetect check (e.g.
 *   for first-open "Already tracked" awareness).
 */
function requestActiveTabDetection(opts) {
  if (!opts?.force && settings.autoDetect === false) return;
  chrome.runtime.sendMessage({ action: 'detectJob' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.payload) {
      handleJobDetected(response.payload);
      return;
    }
    // No JobPosting on the page. Before giving up, check the tab URL
    // against tracked jobs' applyUrls — this is how we surface the
    // autofill banner on Workday/Greenhouse apply forms that don't
    // emit JSON-LD.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url;
      if (!url) return;
      const match = findMatchingTrackedJob(url);
      if (match?.matchedBy === 'applyUrl') {
        showApplyPageBanner(match.job);
      }
    });
  });
}

function showQuickStatus(message, kind) {
  const el = document.getElementById('quickStatus');
  if (!el) return;
  el.className = `alert alert-${kind || 'info'} mt-2`;
  el.textContent = message;
  el.classList.remove('hidden');
}

/**
 * Score the detected page job and show results inline in the
 * detection banner (bannerScoreDetail area).
 */
async function handleBannerScore() {
  const ok = await requireAuth();
  if (!ok) return;
  if (!selectedResume) {
    showQuickStatus('Upload or select a resume first.', 'warning');
    switchTab('resume');
    showResumeSelection();
    return;
  }
  if (!detectedPageJob) {
    showQuickStatus('No job detected on this page.', 'error');
    return;
  }

  showQuickStatus('Scoring resume against job…', 'info');
  hideElement('bannerScoreDetail');

  try {
    // First, track/extract the job so we have a jobId to score against
    const jobCtx = await captureJobContext();
    if (!jobCtx) throw new Error('Could not read the current page.');

    // Prefer the canonical URL from job detection over the raw page URL
    const canonicalUrl = detectedPageJob?.sourceUrl || jobCtx.originUrl;

    const jwtToken = await getJwtToken();
    const extractResp = await fetch(`${jobsExtractUrl}?track=false`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({
        url: canonicalUrl,
        sourceUrl: canonicalUrl,
        html: jobCtx.html,
        track: false,
        ...(detectedPageJob?.title ? { hintTitle: detectedPageJob.title } : {}),
        ...(detectedPageJob?.company ? { hintCompany: detectedPageJob.company } : {}),
        ...(detectedPageJob?.location ? { hintLocation: detectedPageJob.location } : {}),
      }),
    });
    if (extractResp.status === 401) return handleTokenExpired();
    if (!extractResp.ok) {
      // If extract fails, try scoring by content directly
      const analyzeResp = await fetch(matchAnalyze, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
        body: JSON.stringify({ jobHtml: jobCtx.html, resumeId: selectedResume.id }),
      });
      if (analyzeResp.status === 401) return handleTokenExpired();
      if (await check429(analyzeResp, 'quickStatus')) return;
      if (!analyzeResp.ok) throw new Error('Score failed');
      const data = await analyzeResp.json();
      const result = unwrapResponse(data);
      renderBannerScoreResult(result.score ?? 0, result.summaryRecommendations || '');
      return;
    }

    const extractData = await extractResp.json();
    const job = unwrapResponse(extractData);
    const jobId = job.id;

    // Now score
    const resp = await fetch(matchAnalyze, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({ jobId, resumeId: selectedResume.id }),
    });
    if (resp.status === 401) return handleTokenExpired();
    if (await check429(resp, 'quickStatus')) return;
    if (!resp.ok) throw new Error('Score failed');
    const data = await resp.json();
    const result = unwrapResponse(data);
    const score = result.score ?? 0;
    const recommendations = result.summaryRecommendations || '';

    // Cache the score
    if (jobId) saveJobScore(jobId, score, recommendations, selectedResume?.name || selectedResume?.title || 'Resume');
    hideElement('quickStatus');
    renderBannerScoreResult(score, recommendations, jobId);
  } catch (err) {
    showQuickStatus(err.message || 'Score failed.', 'error');
  }
}

/**
 * Render score results inline within the detection banner.
 */
function renderBannerScoreResult(score, recommendations, jobId) {
  const panel = document.getElementById('bannerScoreDetail');
  if (!panel) return;

  const scoreColorClass = score >= 70 ? 'score-high' : score >= 40 ? 'score-medium' : 'score-low';
  const converter = new showdown.Converter();
  const recHtml = recommendations
    ? converter.makeHtml(recommendations)
    : '<em>No recommendations available.</em>';

  panel.innerHTML = `
    <div class="score-detail-content">
      <div class="score-detail-header">
        <span class="row-score-pill ${scoreColorClass}">${formatScore(score)}</span>
        <span class="score-detail-label">Match Score</span>
      </div>
      <div class="score-detail-recommendations">${recHtml}</div>
      ${jobId ? `<div class="score-detail-actions">
        <button class="btn btn-primary btn-compact" id="bannerScoreTailor">✨ Tailor to Fix Gaps</button>
      </div>` : ''}
    </div>
  `;
  panel.classList.remove('hidden');

  if (jobId) {
    document.getElementById('bannerScoreTailor')?.addEventListener('click', () => {
      panel.classList.add('hidden');
      rowTailorJob(jobId);
    });
  }
}

// =====================================================================
// Apply-to-job + autofill
// =====================================================================

/**
 * Open the tracked job's applyUrl in the CURRENT tab. Navigating in
 * place (instead of chrome.tabs.create) keeps the user in the same
 * browsing context so the sidepanel can reconcile the new URL against
 * the tracked job and swap to Autofill mode automatically.
 */
function handleApplyToTrackedJob() {
  const target = trackedJob?.applyUrl
    || detectedPageJob?.applyUrl
    || trackedJob?.sourceUrl;
  if (!target) {
    showQuickStatus('No apply URL on this job.', 'warning');
    return;
  }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (tab?.id !== undefined) {
      chrome.tabs.update(tab.id, { url: target });
    } else {
      chrome.tabs.create({ url: target });
    }
  });
}

/**
 * Autofill the application form on the current tab using the active
 * resume. Four-step flow:
 *   1. Ask the autofill content script to extract visible form fields.
 *   2. Pull the resume's full JSON (basics + work + education + skills).
 *   3. Heuristically match each field's label / name / placeholder to a
 *      resume attribute via AUTOFILL_PATTERNS.
 *   4. Fill matched fields, then render a per-field review panel so the
 *      user can see what was filled, skipped, or unmatched before
 *      submitting.
 *
 * Heuristic-only (no AI backend call) so this ships without a new API.
 * The content script already normalises label resolution across ATSes.
 */
async function handleAutofillApplication() {
  const ok = await requireAuth();
  if (!ok) return;
  if (!selectedResume) {
    showQuickStatus('Upload or select a resume first.', 'warning');
    switchTab('resume');
    showResumeSelection();
    return;
  }

  showQuickStatus('Reading application form…', 'info');
  hideElement('autofillDetail');

  // 1. Extract form fields
  const extracted = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'extractFormFields' }, (response) => {
      resolve(response || null);
    });
  });
  const fields = extracted?.fields || [];
  if (!fields.length) {
    showQuickStatus('No fillable form found on this page.', 'warning');
    return;
  }

  // 2. Load resume basics + user profile
  const profile = await loadAutofillProfile(selectedResume.id);
  if (!profile) {
    showQuickStatus('Could not read your resume contact details.', 'error');
    return;
  }

  // 3. Build answers map + per-field review entries
  const answers = {};
  const review = []; // { label, value, profileKey, status }
  for (const field of fields) {
    const picked = pickAutofillValue(field, profile);
    if (picked && picked.value) {
      answers[field.id] = picked.value;
      review.push({
        label: field.label || field.name || field.id,
        value: picked.value,
        profileKey: picked.key,
        status: 'pending',
      });
    } else {
      review.push({
        label: field.label || field.name || field.id,
        value: '',
        profileKey: null,
        status: 'unmatched',
      });
    }
  }

  const matched = Object.keys(answers).length;
  if (!matched) {
    showQuickStatus('No fields matched your resume. Fill the form manually or pick a different resume.', 'warning');
    renderAutofillReview(review, extracted.atsProvider);
    return;
  }

  // 4. Fill and render review
  showQuickStatus(`Filling ${matched} field${matched === 1 ? '' : 's'}…`, 'info');
  const filledResp = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'fillFormFields', answers }, (response) => {
      resolve(response || { results: {} });
    });
  });
  const results = filledResp.results || {};

  // Map fill results back onto the review list
  for (const row of review) {
    if (row.status !== 'pending') continue;
    // Find the matching answer key — review rows are in the same order
    // as fields, so the nth pending row corresponds to the nth answer.
    // Easier: look up by label against a reverse map.
  }
  let i = 0;
  for (const field of fields) {
    if (!(field.id in answers)) { i++; continue; }
    const r = results[field.id];
    review[i].status = r === 'filled' ? 'filled' : (r === 'skipped' ? 'skipped' : 'error');
    i++;
  }

  const okCount = review.filter((r) => r.status === 'filled').length;
  const ats = extracted.atsProvider || 'generic';
  showQuickStatus(
    `✅ Autofilled ${okCount} of ${fields.length} fields on ${ats}. Review below and finish the rest before submitting.`,
    'success',
  );
  renderAutofillReview(review, ats);
}

/**
 * Render a per-field breakdown of what was filled, skipped, or unmatched
 * into the #autofillDetail panel. Gives the user a clear checklist of
 * what still needs their attention before hitting Submit.
 */
function renderAutofillReview(review, ats) {
  const panel = document.getElementById('autofillDetail');
  if (!panel) return;

  const icon = (s) => {
    if (s === 'filled') return '✅';
    if (s === 'skipped') return '⏭';
    if (s === 'error') return '⚠️';
    return '◻';
  };

  const groups = {
    filled: review.filter((r) => r.status === 'filled'),
    skipped: review.filter((r) => r.status === 'skipped' || r.status === 'error'),
    unmatched: review.filter((r) => r.status === 'unmatched'),
  };

  const renderRows = (rows) => rows.map((r) => `
    <li class="autofill-row autofill-row-${r.status}">
      <span class="autofill-row-icon">${icon(r.status)}</span>
      <span class="autofill-row-label">${escapeHtml(r.label)}</span>
      ${r.value ? `<span class="autofill-row-value">${escapeHtml(String(r.value).slice(0, 80))}</span>` : ''}
    </li>`).join('');

  panel.innerHTML = `
    <div class="autofill-review">
      <div class="autofill-review-header">
        <strong>Autofill review</strong>
        <span class="autofill-review-ats">${escapeHtml(ats || 'generic')}</span>
      </div>
      ${groups.filled.length ? `
        <div class="autofill-group">
          <div class="autofill-group-title">Filled (${groups.filled.length})</div>
          <ul class="autofill-list">${renderRows(groups.filled)}</ul>
        </div>` : ''}
      ${groups.skipped.length ? `
        <div class="autofill-group">
          <div class="autofill-group-title">Needs your attention (${groups.skipped.length})</div>
          <ul class="autofill-list">${renderRows(groups.skipped)}</ul>
        </div>` : ''}
      ${groups.unmatched.length ? `
        <div class="autofill-group">
          <div class="autofill-group-title">Not in resume (${groups.unmatched.length})</div>
          <ul class="autofill-list">${renderRows(groups.unmatched)}</ul>
        </div>` : ''}
    </div>
  `;
  panel.classList.remove('hidden');
}

/**
 * Fetch the selected resume + user profile and return a flat map of
 * autofill-friendly attributes. Falls back gracefully when either
 * request fails — we always include at least the authed user's email
 * and name from /api/auth/me.
 */
async function loadAutofillProfile(resumeId) {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return null;

  const profile = {};

  // User profile via /api/auth/me — always available when signed in
  try {
    const meResp = await fetch(meUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (meResp.ok) {
      const user = unwrapResponse(await meResp.json()) || {};
      if (user.name) {
        profile.fullName = user.name;
        const [first, ...rest] = user.name.split(/\s+/);
        profile.firstName = first || '';
        profile.lastName = rest.join(' ') || '';
      }
      if (user.email) profile.email = user.email;
    }
  } catch (err) { /* non-fatal */ }

  // Resume basics via /api/resumes/{id}
  try {
    const resp = await fetch(`${resumeBase}/${resumeId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (resp.ok) {
      const resume = unwrapResponse(await resp.json()) || {};
      const basics = extractResumeBasics(resume);
      Object.assign(profile, basics);
    }
  } catch (err) { /* non-fatal */ }

  return Object.keys(profile).length ? profile : null;
}

/**
 * Pull a flat autofill map from the JSON Resume document. The backend
 * returns resume content in several shapes (object on `resumeData`,
 * JSON string on `content`, sometimes at the top level) so we probe
 * each candidate until we find one with a JSON-Resume-shaped block.
 *
 * Emits keys the AUTOFILL_PATTERNS table knows how to route:
 *   • basics       → fullName, firstName, lastName, email, phone,
 *                    website, linkedin, github, twitter, city, state,
 *                    postalCode, country, address, headline, summary
 *   • work[0]      → currentCompany, currentTitle, currentStartDate,
 *                    currentEndDate
 *   • work[*]      → yearsExperience
 *   • education[0] → school, degree, fieldOfStudy, graduationYear, gpa
 *   • skills[]     → skills (comma-joined)
 *   • languages[]  → languages (comma-joined)
 */
function extractResumeBasics(resume) {
  if (!resume) return {};
  const candidates = [resume.resumeData, resume.content, resume.data, resume];
  let doc = null;
  for (const c of candidates) {
    if (c && typeof c === 'object' && (c.basics || c.work || c.education)) { doc = c; break; }
    if (typeof c === 'string') {
      try {
        const parsed = JSON.parse(c);
        if (parsed && (parsed.basics || parsed.work || parsed.education)) { doc = parsed; break; }
      } catch (e) { /* not JSON */ }
    }
  }
  if (!doc) return {};

  const out = {};
  const basics = doc.basics || {};
  if (basics.name) {
    out.fullName = basics.name;
    const [first, ...rest] = basics.name.split(/\s+/);
    out.firstName = first || '';
    out.lastName = rest.join(' ') || '';
  }
  if (basics.email) out.email = basics.email;
  if (basics.phone) out.phone = basics.phone;
  if (basics.url) out.website = basics.url;
  if (basics.label) out.headline = basics.label;
  if (basics.summary) out.summary = basics.summary;

  const loc = basics.location;
  if (loc) {
    if (loc.city) out.city = loc.city;
    if (loc.region) out.state = loc.region;
    if (loc.postalCode) out.postalCode = loc.postalCode;
    if (loc.countryCode || loc.country) out.country = loc.countryCode || loc.country;
    if (loc.address) out.address = loc.address;
  }

  if (Array.isArray(basics.profiles)) {
    for (const p of basics.profiles) {
      const network = (p.network || '').toLowerCase();
      const url = p.url || '';
      if (!url) continue;
      if (network.includes('linkedin')) out.linkedin = url;
      else if (network.includes('github')) out.github = url;
      else if (network.includes('twitter') || network.includes('x.com')) out.twitter = url;
      else if (network.includes('portfolio') || network.includes('website')) out.website ||= url;
    }
  }

  // Most recent work entry — treated as "current" for form fields like
  // "Current Company" / "Most Recent Title".
  if (Array.isArray(doc.work) && doc.work.length) {
    const current = doc.work[0] || {};
    if (current.name || current.company) out.currentCompany = current.name || current.company;
    if (current.position) out.currentTitle = current.position;
    if (current.startDate) out.currentStartDate = current.startDate;
    if (current.endDate) out.currentEndDate = current.endDate;
    const yrs = totalYearsOfExperience(doc.work);
    if (yrs != null) out.yearsExperience = String(yrs);
  }

  // Most recent education entry
  if (Array.isArray(doc.education) && doc.education.length) {
    const edu = doc.education[0] || {};
    if (edu.institution) out.school = edu.institution;
    if (edu.studyType || edu.area) {
      out.degree = [edu.studyType, edu.area].filter(Boolean).join(' in ');
    }
    if (edu.area) out.fieldOfStudy = edu.area;
    if (edu.endDate) {
      const yr = String(edu.endDate).match(/\d{4}/);
      if (yr) out.graduationYear = yr[0];
    }
    if (edu.score) out.gpa = String(edu.score);
  }

  // Flat comma-joined lists — many ATSes render Skills as a single text box.
  if (Array.isArray(doc.skills) && doc.skills.length) {
    out.skills = doc.skills
      .map((s) => (typeof s === 'string' ? s : s?.name || ''))
      .filter(Boolean)
      .join(', ');
  }
  if (Array.isArray(doc.languages) && doc.languages.length) {
    out.languages = doc.languages
      .map((l) => (typeof l === 'string' ? l : l?.language || ''))
      .filter(Boolean)
      .join(', ');
  }

  return out;
}

/**
 * Sum whole-year durations across all work entries. Returns a rounded
 * whole number or null when no dateable entry exists. Coarse on purpose
 * — application forms ask "years of experience" as an integer.
 */
function totalYearsOfExperience(work) {
  let months = 0;
  let any = false;
  for (const job of work) {
    const start = parseDateToMonths(job.startDate);
    if (start == null) continue;
    const end = job.endDate ? parseDateToMonths(job.endDate) : nowMonths();
    if (end == null) continue;
    months += Math.max(0, end - start);
    any = true;
  }
  return any ? Math.max(0, Math.round(months / 12)) : null;
}

function parseDateToMonths(raw) {
  if (!raw) return null;
  const m = String(raw).match(/(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) - 1 : 0;
  return year * 12 + month;
}

function nowMonths() {
  const d = new Date();
  return d.getFullYear() * 12 + d.getMonth();
}

/**
 * Pattern→key routing table for form-field autofill. Each entry maps a
 * case-insensitive substring of the field's label/name/placeholder to
 * the corresponding profile key. Earlier entries win, so list specific
 * ones (first name) before generic ones (name).
 *
 * Kept as data so the matching function stays linear and easy to audit.
 */
const AUTOFILL_PATTERNS = [
  // Name — specific forms first so they don't get eaten by "name"
  { key: 'firstName',      matches: ['first name', 'firstname', 'given name', 'first_name', 'forename'] },
  { key: 'lastName',       matches: ['last name', 'lastname', 'family name', 'surname', 'last_name'] },
  { key: 'fullName',       matches: ['full name', 'your name', 'legal name', 'name (as', 'preferred name'] },

  // Contact
  { key: 'email',          matches: ['email', 'e-mail'] },
  { key: 'phone',          matches: ['phone', 'mobile', 'telephone', 'cell'] },

  // Social
  { key: 'linkedin',       matches: ['linkedin', 'linked in'] },
  { key: 'github',         matches: ['github', 'git hub'] },
  { key: 'twitter',        matches: ['twitter', 'x.com profile', 'x profile'] },
  { key: 'website',        matches: ['portfolio', 'website', 'personal site', 'personal url', 'personal web'] },

  // Location
  { key: 'address',        matches: ['street address', 'address line', 'mailing address', 'address 1'] },
  { key: 'city',           matches: ['city', 'town'] },
  { key: 'state',          matches: ['state', 'province', 'region'] },
  { key: 'postalCode',     matches: ['postal code', 'postcode', 'zip code', 'zip/postal', 'zip'] },
  { key: 'country',        matches: ['country'] },

  // Experience — currentCompany before "company" / "employer" so generic
  // "Current Employer" doesn't shadow a hypothetical "Company Name" field
  { key: 'currentCompany', matches: ['current company', 'current employer', 'most recent company',
                                     'most recent employer', 'present company', 'present employer',
                                     'company name', 'employer'] },
  { key: 'currentTitle',   matches: ['current title', 'current position', 'current role',
                                     'most recent title', 'most recent position', 'job title',
                                     'current job'] },
  { key: 'currentStartDate', matches: ['start date at', 'start date in current', 'date started current'] },
  { key: 'yearsExperience',matches: ['years of experience', 'years experience', 'total experience',
                                     'years in', 'how many years'] },

  // Education
  { key: 'school',         matches: ['school', 'university', 'college', 'institution'] },
  { key: 'degree',         matches: ['degree', 'highest level of education', 'education level'] },
  { key: 'fieldOfStudy',   matches: ['field of study', 'major', 'area of study', 'discipline'] },
  { key: 'graduationYear', matches: ['graduation year', 'grad year', 'year graduated', 'year of graduation'] },
  { key: 'gpa',            matches: ['gpa', 'grade point'] },

  // Free-text dump fields
  { key: 'skills',         matches: ['skills', 'key skills', 'technical skills', 'core competencies'] },
  { key: 'languages',      matches: ['languages spoken', 'languages you speak', 'spoken languages'] },
  { key: 'summary',        matches: ['summary', 'about you', 'tell us about', 'bio', 'professional summary',
                                     'cover letter', 'why are you interested', 'why do you want'] },
  { key: 'headline',       matches: ['headline', 'professional headline', 'tagline'] },

  // Generic 'name' last — otherwise it'd eat "first name" matches above.
  { key: 'fullName',       matches: ['name'] },
];

/**
 * Decide what to fill into a given form field. Returns `{ key, value }`
 * when a pattern matches and the profile has the corresponding value,
 * or null when no pattern matches. Matching stages:
 *   1. Concatenate label + name + id + placeholder into a haystack.
 *   2. Walk AUTOFILL_PATTERNS in order; first hit with a populated
 *      profile value wins.
 *
 * Select/radio values pass through — the content script's setFieldValue
 * handles fuzzy option matching (e.g. "United States" → "US").
 */
function pickAutofillValue(field, profile) {
  const haystack = [
    field.label || '',
    field.name || '',
    field.id || '',
    field.placeholder || '',
  ].join(' ').toLowerCase();
  if (!haystack.trim()) return null;

  for (const pat of AUTOFILL_PATTERNS) {
    if (pat.matches.some((m) => haystack.includes(m))) {
      const v = profile[pat.key];
      if (v) return { key: pat.key, value: v };
    }
  }
  return null;
}

// =====================================================================
// One-click Tailor & Save pipeline
// =====================================================================

/**
 * The fast path. Runs extract → tailor → save-as-variation in one go,
 * then surfaces the resulting variation in the tracked-jobs table.
 *
 * `options.track` — if false, the job is created on the public board
 * but NOT bookmarked to the user (uses /api/jobs/extract?track=false).
 * `options.silent` — for background auto-tailor; suppresses status alerts.
 */
async function runTailorAndSavePipeline(options = {}) {
  const ok = await requireAuth();
  if (!ok) return;
  if (pipelineBusy) return;

  if (!selectedResume) {
    showQuickStatus('Upload or select a resume first.', 'warning');
    switchTab('resume');
    showResumeSelection();
    return;
  }

  pipelineBusy = true;
  const track = options.track !== false;
  if (!options.silent) showQuickStatus('Extracting job from page…', 'info');

  try {
    // 1. Capture page HTML via the shared captureJobContext() which
    // already tries focused-pane → full-page → selector-based pane.
    const jobCtx = await captureJobContext();
    if (!jobCtx) throw new Error('Could not read the current page.');
    const jobPaneHtml = jobCtx.html;
    currentJobUrl = detectedPageJob?.sourceUrl || jobCtx.originUrl || currentJobUrl;
    currentJobOriginalHtml = jobCtx.html;

    // 2. Extract via /api/jobs/extract (with or without tracking)
    if (!options.silent) showQuickStatus('Tracking job…', 'info');
    const jwtToken = await getJwtToken();
    const extractResp = await fetch(`${jobsExtractUrl}?track=${track ? 'true' : 'false'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        url: currentJobUrl,
        sourceUrl: currentJobUrl,
        html: jobPaneHtml,
        track,
        force: !!options._force,
        // Pass detected title/company as hints — the content script
        // already parsed these from the DOM. The API uses them as
        // fallbacks when AI extraction struggles with noisy HTML.
        ...(detectedPageJob?.title ? { hintTitle: detectedPageJob.title } : {}),
        ...(detectedPageJob?.company ? { hintCompany: detectedPageJob.company } : {}),
        ...(detectedPageJob?.location ? { hintLocation: detectedPageJob.location } : {}),
      }),
    });

    if (extractResp.status === 401) return handleTokenExpired();
    if (await check429(extractResp, 'quickStatus')) return;
    if (extractResp.status === 422) {
      const errData = await extractResp.json().catch(() => ({}));
      showQuickStatus(
        '⚠️ ' +
          (errData.error?.message || 'This page does not look like a job posting.'),
        'warning',
      );
      return;
    }
    if (!extractResp.ok) throw new Error('Job extraction failed');

    const extractData = await extractResp.json();
    const jobPayload = unwrapResponse(extractData);

    // ---- Dedup: handle duplicate_candidates response ----
    if (jobPayload.duplicate_candidates && Array.isArray(jobPayload.duplicate_candidates)) {
      if (!options.silent) {
        pipelineBusy = false;
        showDedupModal(
          jobPayload.duplicate_candidates,
          // "Use existing" — bookmark the selected candidate and continue pipeline with it.
          (candidate) => {
            trackedJob = buildTrackedJobObj(candidate, {
              sourceUrl: currentJobUrl,
              applyUrl: detectedPageJob?.applyUrl || currentJobUrl,
            });
            chrome.storage.local.set({ [trackedJobKey]: trackedJob });
            // Continue the pipeline from the tailor step.
            continuePipelineFromTailor(jwtToken, candidate.id, options);
          },
          // "Track as new" — re-submit with force=true to skip dedup.
          () => {
            runTailorAndSavePipeline({ ...options, _force: true });
          },
        );
      }
      return;
    }

    const job = jobPayload;
    trackedJob = buildTrackedJobObj(job, {
      sourceUrl: currentJobUrl,
      applyUrl: detectedPageJob?.applyUrl || currentJobUrl,
    });
    chrome.storage.local.set({ [trackedJobKey]: trackedJob });

    // 3–4. Tailor + save as variation (shared helper)
    if (!options.silent) showQuickStatus('Tailoring resume…', 'info');
    const result = await tailorAndSaveVariation({
      jobId: job.id,
      selectedResume,
      trackedJob,
      sourceUrl: currentJobUrl,
    });
    generatedResumeData = result.tailored;
    generatedVariationId = result.variationId;

    // 5. Refresh table + show success
    showQuickStatus(
      `✅ Tailored resume saved (new score ${formatScore(result.tailored.newScore || result.tailored.score || 0)}).`,
      'success',
    );
    loadTrackedJobsTable();
    loadMasterResumeGroups();
  } catch (err) {
    console.error('[hired.video] pipeline failed', err);
    showQuickStatus(err.message || 'Something went wrong. Please try again.', 'error');
  } finally {
    pipelineBusy = false;
  }
}

/**
 * Continue the fast pipeline from Step 3 (tailor) onward, skipping
 * extract. Used when the dedup modal's "Use existing" button picks an
 * already-tracked job — we just need to tailor + save the variation.
 */
async function continuePipelineFromTailor(_jwtToken, jobId, options = {}) {
  pipelineBusy = true;
  try {
    if (!options.silent) showQuickStatus('Tailoring resume…', 'info');
    const result = await tailorAndSaveVariation({
      jobId,
      selectedResume,
      trackedJob,
      sourceUrl: currentJobUrl,
    });
    generatedResumeData = result.tailored;
    generatedVariationId = result.variationId;

    showQuickStatus(
      `✅ Tailored resume saved (new score ${formatScore(result.tailored.newScore || result.tailored.score || 0)}).`,
      'success',
    );
    loadTrackedJobsTable();
    loadMasterResumeGroups();
  } catch (err) {
    console.error('[hired.video] continuePipelineFromTailor failed', err);
    showQuickStatus(err.message || 'Something went wrong.', 'error');
  } finally {
    pipelineBusy = false;
  }
}

/**
 * Auto-score variant — used by the autoScore setting. Runs extract +
 * analyze without producing a tailored resume.
 */
async function runScoreOnlyPipeline() {
  const jwtToken = await getJwtToken();
  if (!jwtToken || !selectedResume || pipelineBusy) return;

  const jobCtx = await captureJobContext();
  if (!jobCtx) return;
  const jobPaneHtml = jobCtx.html;
  currentJobUrl = jobCtx.originUrl || currentJobUrl;

  const extractResp = await fetch(jobsExtractUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwtToken}`,
    },
    body: JSON.stringify({
      url: currentJobUrl,
      sourceUrl: currentJobUrl,
      html: jobPaneHtml,
    }),
  });
  if (!extractResp.ok) return;
  const extractData = await extractResp.json();
  const job = unwrapResponse(extractData);
  trackedJob = buildTrackedJobObj(job, {
    sourceUrl: currentJobUrl,
    applyUrl: detectedPageJob?.applyUrl || currentJobUrl,
  });

  await fetch(matchAnalyze, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwtToken}`,
    },
    body: JSON.stringify({ jobId: job.id, resumeId: selectedResume.id }),
  });
  loadTrackedJobsTable();
}

// =====================================================================
// Tracked jobs table
// =====================================================================

async function loadTrackedJobsTable() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  showElement('trackedJobsLoading');
  hideElement('trackedJobsEmpty');

  try {
    const response = await fetch(jobsSavedUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) throw new Error('Failed to load tracked jobs');

    const data = await response.json();
    const items = data?.data?.items || data?.data || data?.items || data || [];
    trackedJobsList = Array.isArray(items) ? items : [];
    renderTrackedJobsTable();

    // If a job is detected on the current page and it now matches a
    // tracked job (the list just loaded), refresh the banner to show
    // "Already tracked" instead of the default detection banner.
    if (detectedPageJob?.sourceUrl) {
      const matched = findMatchingTrackedJob(detectedPageJob.sourceUrl);
      if (matched?.job) handleJobDetected(detectedPageJob);
    } else {
      // First-open: the panel just opened on an already-loaded page.
      // Re-run detection now that trackedJobsList is populated so the
      // "Already tracked" banner shows up immediately. Force bypasses
      // the autoDetect setting — recognising a tracked job is context
      // awareness, not auto-detection.
      requestActiveTabDetection({ force: true });
    }
  } catch (err) {
    console.error('loadTrackedJobsTable failed:', err);
  } finally {
    hideElement('trackedJobsLoading');
  }
}

function renderTrackedJobsTable() {
  const list = document.getElementById('trackedJobsList');
  const badge = document.getElementById('trackedJobsCountBadge');
  if (!list) return;

  // Tab-button badge: only show when count > 0 so the Jobs tab stays
  // uncluttered for new users or when the tracker is empty.
  if (badge) {
    badge.textContent = String(trackedJobsList.length);
    badge.classList.toggle('hidden', trackedJobsList.length === 0);
  }

  if (trackedJobsList.length === 0) {
    list.innerHTML = '';
    showElement('trackedJobsEmpty');
    return;
  }
  hideElement('trackedJobsEmpty');

  const rows = trackedJobsList.map((job) => {
    const id = job.id || job.Id || '';
    const title = escapeHtml(job.title || job.Title || 'Untitled job');
    const meta = escapeHtml(
      [job.company, job.location].filter(Boolean).join(' • ') || 'hired.video Community',
    );
    const pipelineStatus = job.pipelineStatus || 'tracked';

    // Score button — shows score number directly when scored
    const cachedScore = jobScores[id];
    const scoreResumeTip = cachedScore?.resumeName ? ` (${cachedScore.resumeName})` : '';
    const scoreButton = cachedScore
      ? `<button class="btn btn-outline btn-scored ${scoreClass(cachedScore.score)}" data-action="toggle-score" data-job-id="${id}" title="Scored with${scoreResumeTip} — click to see recommendations"><span class="step-num">1</span>🎯 ${formatScore(cachedScore.score)}</button>`
      : `<button class="btn btn-outline" data-action="score" data-job-id="${id}"><span class="step-num">1</span>🎯 Score</button>`;

    // Status pill with pencil edit icon — clicking switches to a dropdown
    const statusPill = `<span class="status-pill-wrapper" id="statusPill-${id}"><button class="pipeline-status-pill status-${pipelineStatus}" data-action="edit-status" data-job-id="${id}" title="Change status">${pipelineStatus} ✎</button></span>`;

    // Tailor button
    const cachedTailor = jobTailorings[id];
    const tailorButton = cachedTailor
      ? `<button class="btn btn-outline btn-tailored" data-action="tailor" data-job-id="${id}" title="Re-tailor this resume"><span class="step-num">2</span>✨ Tailored</button>`
      : `<button class="btn btn-primary" data-action="tailor" data-job-id="${id}"><span class="step-num">2</span>✨ Tailor</button>`;

    // Resume row — shown when a tailored variation exists
    const resumeDisplayName = escapeHtml(cachedTailor?.variationName || '');
    const masterDisplayName = escapeHtml(cachedTailor?.masterResumeName || '');
    const resumeFullTip = masterDisplayName
      ? `${resumeDisplayName || 'Tailored resume'} (from ${masterDisplayName})`
      : resumeDisplayName || 'Tailored resume';
    const resumeRow = cachedTailor ? `
        <div class="tracked-job-resume-row">
          <button class="tailor-toggle" data-action="toggle-tailor-summary" data-job-id="${id}" aria-expanded="false" title="Show tailoring summary">
            <svg class="tailor-toggle-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
          <div class="resume-row-info">
            ${ICON.document}
            <span class="resume-row-name" title="${escapeHtml(resumeFullTip)}">${resumeDisplayName || 'Tailored resume'}${masterDisplayName ? `<span class="resume-row-source"> from ${masterDisplayName}</span>` : ''}</span>
          </div>
          <div class="resume-row-actions">
            <button class="icon-btn" data-action="download-tailored" data-job-id="${id}" title="Download resume">${ICON.download}</button>
            <button class="icon-btn" data-action="view-tailored" data-job-id="${id}" title="View resume">${ICON.externalLink}</button>
            <button class="icon-btn" data-action="retailor" data-job-id="${id}" title="Re-tailor this resume">${ICON.retailor}</button>
            <button class="icon-btn row-delete" data-action="delete-variation" data-job-id="${id}" title="Delete this tailored variation">${ICON.trash}</button>
          </div>
        </div>` : '';

    // Apply button — shown when we have a distinct apply URL (the link
    // a user clicks from the job listing to reach the actual application
    // form). Falls back silently when applyUrl is missing or matches the
    // source listing page.
    const sourceNorm = normalizeUrlForMatch(job.sourceUrl);
    const applyNorm = normalizeUrlForMatch(job.applyUrl);
    const hasDistinctApply = applyNorm && applyNorm !== sourceNorm;
    const applyButton = hasDistinctApply
      ? `<button class="btn btn-primary" data-action="apply" data-job-id="${id}" title="Open the application page in this tab"><span class="step-num">3</span>↗ Apply / Autofill</button>`
      : '';

    const titleHref = job.sourceUrl || job.applyUrl || '';
    const titleHtml = titleHref
      ? `<a class="tracked-job-title" href="${escapeHtml(titleHref)}" target="_blank" rel="noopener noreferrer" title="Open job posting in new tab">${title}<span class="tracked-job-title-icon" aria-hidden="true">${ICON.externalLink}</span></a>`
      : `<div class="tracked-job-title">${title}</div>`;

    return `
      <div class="tracked-job-row" data-job-id="${id}">
        <div class="tracked-job-row-header">
          <div class="tracked-job-info">
            ${titleHtml}
            <div class="tracked-job-meta">${meta}</div>
          </div>
          <div class="tracked-job-row-trailing">
            ${statusPill}
            <button class="row-rescan icon-btn" data-action="rescan" data-job-id="${id}" title="Scan this page to fill in missing job info">${ICON.scan}</button>
            <button class="row-delete icon-btn" data-action="delete" data-job-id="${id}" title="Remove from your tracker">${ICON.trash}</button>
          </div>
        </div>
        <div class="tracked-job-actions">
          ${scoreButton}
          ${tailorButton}
          ${applyButton}
        </div>
        ${resumeRow}
        <div class="tracked-job-score-detail hidden" id="scoreDetail-${id}"></div>
      </div>
    `;
  });

  list.innerHTML = rows.join('');

  list.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', onTrackedJobAction);
  });

  // Re-apply the active-row highlight for the current page's URL
  if (detectedPageJob?.sourceUrl) {
    const matched = findMatchingTrackedJob(detectedPageJob.sourceUrl);
    highlightActiveTrackedJob(matched?.job || null);
  }
}

function scoreClass(score) {
  const n = Number(score);
  if (n >= 70) return 'score-high';
  if (n >= 40) return 'score-medium';
  return 'score-low';
}

/**
 * Show a loading spinner on a tracked job row's action area.
 * Returns a cleanup function to restore the original state.
 */
function showRowLoading(jobId, message) {
  const row = document.querySelector(`.tracked-job-row[data-job-id="${jobId}"]`);
  if (!row) return () => {};
  const actions = row.querySelector('.tracked-job-actions');
  if (!actions) return () => {};
  const savedHtml = actions.innerHTML;
  actions.innerHTML = `<div class="row-loading"><div class="spinner-sm"></div><span>${escapeHtml(message || 'Processing...')}</span></div>`;
  // Disable all buttons in the row header too
  row.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  return () => {
    actions.innerHTML = savedHtml;
    row.querySelectorAll('button').forEach((b) => { b.disabled = false; });
    // Re-wire action listeners
    actions.querySelectorAll('button[data-action]').forEach((b) => {
      b.addEventListener('click', onTrackedJobAction);
    });
  };
}

async function onTrackedJobAction(event) {
  // Stop bubbling so the (i) icon inside a score badge doesn't also
  // trigger the row's primary action.
  event.stopPropagation();

  const btn = event.currentTarget;
  const action = btn.dataset.action;
  const jobId = btn.dataset.jobId;
  if (!jobId) return;

  switch (action) {
    case 'score':
      return rowScoreJob(jobId);
    case 'rescan':
      return handleRefreshJob(jobId);
    case 'toggle-score':
      toggleInlineScore(jobId);
      syncTailorToggleState(jobId);
      return;
    case 'toggle-tailor-summary':
      toggleInlineScore(jobId);
      syncTailorToggleState(jobId);
      return;
    case 'edit-status':
      return showStatusDropdown(jobId);
    case 'tailor':
      return rowTailorJob(jobId);
    case 'retailor':
      return rowRetailorJob(jobId);
    case 'download':
    case 'download-tailored':
      return rowDownloadTailoredVariation(jobId);
    case 'delete':
      return rowDeleteTrackedJob(jobId);
    case 'delete-variation':
      return rowDeleteTailoredVariation(jobId);
    case 'view-tailored': {
      const cached = jobTailorings[jobId];
      if (cached?.variationId) {
        chrome.tabs.create({ url: buildWebUrl(`/resumes/${cached.variationId}`) });
      }
      return;
    }
    case 'apply': {
      // Navigate the current tab to the apply URL so the user stays in
      // the same browsing context. findMatchingTrackedJob will reconcile
      // the new URL back to this tracked job, and the sidepanel swaps to
      // Autofill mode without treating the apply page as a new job.
      const applyJob = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
      if (!applyJob?.applyUrl) return;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        if (tab?.id !== undefined) {
          chrome.tabs.update(tab.id, { url: applyJob.applyUrl });
        } else {
          chrome.tabs.create({ url: applyJob.applyUrl });
        }
      });
      return;
    }
  }
}

/**
 * Keep the chevron on a row's tailor-summary toggle in sync with whether
 * its score-detail panel is currently open. Called after every toggle so
 * the chevron rotates from > (collapsed) to v (expanded).
 */
function syncTailorToggleState(jobId) {
  const panel = document.getElementById('scoreDetail-' + jobId);
  const row = document.querySelector(`.tracked-job-row[data-job-id="${jobId}"]`);
  if (!row) return;
  const expanded = panel && !panel.classList.contains('hidden');
  row.querySelectorAll('.tailor-toggle').forEach((btn) => {
    btn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btn.title = expanded ? 'Hide tailoring summary' : 'Show tailoring summary';
  });
  // Collapsing this row means any OTHER row's chevron should also revert —
  // toggleInlineScore closes all other score panels, so sync them too.
  document.querySelectorAll('.tracked-job-row').forEach((r) => {
    const otherId = r.dataset.jobId;
    if (otherId === jobId) return;
    const otherPanel = document.getElementById('scoreDetail-' + otherId);
    if (!otherPanel) return;
    const otherExpanded = !otherPanel.classList.contains('hidden');
    r.querySelectorAll('.tailor-toggle').forEach((btn) => {
      btn.setAttribute('aria-expanded', otherExpanded ? 'true' : 'false');
    });
  });
}

/**
 * Toggle inline score recommendations within a tracked job card.
 * Clicking the score pill expands/collapses the detail panel below
 * the action buttons inside that specific job row.
 */
function toggleInlineScore(jobId) {
  const panel = document.getElementById('scoreDetail-' + jobId);
  if (!panel) return;

  // Toggle: if already visible, collapse it
  if (!panel.classList.contains('hidden')) {
    panel.classList.add('hidden');
    return;
  }

  // Collapse any other open score detail panels
  document.querySelectorAll('.tracked-job-score-detail').forEach((el) => {
    if (el.id !== 'scoreDetail-' + jobId) el.classList.add('hidden');
  });

  const cached = jobScores[jobId];
  if (!cached) return;

  const converter = new showdown.Converter();
  const recHtml = cached.recommendations
    ? converter.makeHtml(cached.recommendations)
    : '<em>No recommendations available.</em>';

  const scoredWithName = escapeHtml(cached.resumeName || '');
  const scoredWithLabel = scoredWithName
    ? `<div class="score-detail-resume-label">Scored with: <strong>${scoredWithName}</strong></div>`
    : '';

  // Info-only panel: no action buttons. The tailored-resume row with
  // download/view icons lives directly above this panel in the main job
  // row, and Tailor / Re-score are reachable from the #1/#2 action buttons
  // — duplicating them here created clutter.
  panel.innerHTML = `
    <div class="score-detail-content">
      ${scoredWithLabel}
      <div class="score-detail-recommendations">${recHtml}</div>
    </div>
  `;
  panel.classList.remove('hidden');

  // Re-wire any data-action buttons that may appear inside the rendered
  // recommendations markdown (none in practice today, but keeps the
  // handler contract consistent).
  panel.querySelectorAll('[data-action="download-tailored"], [data-action="view-tailored"]').forEach((btn) => {
    btn.addEventListener('click', onTrackedJobAction);
  });
}

/**
 * Which fields on a tracked job we consider "missing" when they're null
 * or empty.
 *
 * The DTO returned by /api/jobs/saved uses different names than the DB
 * columns it's flattened from (e.g. DB `job_type` → DTO `employmentType`,
 * DB `skills_required` → DTO `skills`, DB `details.responsibilities` →
 * DTO top-level `responsibilities`). The detector reads from the DTO
 * shape; the /refresh endpoint expects DB-column names — so each entry
 * maps one to the other.
 */
const REFRESHABLE_FIELD_MAP = [
  { dtoGetter: (j) => j.description,       columnName: 'description' },
  { dtoGetter: (j) => j.location,          columnName: 'location' },
  { dtoGetter: (j) => j.employmentType,    columnName: 'jobType' },
  { dtoGetter: (j) => j.experienceLevel,   columnName: 'experienceLevel' },
  { dtoGetter: (j) => j.salaryMin,         columnName: 'salaryMin' },
  { dtoGetter: (j) => j.salaryMax,         columnName: 'salaryMax' },
  { dtoGetter: (j) => j.sourceUrl,         columnName: 'sourceUrl' },
  { dtoGetter: (j) => j.skills,            columnName: 'skillsRequired' },
  { dtoGetter: (j) => j.responsibilities,  columnName: 'details.responsibilities' },
  { dtoGetter: (j) => j.requirements,      columnName: 'details.requirements' },
  { dtoGetter: (j) => j.qualifications,    columnName: 'details.qualifications' },
  { dtoGetter: (j) => j.benefits,          columnName: 'details.benefits' },
];

function detectMissingFields(job) {
  if (!job) return [];
  const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  return REFRESHABLE_FIELD_MAP
    .filter(({ dtoGetter }) => isEmpty(dtoGetter(job)))
    .map(({ columnName }) => columnName);
}

/**
 * Refresh a tracked job by feeding the current page HTML back through the
 * AI extractor to backfill null/empty fields. Driven by the row's rescan
 * icon — only shown on the active/matched row, so the current page is
 * guaranteed to correspond to this job.
 */
async function handleRefreshJob(jobId) {
  const ok = await requireAuth();
  if (!ok) return;

  const job = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
  if (!job) return;

  const missingFields = detectMissingFields(job);
  if (missingFields.length === 0) {
    showQuickStatus('This job already has all its info — nothing to refresh.', 'info');
    return;
  }

  const rescanBtn = document.querySelector(
    `.tracked-job-row[data-job-id="${jobId}"] .row-rescan`,
  );
  const originalHtml = rescanBtn?.innerHTML;
  if (rescanBtn) {
    rescanBtn.disabled = true;
    rescanBtn.classList.add('is-loading');
  }

  showQuickStatus('Scanning page for missing job info…', 'info');

  try {
    // Refresh needs the FULL page, not the focused pane that
    // captureJobContext() prefers — when a page has a JSON-LD
    // JobPosting, the focused pane is just the <script> block with
    // only the fields embedded in that JSON-LD (no salary, no jobType,
    // no structured responsibilities/requirements). The full document
    // gives the backend's AI extractor the entire posting body to
    // parse sections out of.
    const page = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getHTML' }, (response) => {
        resolve(response?.html ? response : null);
      });
    });
    if (!page?.html) throw new Error('Could not read the current page.');

    const jwtToken = await getJwtToken();
    const resp = await fetch(buildJobUrl(jobId, 'refresh'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        html: page.html,
        url: page.originUrl || currentJobUrl || '',
        missingFields,
      }),
    });
    if (resp.status === 401) return handleTokenExpired();
    if (await check429(resp, 'quickStatus')) return;
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Refresh failed.');
    }

    const data = unwrapResponse(await resp.json());
    if (!data?.updated) {
      showQuickStatus('Page scanned — nothing new to save.', 'info');
      return;
    }

    // Merge the updated row back into trackedJobsList and re-render.
    const idx = trackedJobsList.findIndex((j) => (j.id || j.Id) === jobId);
    if (idx >= 0) {
      trackedJobsList[idx] = { ...trackedJobsList[idx], ...data };
      renderTrackedJobsTable();
    }

    const count = Array.isArray(data.updatedFields) ? data.updatedFields.length : 0;
    showQuickStatus(
      count > 0 ? `Updated ${count} field${count === 1 ? '' : 's'}.` : 'Job refreshed.',
      'success',
    );
  } catch (err) {
    console.error('[hired.video] handleRefreshJob failed:', err);
    showQuickStatus(err?.message || 'Could not refresh this job.', 'error');
  } finally {
    if (rescanBtn) {
      rescanBtn.disabled = false;
      rescanBtn.classList.remove('is-loading');
      if (originalHtml !== undefined) rescanBtn.innerHTML = originalHtml;
    }
  }
}

// ---- Untrack a row (deletes only the savedJobs association) ---------
async function rowDeleteTrackedJob(jobId) {
  const ok = await requireAuth();
  if (!ok) return;
  const job = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
  const label = job?.title || 'this job';
  if (!confirm(`Stop tracking "${label}"? The job stays on hired.video — you just won't see it in your tracker.`)) {
    return;
  }
  const jwtToken = await getJwtToken();
  try {
    const response = await fetch(buildJobUrl(jobId, 'save'), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) throw new Error('Could not stop tracking this job.');
    // Drop local caches for this job and refresh.
    clearJobCaches(jobId);
    trackedJobsList = trackedJobsList.filter((j) => (j.id || j.Id) !== jobId);
    renderTrackedJobsTable();
    showQuickStatus('Removed from your tracker.', 'success');
  } catch (err) {
    showQuickStatus(err.message || 'Could not remove this job.', 'error');
  }
}

/**
 * Delete just the tailored variation for a tracked job — the job itself
 * stays in the tracker, the cached score stays, but the generated resume
 * variation is removed. Next tailor run will produce a fresh variation.
 */
async function rowDeleteTailoredVariation(jobId) {
  const ok = await requireAuth();
  if (!ok) return;
  const cached = jobTailorings[jobId];
  if (!cached?.variationId) {
    showQuickStatus('No tailored resume found for this job.', 'info');
    return;
  }

  const name = cached.variationName || 'this tailored variation';
  if (!confirm(`Delete "${name}"?\n\nThe job stays tracked — only the AI-generated variation is removed. You can tailor again anytime.`)) {
    return;
  }

  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  try {
    const response = await fetch(`${resumeBase}/${cached.variationId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Failed to delete variation');
    }

    // Drop ONLY the tailoring cache — keep the score so "#1 82%" still
    // reads from the last analyze. Re-render the row so the "Tailored"
    // button reverts to "Tailor" and the tailored-resume sub-row is gone.
    delete jobTailorings[jobId];
    chrome.storage.local.set({ [JOB_TAILORINGS_KEY]: jobTailorings });
    renderTrackedJobsTable();

    // Also sync the master resume list in case this variation was
    // currently selected or surfaced elsewhere.
    loadMasterResumeGroups();

    showQuickStatus(`Deleted "${name}".`, 'success');
  } catch (err) {
    console.error('[hired.video] rowDeleteTailoredVariation failed:', err);
    showQuickStatus(err.message || 'Could not delete this variation.', 'error');
  }
}

// ---- Download the variation that was tailored for this job ---------
async function rowDownloadTailoredVariation(jobId) {
  const ok = await requireAuth();
  if (!ok) return;
  const cached = jobTailorings[jobId];
  if (!cached) return rowDownloadResume(jobId);
  const format = isPremium ? settings.downloadFormat || 'pdf' : 'pdf';
  await handleDownload(format, cached.variationId);
}

async function rowScoreJob(jobId) {
  const ok = await requireAuth();
  if (!ok) return;
  if (!selectedResume) {
    showQuickStatus('Upload or select a resume first.', 'warning');
    switchTab('resume');
    showResumeSelection();
    return;
  }
  // Use the tailored variation if one exists for this job, otherwise the master
  const cachedTailorForScore = jobTailorings[jobId];
  const resumeIdForScore = cachedTailorForScore?.variationId || selectedResume.id;
  const scoreResumeName = cachedTailorForScore?.variationName || selectedResume.name || selectedResume.title || 'Resume';
  const restoreRow = showRowLoading(jobId, 'Scoring…');
  const jwtToken = await getJwtToken();
  try {
    const resp = await fetch(matchAnalyze, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({ jobId, resumeId: resumeIdForScore }),
    });
    if (resp.status === 401) return handleTokenExpired();
    if (await check429(resp, 'quickStatus')) { restoreRow(); return; }
    if (!resp.ok) throw new Error('Score failed');
    const data = await resp.json();
    const result = unwrapResponse(data);
    const score = result.score ?? 0;
    const recommendations = result.summaryRecommendations || '';
    saveJobScore(jobId, score, recommendations, scoreResumeName);
    renderTrackedJobsTable();
    // Auto-expand the inline score detail panel for this job
    toggleInlineScore(jobId);
  } catch (err) {
    restoreRow();
    showQuickStatus(err.message || 'Score failed.', 'error');
  }
}

async function rowTailorJob(jobId) {
  const ok = await requireAuth();
  if (!ok) return;
  if (!selectedResume) {
    showQuickStatus('Upload or select a resume first.', 'warning');
    switchTab('resume');
    showResumeSelection();
    return;
  }

  // ==== Cache short-circuit ====
  // If we've already tailored this job, don't burn AI tokens again.
  // Surface the cached variation as a downloadable result instead.
  const cached = jobTailorings[jobId];
  if (cached) {
    showQuickStatus(
      `✅ Already tailored — click ⤓ Tailored Resume to download${cached.score != null ? ` (score ${formatScore(cached.score)})` : ''}.`,
      'success',
    );
    return;
  }

  const job = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
  if (!job) return;
  trackedJob = buildTrackedJobObj(job);
  pipelineBusy = true;
  const restoreRow = showRowLoading(jobId, 'Tailoring resume…');
  try {
    const result = await tailorAndSaveVariation({
      jobId,
      selectedResume,
      trackedJob,
      sourceUrl: job.sourceUrl,
    });
    generatedResumeData = result.tailored;
    generatedVariationId = result.variationId;
    renderTrackedJobsTable();

    showQuickStatus(
      `✅ Tailored variation saved (new score ${formatScore(result.tailored.newScore || result.tailored.score || 0)}).`,
      'success',
    );
    loadMasterResumeGroups();
  } catch (err) {
    showQuickStatus(err.message || 'Tailor failed.', 'error');
  } finally {
    pipelineBusy = false;
    restoreRow();
  }
}

/**
 * Re-tailor action (triggered by the rotate-ccw icon on the tailored
 * resume sub-row). Unlike `rowTailorJob`, which short-circuits when a
 * cached variation already exists and surfaces an "already tailored"
 * banner toast, this path ALWAYS runs the full pipeline — the user
 * explicitly asked for a fresh tailor. Inline loading spinner appears
 * on the row itself via `showRowLoading`, so status stays in context.
 */
async function rowRetailorJob(jobId) {
  // Drop the cached tailoring so rowTailorJob's short-circuit doesn't
  // trigger. Keep jobScores intact so the #1 score pill survives — only
  // the variation is being regenerated.
  if (jobTailorings[jobId]) {
    delete jobTailorings[jobId];
    chrome.storage.local.set({ [JOB_TAILORINGS_KEY]: jobTailorings });
    renderTrackedJobsTable();
  }
  return rowTailorJob(jobId);
}

async function rowDownloadResume(jobId) {
  const ok = await requireAuth();
  if (!ok) return;

  const format = isPremium ? settings.downloadFormat || 'pdf' : 'pdf';

  // Prefer the variation that was tailored for THIS job. We don't have a
  // jobId column on resumes, so we match heuristically:
  //   1. If the most-recently-saved variation in this session matches
  //      this row, use generatedVariationId.
  //   2. Otherwise scan resumeGroups for a variation whose name or
  //      description references this job's title or sourceUrl.
  //   3. Otherwise fall back to the currently-selected resume.
  const job = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
  let resumeIdToDownload = null;

  if (
    generatedVariationId &&
    trackedJob &&
    trackedJob.id === jobId
  ) {
    resumeIdToDownload = generatedVariationId;
  } else if (job) {
    const titleNeedle = (job.title || '').toLowerCase();
    const urlNeedle = (job.sourceUrl || '').toLowerCase();
    outer: for (const group of resumeGroups) {
      for (const v of group.variations || []) {
        const haystack = `${v.name || ''} ${v.description || ''}`.toLowerCase();
        if (
          (titleNeedle && haystack.includes(titleNeedle)) ||
          (urlNeedle && haystack.includes(urlNeedle))
        ) {
          resumeIdToDownload = v.id;
          break outer;
        }
      }
    }
  }

  if (!resumeIdToDownload) {
    if (!selectedResume) {
      showQuickStatus(
        'No tailored variation found for this job yet. Click ✨ Tailor first, then Download.',
        'warning',
      );
      return;
    }
    resumeIdToDownload = selectedResume.id;
  }

  await handleDownload(format, resumeIdToDownload);
}

/**
 * Reset all page-specific state when the user navigates away or
 * switches tabs. Centralised so every call site stays in sync.
 */
function resetPageState() {
  currentJobHtml = null;
  currentJobUrl = null;
  currentJobOriginalHtml = null;
  trackedJob = null;
  generatedVariationId = null;
  detectedPageJob = null;
  hideElement('currentJobDisplay');
  hideElement('activePageBanner');
  showElement('noJobBanner');
  hideElement('quickStatus');
  clearPreviousResults();
}

/**
 * Listen for URL changes from the content script — clear stale state
 * when the user navigates to a new page (handles SPA navigation too).
 */
function setupUrlChangeListener() {
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.action === 'urlChanged') {
      consoleAlerts('URL changed to: ' + message.url);
      resetPageState();
      // Check immediately whether the new URL matches a tracked job's
      // applyUrl. Application pages (Workday, Greenhouse forms) rarely
      // carry a JobPosting schema, so the content script's detectJob
      // won't fire — but we already know what job this is.
      const applyMatch = findMatchingTrackedJob(message.url);
      if (applyMatch?.matchedBy === 'applyUrl') {
        showApplyPageBanner(applyMatch.job);
      }
    }
    if (message.action === 'tabActivated') {
      resetPageState();
      requestActiveTabDetection();
    }
    if (message.action === 'jobDetected') {
      // Content script saw a JSON-LD JobPosting (or matched selector)
      // on the active tab. Surface the active-page banner if the
      // user has auto-detect enabled.
      if (settings.autoDetect !== false) {
        handleJobDetected(message.payload || message);
      }
    }
    return true;
  });
}

/**
 * Listen for auth state changes pushed by the service worker (i.e.
 * the auth bridge picked up a JWT from hired.video).
 */
function setupAuthSyncListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'authStateChanged') {
      // Re-bootstrap to pick up the new token (or absence of one).
      // initializeApp re-runs loadCurrentUser + loadTokenBudget, which
      // together refresh the upgrade CTA, locked toggles, and body class.
      initializeApp();
    }
    return false;
  });
}

function clearPreviousResults() {
  const evalRecommendations = document.getElementById('evalRecommendations');
  if (evalRecommendations) evalRecommendations.innerHTML = '';

  const evalScore = document.getElementById('evalScore');
  if (evalScore) evalScore.textContent = '';

  generatedResumeData = null;
  generatedVariationId = null;

  hideElement('evalScoreSection');
  hideElement('evalRecommendations');
  hideElement('score');
  hideElement('resumeActions');
  hideElement('disclaimer');

  const markAppliedBtn = document.getElementById('markAppliedButton');
  if (markAppliedBtn) markAppliedBtn.disabled = true;
}

/**
 * Initialize the application.
 *
 * The whole UI is always rendered. Auth state only controls:
 *   - whether we show the "Sign in" banner or the profile chip
 *   - whether actions actually run, or trigger the login flow first
 *
 * Friction-free token handling: as long as the JWT decodes, we treat
 * the user as signed in. If it's already expired we ask the service
 * worker to try a refresh before falling back to signed-out state —
 * so the only time the user sees the sign-in banner is on first
 * install or after the full 7-day refresh window has lapsed.
 */
function initializeApp() {
  // Always wire listeners — they don't depend on auth state.
  setupEventListeners();

  // Reset so the first resume-list load of this session re-applies the
  // "open Resume tab if no master exists" rule.
  hasAppliedDefaultTab = false;

  chrome.storage.local.get([jwtTokenKey, selectedResumeKey, trackedJobKey], async (data) => {
    if (!data.jwtToken) {
      showSignedOutState();
      return;
    }

    let decoded;
    try {
      decoded = jwt_decode(data.jwtToken);
    } catch (e) {
      console.error('Error decoding token:', e);
      showSignedOutState();
      return;
    }

    const currentTime = Math.floor(Date.now() / 1000);
    if (decoded.exp && decoded.exp < currentTime) {
      // Try a silent refresh before falling back to signed-out.
      const refreshed = await requestSilentRefresh();
      if (!refreshed) {
        showSignedOutState();
        return;
      }
      // Re-enter init now that storage holds a fresh token.
      initializeApp();
      return;
    }

    // Token valid — render signed-in UI
    showSignedInState();

    if (data[selectedResumeKey]) selectedResume = data[selectedResumeKey];
    if (data[trackedJobKey]) {
      trackedJob = data[trackedJobKey];
      renderTrackedJob();
    }

    loadSettings();
    loadJobCaches();
    loadMasterResumeGroups();
    loadTrackedJobsTable();
    loadCurrentUser();
    loadTokenBudget();
  });
}

/** Render the panel as signed-out: show banner, hide profile chip,
 * show "—" stats, show empty-state hint, no API calls. */
function showSignedOutState() {
  showElement('signedOutBanner');
  hideElement('profileCard');
  hideElement('headerUpgradeButton');
  clearTokenBudget();
  showElement('resumeListEmptyHint');
  hideElement('resumeSelectionContainer');
  hideElement('selectedResumeDisplay');
  hideElement('activePageBanner');
  showElement('noJobBanner');

  trackedJobsList = [];
  renderTrackedJobsTable();
  setPremium(false);

  const stripName = document.getElementById('resumeStripName');
  if (stripName) {
    stripName.textContent = '—';
    stripName.setAttribute('href', '#');
  }

  const badge = document.getElementById('trackedJobsCountBadge');
  if (badge) {
    badge.textContent = '0';
    badge.classList.add('hidden');
  }

  // Clear any leftover signed-in UI state. Without this the previously-
  // tracked job, eval scores, generated resume preview, and profile name
  // all stay visible after signOut / token expiry — leaking the prior
  // session into the signed-out state.
  trackedJob = null;
  generatedResumeData = null;
  generatedVariationId = null;
  currentJobHtml = null;
  currentJobUrl = null;
  currentJobOriginalHtml = null;

  hideElement('currentJobDisplay');
  hideElement('trackJobError');
  hideElement('trackJobLoading');
  document.getElementById('currentJobTitle').textContent = '';
  document.getElementById('currentJobMeta').textContent = '';
  const link = document.getElementById('currentJobLink');
  link.textContent = '';
  link.href = '#';

  clearPreviousResults();

  // Reset the profile chip placeholders so a future sign-in doesn't
  // momentarily flash the previous user's name/email.
  const nameEl = document.getElementById('profileName');
  const emailEl = document.getElementById('profileEmail');
  if (nameEl) nameEl.textContent = 'Signed in';
  if (emailEl) emailEl.textContent = '';

  setupLoginButton();
}

function showSignedInState() {
  hideElement('signedOutBanner');
  showElement('profileCard');
  hideElement('resumeListEmptyHint');
  // The header upgrade button is controlled by the `premium-unlocked`
  // body class (CSS hides it when premium). For signed-in free users
  // we show it explicitly.
  if (!isPremium) showElement('headerUpgradeButton');
}

/**
 * Auth gate. Wrap any action that requires a valid JWT.
 * If the user isn't signed in, navigates to login.html and returns
 * false so the caller can short-circuit.
 */
async function requireAuth() {
  const token = await getJwtToken();
  if (token) return true;

  // Surface the banner and bounce to the sign-in page.
  showSignedOutState();
  window.location.href = chrome.runtime.getURL('login.html');
  return false;
}

/**
 * Higher-order helper: wraps a click handler so it auto-prompts the
 * user to sign in before the underlying action runs.
 */
function gate(handler) {
  return async (event) => {
    const ok = await requireAuth();
    if (!ok) return;
    return handler(event);
  };
}

/**
 * Ask the service worker to refresh the JWT immediately.
 * Resolves true on success.
 */
function requestSilentRefresh() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'refreshTokenNow' }, (response) => {
      if (chrome.runtime.lastError) return resolve(false);
      resolve(!!response?.ok);
    });
  });
}

function handleTokenExpired() {
  chrome.storage.local.remove([jwtTokenKey, selectedResumeKey, trackedJobKey], () => {
    selectedResume = null;
    trackedJob = null;
    resumeGroups = [];
    showSignedOutState();
  });
}

function setupLoginButton() {
  // Re-run the idempotent wiring in case the buttons appeared
  // after the initial DOMContentLoaded pass (e.g. if state-toggle
  // unhid them).
  wireLoginButtons();
}

/**
 * Wire up event listeners. Idempotent — safe to call multiple times
 * because we use direct property assignment, not addEventListener.
 */
function setupEventListeners() {
  const bind = (id, handler, evt = 'click') => {
    const el = document.getElementById(id);
    if (el) el['on' + evt] = handler;
  };

  // ---- Tab strip ----
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.onclick = () => switchTab(btn.dataset.tab);
  });

  // ---- Jobs tab: active page banner & no-job state ----
  bind('quickTrackButton', gate(handleTrackJob));
  bind('quickApplyButton', gate(handleApplyToTrackedJob));
  bind('quickAutofillButton', gate(handleAutofillApplication));
  bind('manualScanButton', gate(handleManualScan));
  bind('rescanButton', gate(handleManualScan));
  // The refresh button lives INSIDE the Jobs tab button — stop event
  // propagation so clicking it doesn't also trigger the tab switch
  // handler (we're almost always already on the Jobs tab). Also wire
  // keyboard activation since the element uses role="button", not an
  // actual <button> (nested <button>s are invalid HTML).
  const refreshJobsEl = document.getElementById('refreshJobsButton');
  if (refreshJobsEl) {
    const triggerRefresh = (e) => {
      e.stopPropagation();
      e.preventDefault();
      gate(loadTrackedJobsTable)();
    };
    refreshJobsEl.addEventListener('click', triggerRefresh);
    refreshJobsEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') triggerRefresh(e);
    });
  }
  bind('openWizardButton', () => {
    settings.wizardMode = true;
    saveSettings();
    applySettingsToUI();
  });
  bind('exitWizardButton', () => {
    settings.wizardMode = false;
    saveSettings();
    applySettingsToUI();
  });

  // ---- Settings tab: toggles ----
  const wireSetting = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.onchange = () => {
      // Premium-gated toggle: snap back if user isn't premium.
      if (el.closest('.settings-toggle-locked') && !isPremium) {
        el.checked = false;
        openUpgradePage();
        return;
      }
      settings[key] = el.checked;
      saveSettings();
      if (key === 'wizardMode') applyWizardMode();
    };
  };
  wireSetting('settingAutoDetect', 'autoDetect');
  wireSetting('settingAutoScore', 'autoScore');
  wireSetting('settingAutoTailor', 'autoTailor');
  wireSetting('settingWizardMode', 'wizardMode');

  const fmt = document.getElementById('settingDownloadFormat');
  if (fmt) {
    fmt.onchange = () => {
      if (!isPremium) {
        fmt.value = 'pdf';
        openUpgradePage();
        return;
      }
      settings.downloadFormat = fmt.value;
      saveSettings();
    };
    fmt.onclick = () => {
      if (!isPremium) openUpgradePage();
    };
  }

  bind('upgradeButton', openUpgradePage);
  bind('headerUpgradeButton', openUpgradePage);

  const webSettingsLink = document.getElementById('openWebSettingsLink');
  if (webSettingsLink) {
    webSettingsLink.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: buildWebUrl('/settings') });
    };
  }

  // ---- Resume manager (Resume tab) ----
  bind('refreshResumesButton', gate(() => {
    console.log('[hired.video] refreshResumesButton clicked');
    return loadMasterResumeGroups();
  }));
  // Shared handler: both edit pencils — the one in the profile card's
  // Active Resume row AND the one in the Resume tab's Resume Manager
  // header — toggle the resume manager into edit mode (revealing Set
  // Active / Set Master / Delete / per-row edit-pencil actions). When
  // triggered from the profile card we also switch to the Resume tab so
  // the user sees the state change.
  const toggleResumeManagerEditMode = () => {
    switchTab('resume');
    const card = document.getElementById('resumeManagerCard');
    const toggleBtn = document.getElementById('resumeManagerEditToggle');
    if (!card) return;
    const enabled = card.classList.toggle('resume-manager-edit-mode');

    // Expand the full resume list when entering edit mode so the user
    // can see the rows they're about to Set Active / Set Master /
    // Delete. Collapse back to the compact "Selected: X" display when
    // exiting — hiding the destructive-actions list keeps the default
    // read-only view tidy.
    if (enabled) {
      showResumeSelection();
    } else {
      hideElement('resumeSelectionContainer');
      showElement('selectedResumeDisplay');
    }

    if (toggleBtn) {
      toggleBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
      toggleBtn.setAttribute(
        'title',
        enabled
          ? 'Done editing — hide Set Active, Set Master, and Delete actions'
          : 'Edit — show Set Active, Set Master, Delete and other destructive actions',
      );
    }
    // Mirror the pressed state onto the profile-card pencil too so
    // both buttons read the same state regardless of which tab the
    // user is on when they click.
    const profileBtn = document.getElementById('changeResumeButton');
    if (profileBtn) {
      profileBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }
  };
  bind('resumeManagerEditToggle', toggleResumeManagerEditMode);
  bind('changeResumeButton', toggleResumeManagerEditMode);

  const openActiveResume = (e) => {
    if (e) e.preventDefault();
    if (selectedResume?.id) {
      chrome.tabs.create({ url: buildWebUrl('/resumes/' + selectedResume.id) });
    } else {
      showQuickStatus('Upload or select a resume first.', 'warning');
      switchTab('resume');
      showResumeSelection();
    }
  };
  bind('openResumeButton', openActiveResume);
  // Resume name in the profile card is a hyperlink — route its click
  // through chrome.tabs.create() so it opens in a real browser tab
  // instead of trying to replace the side panel.
  bind('resumeStripName', openActiveResume);
  bind('uploadResumeButton', gate(() => {
    console.log('[hired.video] uploadResumeButton clicked');
    document.getElementById('uploadResumeInput').click();
  }));
  bind('uploadResumeInput', handleResumeUpload, 'change');
  bind('signOutButton', handleSignOut);

  // Login buttons (header + signed-out banner) — wired here so they work
  // even before initializeApp finishes deciding which auth state we're in.
  setupLoginButton();

  const profileLink = document.getElementById('openProfileLink');
  if (profileLink) {
    profileLink.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: buildWebUrl('/profile') });
    };
  }

  bind('trackJobButton', gate(handleTrackJob));
  bind('scoreEvaluateButton', gate(handleScoreEvaluate));
  bind('trackGenerateButton', gate(handleTailorGenerate));
  bind('saveVariationButton', gate(handleSaveVariation));
  bind('markAppliedButton', gate(handleMarkApplied));

  bind('downloadPdfButton', gate(() => handleDownload('pdf')));
  bind('downloadDocxButton', gate(() => handleDownload('docx')));

  bind('closeModalButton', hideModal);
  bind('cancelModalButton', hideModal);
  bind('confirmSaveButton', handleModalSave);

  // Dedup modal
  bind('closeDedupModal', hideDedupModal);
  bind('dedupUseExisting', handleDedupUseExisting);
  bind('dedupTrackNew', handleDedupTrackNew);

  const dashboardLink = document.getElementById('openJobsDashboard');
  if (dashboardLink) {
    dashboardLink.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: buildWebUrl('/jobs') });
    };
  }
}

// =====================================================================
// Current user / profile chip
// =====================================================================

async function loadCurrentUser() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  try {
    const response = await fetch(meUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${jwtToken}` },
    });
    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) return;

    const data = await response.json();
    const user = unwrapResponse(data);
    if (!user) return;

    const nameEl = document.getElementById('profileName');
    const emailEl = document.getElementById('profileEmail');
    const roleEl = document.getElementById('profileRole');
    if (nameEl) nameEl.textContent = user.name || user.email || 'Signed in';
    if (emailEl) emailEl.textContent = user.email || '';

    // Role badge
    if (roleEl && user.role) {
      const role = (user.role || '').toString();
      roleEl.textContent = role;
      roleEl.classList.remove('hidden', 'role-premium', 'role-admin', 'role-superadmin');
      const lower = role.toLowerCase();
      if (lower === 'premium' || lower === 'pro') roleEl.classList.add('role-premium');
      else if (lower === 'superadmin') roleEl.classList.add('role-superadmin');
      else if (lower === 'admin') roleEl.classList.add('role-admin');
    }

    // Derive premium entitlement from role. Billing tier is reconciled later
    // by renderTokenBudget() using the authoritative /api/billing/token-budget.
    if (isPremiumRole(user.role)) setPremium(true);
  } catch (err) {
    console.error('loadCurrentUser failed:', err);
  }
}

/**
 * Quick check: if the fetch response is a 429 (usage-limit), parse
 * the body and render the upgrade CTA into `targetId`. Returns true
 * when handled (so the caller can early-return), false otherwise.
 *
 * Usage:  `if (await check429(resp, 'quickStatus')) return;`
 */
// check429 + handleUsageLimitResponse moved to shared/utils.js

async function handleSignOut() {
  const jwtToken = await getJwtToken();
  // Best-effort server-side logout — backend is stateless so this is
  // primarily for audit logs.
  if (jwtToken) {
    fetch(`${apiBase}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwtToken}` },
    }).catch(() => {});
  }
  handleTokenExpired();
}

// =====================================================================
// Resume management
// =====================================================================

async function loadMasterResumeGroups() {
  console.log('[hired.video] loadMasterResumeGroups called');
  const jwtToken = await getJwtToken();
  if (!jwtToken) {
    console.log('[hired.video] loadMasterResumeGroups — no JWT, skipping');
    return;
  }

  showElement('resumeLoadingContainer');
  hideElement('resumeSelectionContainer');
  hideElement('selectedResumeDisplay');

  try {
    const response = await fetch(masterResumeGroups, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) throw new Error('Failed to load resumes');

    const data = await response.json();
    consoleAlerts('Resume groups loaded: ' + JSON.stringify(data));

    if (data.success && data.data) {
      resumeGroups = data.data;
    } else if (Array.isArray(data)) {
      resumeGroups = data;
    } else {
      resumeGroups = [];
    }

    renderResumeSelection();

    // Determine which resume should be active:
    // 1. Prefer the server's isActive flag
    // 2. Fall back to locally selected resume (if still exists)
    // 3. Fall back to ensureActiveResume() which auto-activates master
    const allResumes = resumeGroups.flatMap(g => [g.masterResume, ...(g.variations || [])]);
    const serverActive = allResumes.find(r => r.isActive);
    if (serverActive) {
      selectResume(serverActive);
    } else if (selectedResume) {
      const found = findResumeById(selectedResume.id);
      if (found) selectResume(found);
      else ensureActiveResume();
    } else {
      ensureActiveResume();
    }

    // First load of the session: if the user has no master resume
    // (new user onboarding), drop them on the Resume tab so uploading
    // one is the obvious next step. Otherwise stay on the default Jobs
    // tab. Skipped on subsequent refreshes via `hasAppliedDefaultTab`
    // so we don't yank the user mid-flow.
    if (!hasAppliedDefaultTab) {
      hasAppliedDefaultTab = true;
      const hasMaster = allResumes.some((r) => r && r.isMaster);
      if (!hasMaster) switchTab('resume');
    }
  } catch (error) {
    console.error('Error loading resumes:', error);
    showError('resumeSelectionContainer', 'Failed to load resumes. Please try again.');
  } finally {
    hideElement('resumeLoadingContainer');
  }
}

function findResumeById(id) {
  for (const group of resumeGroups) {
    if (group.masterResume.id === id) return group.masterResume;
    for (const variation of (group.variations || [])) {
      if (variation.id === id) return variation;
    }
  }
  return null;
}

function renderResumeSelection() {
  const container = document.getElementById('resumeSelectionContainer');
  console.log('[hired.video] renderResumeSelection — groups:', resumeGroups.length);

  if (resumeGroups.length === 0) {
    container.innerHTML = `
      <div class="alert alert-info">
        <p>No resumes found yet. Click <strong>Upload PDF/Word</strong> below to add your first one — it will automatically become your master resume.</p>
      </div>
    `;
    showElement('resumeSelectionContainer');
    return;
  }

  // Build a flat list of all resumes for rendering
  const allResumes = [];
  for (const group of resumeGroups) {
    allResumes.push(group.masterResume);
    for (const v of (group.variations || [])) allResumes.push(v);
  }

  let html = '';
  for (const r of allResumes) {
    const isActive = selectedResume?.id === r.id;
    const isMaster = !!r.isMaster;
    const isVariation = !!r.parentId;
    const name = escapeHtml(r.name || r.title || 'Untitled Resume');
    const date = formatDate(r.creationDateTime || r.createdAt);

    // Badges
    const badges = [];
    if (isMaster) badges.push('<span class="badge badge-master">Master</span>');
    if (isVariation) badges.push('<span class="badge badge-variation">Variation</span>');
    if (isActive) badges.push('<span class="badge badge-active">Active</span>');

    // Action buttons — use data-* attributes instead of inline onclick
    // (MV3 CSP blocks inline event handlers)
    const actions = [];
    actions.push(`<button class="icon-btn" data-resume-action="open" data-resume-id="${r.id}" title="View resume">${ICON.externalLink}</button>`);
    actions.push(`<button class="icon-btn" data-resume-action="edit" data-resume-id="${r.id}" title="Edit resume">${ICON.edit}</button>`);
    if (!isActive) {
      actions.push(`<button class="btn-link" data-resume-action="set-active" data-resume-id="${r.id}">Set Active</button>`);
    }
    if (!isMaster) {
      actions.push(`<button class="btn-link" data-resume-action="set-master" data-resume-id="${r.id}">Set Master</button>`);
    }
    actions.push(`<button class="icon-btn row-delete" data-resume-action="delete" data-resume-id="${r.id}" title="Delete resume">${ICON.trash}</button>`);

    const cardClass = `resume-card ${isVariation ? 'variation' : 'master'} ${isActive ? 'selected' : ''}`;

    html += `
      <div class="${cardClass}" data-resume-action="set-active" data-resume-id="${r.id}">
        <div class="d-flex align-items-center justify-between">
          <div>
            <div class="resume-card-title">${name}</div>
            <div class="resume-card-meta">${date}</div>
          </div>
          <div class="d-flex align-items-center gap-2">
            ${badges.join('')}
            ${actions.join('')}
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Wire event listeners via addEventListener (MV3-safe)
  container.querySelectorAll('[data-resume-action]').forEach((el) => {
    el.addEventListener('click', onResumeAction);
  });

  showElement('resumeSelectionContainer');
}

/**
 * Delegated handler for resume card actions. Dispatches based on
 * the data-resume-action attribute. Replaces inline onclick handlers
 * which MV3 CSP blocks.
 */
function onResumeAction(event) {
  event.stopPropagation();
  const el = event.currentTarget;
  const action = el.dataset.resumeAction;
  const id = el.dataset.resumeId;
  if (!id) return;
  console.log('[hired.video] onResumeAction:', action, id);

  switch (action) {
    case 'open':
    case 'edit':
      // Both open and edit go to the resume detail page on hired.video —
      // the detail page IS the editor. Keeping both actions so the UI
      // can distinguish visually (eye icon vs pencil icon) while sharing
      // the destination.
      return openResumeInTab(id);
    case 'set-active':
      return setActiveResume(id);
    case 'set-master':
      return promoteToMaster(id);
    case 'delete':
      return deleteResume(id);
  }
}

async function deleteResume(id) {
  console.log('[hired.video] deleteResume:', id);
  const resume = findResumeById(id);
  if (!resume) {
    console.warn('[hired.video] deleteResume — resume not found:', id);
    return;
  }

  const name = resume.name || resume.title || 'this resume';
  const variationCount = resume.isMaster
    ? (resumeGroups.find(g => g.masterResume?.id === id)?.variations?.length || 0)
    : 0;
  const msg = variationCount > 0
    ? `Delete master resume "${name}"?\n\nIts ${variationCount} variation${variationCount === 1 ? '' : 's'} will be kept but unlinked from a master. This cannot be undone.`
    : `Delete "${name}"?\n\nThis cannot be undone.`;

  if (!window.confirm(msg)) return;

  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  try {
    const response = await fetch(`${resumeBase}/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Failed to delete resume');
    }

    if (selectedResume?.id === id) {
      selectedResume = null;
      chrome.storage.local.remove(selectedResumeKey);
    }

    showQuickStatus(`Deleted "${name}".`, 'success');
    await loadMasterResumeGroups();
  } catch (err) {
    console.error('[hired.video] deleteResume failed:', err);
    showQuickStatus(err.message || 'Could not delete this resume.', 'error');
  }
}

function openResumeInTab(id) {
  console.log('[hired.video] openResumeInTab:', id);
  chrome.tabs.create({ url: buildWebUrl('/resumes/' + id) });
}

/** Set a resume (any — master or variation) as the active resume used for scoring/tailoring. */
async function setActiveResume(id) {
  console.log('[hired.video] setActiveResume:', id);
  const resume = findResumeById(id);
  if (!resume) {
    console.warn('[hired.video] setActiveResume — resume not found:', id);
    return;
  }
  selectResume(resume);
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;
  try {
    await fetch(buildResumeUrl(id, 'setactive'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
  } catch (err) {
    console.warn('[hired.video] setactive failed:', err);
  }
  renderResumeSelection();
}

async function promoteToMaster(id) {
  console.log('[hired.video] promoteToMaster:', id);
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  try {
    const response = await fetch(buildResumeUrl(id, 'setmaster'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Failed to set as master');
    }
    await loadMasterResumeGroups();
  } catch (err) {
    console.error('[hired.video] promoteToMaster failed:', err);
    showQuickStatus(err.message || 'Could not set this resume as master.', 'error');
  }
}

function selectResume(resume) {
  console.log('[hired.video] selectResume:', resume?.id, resume?.name || resume?.title);
  selectedResume = resume;
  chrome.storage.local.set({ [selectedResumeKey]: resume });

  const displayName = resume.name || resume.title || 'Untitled Resume';
  document.getElementById('selectedResumeName').textContent = displayName;

  // Mirror the selection into the compact strip inside the profile card.
  // The name is now a hyperlink that opens the resume on hired.video in a
  // new tab — same target as the adjacent View icon.
  const strip = document.getElementById('resumeStripName');
  if (strip) {
    const badgeText = resume.isMaster ? ' (Master)' : '';
    strip.textContent = displayName + badgeText;
    if (resume.id) strip.href = buildWebUrl('/resumes/' + resume.id);
  }

  const badge = document.getElementById('selectedResumeBadge');
  if (resume.isMaster) {
    badge.textContent = 'Master';
    badge.className = 'badge badge-master';
  } else {
    badge.textContent = 'Variation';
    badge.className = 'badge badge-variation';
  }

  document.querySelectorAll('.resume-card').forEach(card => {
    card.classList.remove('selected');
    if (card.dataset.resumeId === resume.id) card.classList.add('selected');
  });

  hideElement('resumeSelectionContainer');
  showElement('selectedResumeDisplay');
  resetResults();
}

function showResumeSelection() {
  hideElement('selectedResumeDisplay');
  showElement('resumeSelectionContainer');
}

function resetResults() {
  generatedResumeData = null;
  generatedVariationId = null;

  hideElement('evalScoreSection');
  hideElement('evalRecommendations');
  hideElement('score');
  hideElement('recommendations');
  hideElement('resumeActions');
  hideElement('disclaimer');

  document.getElementById('custom').innerHTML = '<p class="text-center text-muted"><em>Your AI-generated tailored resume will appear here</em></p>';
  document.getElementById('evalRecommendations').innerHTML = '';
  document.getElementById('recommendations').innerHTML = '';

  document.getElementById('trackGenerateButton').disabled = true;
  const markAppliedBtn = document.getElementById('markAppliedButton');
  if (markAppliedBtn) markAppliedBtn.disabled = true;
}

/**
 * Upload a resume file (PDF/Word/text) → POST /api/resumes/createfromtext.
 *
 * The extension extracts text client-side (handling binary PDF/DOCX
 * formats) and sends clean UTF-8 text via JSON to the dedicated
 * createfromtext endpoint. This avoids the binary-parsing issues that
 * break the older createfromfile endpoint with PDFs.
 */
async function handleResumeUpload(event) {
  const file = event.target.files && event.target.files[0];
  console.log('[hired.video] handleResumeUpload:', file?.name || 'no file', file?.type);
  if (!file) return;

  let jwtToken = await getJwtToken();
  if (!jwtToken) return;

  const status = document.getElementById('uploadResumeStatus');
  status.className = 'alert alert-info';
  status.textContent = `Reading ${file.name}…`;
  status.classList.remove('hidden');

  try {
    // Extract clean text client-side — binary formats (PDF, DOCX) need
    // special handling; raw file.text() on a PDF produces garbage.
    const text = await extractTextFromUpload(file);
    if (!text || text.trim().length < 20) {
      throw new Error('Could not extract text from this file. Try a .txt or .md file, or paste your resume on hired.video.');
    }

    const title = file.name.replace(/\.[^.]+$/, '');
    status.textContent = `Uploading ${file.name}…`;

    let response = await fetch(resumeCreateFromTextUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({ title, text }),
    });

    // If 401, try a silent token refresh and retry once
    if (response.status === 401) {
      console.warn('[hired.video] upload got 401, attempting token refresh…');
      const refreshed = await requestSilentRefresh();
      if (!refreshed) return handleTokenExpired();
      jwtToken = await getJwtToken();
      if (!jwtToken) return handleTokenExpired();
      response = await fetch(resumeCreateFromTextUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`,
        },
        body: JSON.stringify({ title, text }),
      });
      if (response.status === 401) return handleTokenExpired();
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Upload failed');
    }

    status.className = 'alert alert-success';
    status.textContent = `✅ ${file.name} uploaded`;

    // Reset the file input so re-uploading the same file works.
    event.target.value = '';

    // Refresh the resume list to surface the new resume.
    await loadMasterResumeGroups();
  } catch (err) {
    console.error('[hired.video] resume upload failed:', err);
    status.className = 'alert alert-error';
    status.textContent = err.message || 'Upload failed. Please try again.';
  }
}

/**
 * Extract plain text from an uploaded resume file.
 * Handles PDF (basic extraction), DOCX (XML parsing), and text formats.
 */
async function extractTextFromUpload(file) {
  const name = file.name.toLowerCase();

  // Plain text / markdown — read directly
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown') ||
      file.type === 'text/plain' || file.type === 'text/markdown') {
    return file.text();
  }

  // DOCX — unzip and extract text from word/document.xml
  if (name.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    try {
      // Use the browser's built-in DecompressionStream to read the zip
      // Without a zip library, fall back to sending raw and hoping the
      // server handles it. But first try the simple approach.
      const text = await file.text();
      // If it looks like valid text (not binary garbage), use it
      if (text && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 500))) {
        return text;
      }
    } catch (e) { /* fall through */ }
  }

  // PDF — extract text from the binary content
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      // Simple PDF text extraction: find text between BT/ET operators
      // and parenthesised strings. This is a best-effort parser that
      // handles the most common PDF text encodings.
      const text = extractTextFromPdfBytes(bytes);
      if (text && text.trim().length > 20) return text;
    } catch (e) {
      console.warn('[hired.video] PDF text extraction failed:', e);
    }
  }

  // JSON resume
  if (name.endsWith('.json')) {
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      return jsonResumeToText(parsed);
    } catch (e) {
      return file.text();
    }
  }

  // Last resort: try reading as text
  try {
    const text = await file.text();
    if (text && !/[\x00-\x08\x0E-\x1F]/.test(text.slice(0, 500))) {
      return text;
    }
  } catch (e) { /* binary file */ }

  return '';
}

/**
 * Best-effort PDF text extraction without a library.
 * Scans the raw PDF bytes for text streams and extracts readable strings.
 */
function extractTextFromPdfBytes(bytes) {
  // Decode the raw bytes as latin1 (preserves all byte values)
  let raw = '';
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i]);

  const lines = [];

  // Strategy 1: Extract parenthesised strings between BT...ET blocks
  // PDF text operators: (string) Tj, [(array)] TJ
  const btEtRegex = /BT\b([\s\S]*?)ET\b/g;
  let btMatch;
  while ((btMatch = btEtRegex.exec(raw)) !== null) {
    const block = btMatch[1];
    // Extract (parenthesised) strings
    const strRegex = /\(([^)]*)\)/g;
    let strMatch;
    let blockText = '';
    while ((strMatch = strRegex.exec(block)) !== null) {
      // Unescape PDF string escapes
      const s = strMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\')
        .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
      blockText += s;
    }
    if (blockText.trim()) lines.push(blockText.trim());
  }

  // Strategy 2: If BT/ET extraction yielded nothing, scan for long
  // runs of printable ASCII — common in text-heavy PDFs.
  if (lines.length === 0) {
    const printableRuns = raw.match(/[\x20-\x7E]{10,}/g) || [];
    for (const run of printableRuns) {
      // Skip PDF structural keywords
      if (/^(endobj|endstream|xref|trailer|startxref|stream)$/i.test(run.trim())) continue;
      if (/^[\d\s.]+$/.test(run)) continue; // skip number-only runs
      lines.push(run.trim());
    }
  }

  const result = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return result;
}

/**
 * Convert a JSON Resume object to readable plain text.
 */
function jsonResumeToText(obj) {
  if (typeof obj !== 'object' || !obj) return String(obj);
  const lines = [];
  const basics = obj.basics;
  if (basics) {
    if (basics.name) lines.push(basics.name);
    if (basics.label) lines.push(basics.label);
    if (basics.email) lines.push('Email: ' + basics.email);
    if (basics.summary) lines.push('\nSummary\n' + basics.summary);
  }
  const work = obj.work;
  if (Array.isArray(work) && work.length) {
    lines.push('\nExperience');
    for (const job of work) {
      const title = [job.position, job.name || job.company].filter(Boolean).join(' at ');
      const dates = [job.startDate, job.endDate || 'Present'].filter(Boolean).join(' – ');
      lines.push(title + '  (' + dates + ')');
      if (job.summary) lines.push(job.summary);
    }
  }
  const education = obj.education;
  if (Array.isArray(education) && education.length) {
    lines.push('\nEducation');
    for (const edu of education) {
      const deg = [edu.studyType, edu.area].filter(Boolean).join(' in ');
      lines.push(deg + ' — ' + (edu.institution || '') + ' (' + (edu.startDate || '') + ' – ' + (edu.endDate || '') + ')');
    }
  }
  const skills = obj.skills;
  if (Array.isArray(skills) && skills.length) {
    lines.push('\nSkills');
    for (const s of skills) {
      const kw = Array.isArray(s.keywords) ? s.keywords.join(', ') : '';
      lines.push((s.name || '') + (kw ? ': ' + kw : ''));
    }
  }
  return lines.join('\n');
}

// =====================================================================
// Job tracking
// =====================================================================

/**
 * Render the currently-tracked job in the side panel.
 */
function renderTrackedJob() {
  if (!trackedJob) {
    hideElement('currentJobDisplay');
    return;
  }
  document.getElementById('currentJobTitle').textContent = trackedJob.title || 'Untitled job';
  const meta = [trackedJob.company, trackedJob.location].filter(Boolean).join(' • ');
  document.getElementById('currentJobMeta').textContent = meta;

  const link = document.getElementById('currentJobLink');
  link.textContent = trackedJob.sourceUrl || '';
  link.href = trackedJob.sourceUrl || '#';

  showElement('currentJobDisplay');
}

/**
 * Track this Job — extracts the current page via AI and saves it as
 * a hired.video Job entity. Stores the resulting jobId so the user
 * can later mark a resume as "applied" against it.
 */
async function handleTrackJob() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  hideElement('trackJobError');
  showElement('trackJobLoading');
  document.getElementById('trackJobButton').disabled = true;

  try {
    const jobCtx = await captureJobContext();
    if (!jobCtx) throw new Error('Could not read the current page. Please make sure you are on a job posting.');
    const jobPaneHtml = jobCtx.html;
    currentJobOriginalHtml = jobCtx.html;
    currentJobUrl = detectedPageJob?.sourceUrl || jobCtx.originUrl || currentJobUrl;

    const response = await fetch(jobsExtractUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        url: currentJobUrl,
        sourceUrl: currentJobUrl,
        html: jobPaneHtml,
      }),
    });

    if (response.status === 401) return handleTokenExpired();

    // 422 = page didn't classify as a job posting. Surface the AI's
    // reason as a soft warning rather than a hard error so the user
    // knows to navigate to the actual job.
    if (response.status === 422) {
      const errorData = await response.json().catch(() => ({}));
      const reason =
        errorData.error?.message ||
        "This page doesn't look like a job posting. Open the actual job listing and try again.";
      const errEl = document.getElementById('trackJobError');
      errEl.className = 'alert alert-warning mt-2';
      errEl.textContent = '⚠️ ' + reason;
      showElement('trackJobError');
      return;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Job extraction failed');
    }

    const data = await response.json();
    consoleAlerts('Job extracted: ' + JSON.stringify(data));
    const job = unwrapResponse(data);

    trackedJob = buildTrackedJobObj(job, {
      sourceUrl: currentJobUrl,
      applyUrl: detectedPageJob?.applyUrl || currentJobUrl,
    });
    chrome.storage.local.set({ [trackedJobKey]: trackedJob });

    renderTrackedJob();
    loadTrackedJobsTable();
  } catch (err) {
    console.error('Track job failed:', err);
    const errEl = document.getElementById('trackJobError');
    errEl.className = 'alert alert-error mt-2';
    errEl.textContent = err.message || 'Could not track this job. Please try again.';
    showElement('trackJobError');
  } finally {
    hideElement('trackJobLoading');
    document.getElementById('trackJobButton').disabled = false;
  }
}

// =====================================================================
// Score & evaluate
// =====================================================================

/**
 * Score & Evaluate — fetches page HTML if we don't already have it
 * (e.g. when the user skips Track this Job and goes straight to
 * scoring), then calls /api/match/analyze.
 */
async function handleScoreEvaluate() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  if (!selectedResume) {
    showQuickStatus('Upload or select a resume first.', 'warning');
    switchTab('resume');
    showResumeSelection();
    return;
  }

  if (!currentJobHtml) {
    const ok = await capturePageHtmlLegacy();
    if (!ok) {
      showError('evalRecommendations', 'Could not read page content. Please make sure you are on a job posting page.');
      showElement('evalRecommendations');
      return;
    }
  }

  const analyzeRequest = {
    jobHtml: currentJobHtml,
    resumeId: selectedResume.id,
    jobId: trackedJob?.id,
  };

  document.getElementById('scoreEvaluateButton').disabled = true;
  showElement('evalLoading');
  hideElement('evalScoreSection');
  hideElement('evalRecommendations');

  try {
    const response = await fetch(matchAnalyze, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(analyzeRequest),
    });

    if (response.status === 401) return handleTokenExpired();
    if (await check429(response, 'evalRecommendations')) { showElement('evalRecommendations'); return; }
    if (response.status === 404) return handleApiNotFound('evalRecommendations');
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Analysis failed');
    }

    const data = await response.json();
    consoleAlerts('Analysis result: ' + JSON.stringify(data));

    if (data.errorMessage) {
      showError('evalRecommendations', data.errorMessage);
      showElement('evalRecommendations');
      return;
    }

    const result = unwrapResponse(data);
    const score = result.score || result.oldScore || 0;
    document.getElementById('evalScore').textContent = formatScore(score);
    applyScoreStyle('evalScore', score);
    showElement('evalScoreSection');

    if (result.summaryRecommendations) {
      const converter = new showdown.Converter();
      document.getElementById('evalRecommendations').innerHTML = converter.makeHtml(result.summaryRecommendations);
      showElement('evalRecommendations');
    }

    document.getElementById('trackGenerateButton').disabled = false;

    // Reset Step 3 results
    document.getElementById('custom').innerHTML = '<p class="text-center text-muted"><em>Your AI-generated tailored resume will appear here</em></p>';
    hideElement('score');
    hideElement('recommendations');
    hideElement('resumeActions');
  } catch (error) {
    console.error('Error analyzing job:', error);
    showError('evalRecommendations', 'Failed to analyze job posting. Please try again.');
    showElement('evalRecommendations');
  } finally {
    hideElement('evalLoading');
    document.getElementById('scoreEvaluateButton').disabled = false;
  }
}

// capturePageHtml + requestFocusedPaneHtml replaced by
// captureJobContext() in shared/utils.js.
//
// Legacy wrapper that also sets the module-level state vars (used by
// the wizard's handleScoreEvaluate / handleTailorGenerate which need
// currentJobHtml/currentJobUrl).
async function capturePageHtmlLegacy() {
  const ctx = await captureJobContext();
  if (!ctx) return false;
  currentJobOriginalHtml = ctx.html;
  currentJobUrl = ctx.originUrl;
  currentJobHtml = typeof jobDescriptionParser === 'function'
    ? jobDescriptionParser(ctx.html, ctx.originUrl)
    : ctx.html;
  return true;
}

// =====================================================================
// Tailor & generate
// =====================================================================

async function handleTailorGenerate() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  if (!selectedResume) {
    showQuickStatus('Upload or select a resume first.', 'warning');
    switchTab('resume');
    showResumeSelection();
    return;
  }

  if (!currentJobHtml) {
    const ok = await capturePageHtmlLegacy();
    if (!ok) {
      showError('custom', 'Could not read page content.');
      return;
    }
  }

  const tailorRequest = {
    jobHtml: currentJobHtml,
    resumeId: selectedResume.id,
    jobId: trackedJob?.id,
  };

  document.getElementById('trackGenerateButton').disabled = true;
  document.getElementById('scoreEvaluateButton').disabled = true;
  showElement('loading');
  hideElement('score');
  hideElement('resumeActions');
  document.getElementById('custom').innerHTML = '<p class="text-center text-muted"><em>Generating tailored resume...</em></p>';

  try {
    const response = await fetch(matchTailor, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(tailorRequest),
    });

    if (response.status === 401) return handleTokenExpired();
    if (await check429(response, 'custom')) return;
    if (response.status === 404) return handleApiNotFound('custom');
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Generation failed');
    }

    const data = await response.json();
    consoleAlerts('Generate result: ' + JSON.stringify(data));

    if (data.errorMessage) {
      showError('custom', data.errorMessage);
      return;
    }

    const result = unwrapResponse(data);
    generatedResumeData = result;

    if (result.markdownResume) {
      const converter = new showdown.Converter();
      document.getElementById('custom').innerHTML = converter.makeHtml(result.markdownResume);
      document.getElementById('custom').classList.add('success');
    }

    const newScore = result.newScore || result.score || 0;
    document.getElementById('newScore').textContent = formatScore(newScore);
    applyScoreStyle('newScore', newScore);
    showElement('score');

    if (result.summaryRecommendations) {
      const converter = new showdown.Converter();
      document.getElementById('recommendations').innerHTML = converter.makeHtml(result.summaryRecommendations);
      showElement('recommendations');
    }

    showElement('resumeActions');
    showElement('disclaimer');

    document.getElementById('variationName').value = generateVariationName();
    hideElement('saveVariationSuccess');
    hideElement('saveVariationError');
    document.getElementById('markAppliedButton').disabled = true;
  } catch (error) {
    console.error('Error generating resume:', error);
    showError('custom', 'Failed to generate tailored resume. Please try again.');
  } finally {
    hideElement('loading');
    document.getElementById('trackGenerateButton').disabled = false;
    document.getElementById('scoreEvaluateButton').disabled = false;
  }
}

function generateVariationName() {
  const company = trackedJob?.company;
  const title = trackedJob?.title;
  if (title && company) return `${title} - ${company}`;
  if (title) return title;

  if (!currentJobUrl) return 'Job Application ' + new Date().toLocaleDateString();
  try {
    const url = new URL(currentJobUrl);
    const hostname = url.hostname.replace('www.', '').split('.')[0];
    return `${capitalizeFirst(hostname)} - ${new Date().toLocaleDateString()}`;
  } catch {
    return 'Job Application ' + new Date().toLocaleDateString();
  }
}

// =====================================================================
// Save as Variation
// =====================================================================

async function handleSaveVariation() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  if (!generatedResumeData) {
    showError('saveVariationError', 'No generated resume to save');
    showElement('saveVariationError');
    return;
  }

  const variationName = document.getElementById('variationName').value.trim();
  if (!variationName) {
    showError('saveVariationError', 'Please enter a name for this variation');
    showElement('saveVariationError');
    return;
  }

  const masterId = getMasterResumeId(selectedResume);

  document.getElementById('saveVariationButton').disabled = true;
  showElement('saveVariationLoading');
  hideElement('saveVariationError');
  hideElement('saveVariationSuccess');

  try {
    generatedVariationId = await saveAsVariation(masterId, {
      name: variationName,
      description: trackedJob
        ? `Generated for: ${trackedJob.title} at ${trackedJob.company || 'unknown company'}`
        : `Generated for: ${currentJobUrl || 'Job Application'}`,
      markdownResume: generatedResumeData.markdownResume,
      jobId: trackedJob?.id,
      sourceUrl: currentJobUrl,
    });

    showElement('saveVariationSuccess');
    if (trackedJob && generatedVariationId) {
      document.getElementById('markAppliedButton').disabled = false;
    }

    setTimeout(() => loadMasterResumeGroups(), 1500);
  } catch (error) {
    console.error('Error saving variation:', error);
    document.getElementById('saveVariationError').textContent = error.message || 'Failed to save variation. Please try again.';
    showElement('saveVariationError');
  } finally {
    hideElement('saveVariationLoading');
    document.getElementById('saveVariationButton').disabled = false;
  }
}

// =====================================================================
// Mark as Applied — link variation to tracked job
// =====================================================================

async function handleMarkApplied() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  if (!trackedJob || !trackedJob.id) {
    showStatus('markAppliedStatus', 'No tracked job. Click "Track this Job" first.', 'error');
    return;
  }

  const resumeId = generatedVariationId || selectedResume?.id;
  if (!resumeId) {
    showStatus('markAppliedStatus', 'Save the variation first, or select a resume.', 'error');
    return;
  }

  document.getElementById('markAppliedButton').disabled = true;
  showStatus('markAppliedStatus', 'Recording your application…', 'info');

  try {
    const response = await fetch(buildJobUrl(trackedJob.id, 'apply'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({ resumeId }),
    });

    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to record application');
    }

    showStatus('markAppliedStatus', '✅ Recorded! This resume is now linked to the job in your tracker.', 'success');
    loadTrackedJobsTable();
  } catch (err) {
    console.error('Mark applied failed:', err);
    showStatus('markAppliedStatus', err.message || 'Could not record your application. Please try again.', 'error');
    document.getElementById('markAppliedButton').disabled = false;
  }
}

function showStatus(id, message, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert alert-${kind}`;
  el.textContent = message;
  el.classList.remove('hidden');
}

// =====================================================================
// Resume download
// =====================================================================

async function handleDownload(format, overrideResumeId) {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  const resumeIdToDownload = overrideResumeId || generatedVariationId || selectedResume?.id;
  if (!resumeIdToDownload) {
    showError('downloadError', 'No resume selected');
    showElement('downloadError');
    return;
  }

  showElement('downloadLoading');
  hideElement('downloadError');

  try {
    const exportUrl = buildResumeUrl(resumeIdToDownload, 'export', `format=${format}`);
    const response = await fetch(exportUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${jwtToken}` },
    });

    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) throw new Error('Download failed');

    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      const downloadUrl = data.data?.exportUrl || data.exportUrl;
      if (downloadUrl) {
        chrome.tabs.create({ url: downloadUrl });
      } else {
        throw new Error('No download URL received');
      }
    } else {
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      // Prefer the filename from Content-Disposition (the backend sets the
      // correct extension when e.g. PDF isn't available and it falls back
      // to .txt or .md).
      const disposition = response.headers.get('content-disposition') || '';
      const filenameMatch = disposition.match(/filename="?([^";\n]+)"?/);
      a.download = filenameMatch
        ? filenameMatch[1]
        : `${selectedResume?.name || 'resume'}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }
  } catch (error) {
    console.error('Error downloading resume:', error);
    document.getElementById('downloadError').textContent = 'Download failed. Please try again.';
    showElement('downloadError');
  } finally {
    hideElement('downloadLoading');
  }
}

// =====================================================================
// Modal helpers
// =====================================================================

function showModal() {
  showElement('saveVariationModal');
  document.getElementById('modalVariationName').value = document.getElementById('variationName').value;
}

function hideModal() {
  hideElement('saveVariationModal');
}

function handleModalSave() {
  document.getElementById('variationName').value = document.getElementById('modalVariationName').value;
  hideModal();
  handleSaveVariation();
}

// =====================================================================
// Dedup modal — "Similar job already tracked" prompt
// =====================================================================

let dedupCallbackUseExisting = null;
let dedupCallbackTrackNew = null;
let dedupSelectedCandidate = null;

function showDedupModal(candidates, onUseExisting, onTrackNew) {
  const list = document.getElementById('dedupCandidatesList');
  if (!list) return;

  dedupCallbackUseExisting = onUseExisting;
  dedupCallbackTrackNew = onTrackNew;
  dedupSelectedCandidate = candidates[0] || null;

  list.innerHTML = candidates
    .map(
      (c, i) => `
    <div class="dedup-candidate ${i === 0 ? 'dedup-selected' : ''}" data-idx="${i}">
      <div class="dedup-candidate-title">${escapeHtml(c.title || 'Untitled job')}</div>
      <div class="dedup-candidate-meta">${escapeHtml([c.company, c.location].filter(Boolean).join(' • '))}</div>
    </div>
  `,
    )
    .join('');

  list.querySelectorAll('.dedup-candidate').forEach((el) => {
    el.addEventListener('click', () => {
      list.querySelectorAll('.dedup-candidate').forEach((e) => e.classList.remove('dedup-selected'));
      el.classList.add('dedup-selected');
      dedupSelectedCandidate = candidates[Number(el.dataset.idx)] || null;
    });
  });

  showElement('dedupModal');
}

function hideDedupModal() {
  hideElement('dedupModal');
  dedupCallbackUseExisting = null;
  dedupCallbackTrackNew = null;
  dedupSelectedCandidate = null;
}

function handleDedupUseExisting() {
  const cb = dedupCallbackUseExisting;
  const candidate = dedupSelectedCandidate;
  hideDedupModal();
  if (cb && candidate) cb(candidate);
}

function handleDedupTrackNew() {
  const cb = dedupCallbackTrackNew;
  hideDedupModal();
  if (cb) cb();
}

// =====================================================================
// Generic helpers
// =====================================================================

// Shared utilities (getJwtToken, showElement, hideElement, showError,
// formatScore, applyScoreStyle, formatDate, escapeHtml, capitalizeFirst,
// apiFetch) are loaded from utils.js — see sidepanel-global.html.

function handleApiNotFound(containerId) {
  const message = `
    <div class="alert alert-warning">
      <strong>⚠️ Update Required</strong><br>
      This feature requires a newer version of the hired.video extension.
      Please update your Chrome extension to the latest version.
      <br><br>
      <a href="https://chrome.google.com/webstore/detail/hiredvideo" target="_blank" class="btn btn-sm btn-outline">
        Update Extension
      </a>
    </div>
  `;
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = message;
    showElement(containerId);
  }

  hideElement('evalLoading');
  hideElement('loading');
  document.getElementById('scoreEvaluateButton').disabled = false;
  document.getElementById('trackGenerateButton').disabled = false;
}

// =====================================================================
// Job Pipeline — status transitions
// =====================================================================

/**
 * Replace the status pill with an inline <select> dropdown.
 * On selection, call the API, update local state, and revert to the pill.
 */
function showStatusDropdown(jobId) {
  const wrapper = document.getElementById('statusPill-' + jobId);
  if (!wrapper) return;

  const job = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
  const current = job?.pipelineStatus || 'tracked';

  const allStatuses = [
    { value: 'tracked',      label: 'Tracked' },
    { value: 'applied',      label: 'Applied' },
    { value: 'interviewing', label: 'Interviewing' },
    { value: 'offered',      label: 'Offered' },
    { value: 'accepted',     label: 'Accepted' },
    { value: 'rejected',     label: 'Rejected' },
    { value: 'cancelled',    label: 'Cancelled' },
    { value: 'withdrawn',    label: 'Withdrawn' },
    { value: 'declined',     label: 'Declined' },
  ];

  const options = allStatuses.map((s) =>
    `<option value="${s.value}" ${s.value === current ? 'selected' : ''}>${s.label}</option>`
  ).join('');

  wrapper.innerHTML = `<select class="status-dropdown" id="statusSelect-${jobId}">${options}</select>`;

  const select = document.getElementById('statusSelect-' + jobId);
  if (!select) return;

  select.focus();

  const commit = async () => {
    const newStatus = select.value;
    if (newStatus === current) {
      // No change — revert to pill
      renderTrackedJobsTable();
      return;
    }
    await handleStatusChange(jobId, newStatus);
  };

  select.addEventListener('change', commit);
  select.addEventListener('blur', () => {
    // Small delay so change event fires first if user picked an option
    setTimeout(() => {
      if (document.getElementById('statusSelect-' + jobId)) {
        renderTrackedJobsTable();
      }
    }, 100);
  });
}

/**
 * Update a tracked job's pipeline status via the API.
 */
async function handleStatusChange(jobId, newStatus) {
  const ok = await requireAuth();
  if (!ok) return;

  try {
    const resp = await apiFetch(buildJobUrl(jobId, 'status'), {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    });
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      throw new Error(data.error?.message || 'Failed to update status');
    }
    // Update the local cache
    const job = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
    if (job) job.pipelineStatus = newStatus;
    renderTrackedJobsTable();
    showQuickStatus(`Status updated to ${newStatus}.`, 'success');
  } catch (err) {
    showQuickStatus(err.message || 'Failed to update status.', 'error');
  }
}

// =====================================================================
// Analytics tab
// =====================================================================

async function loadAnalytics() {
  showElement('analyticsLoading');
  try {
    const resp = await apiFetch(apiBase + PATHS.extensionAnalytics);
    if (!resp.ok) throw new Error('Failed to load analytics');
    const data = await resp.json();
    const analytics = unwrapResponse(data);
    renderAnalytics(analytics);
  } catch (err) {
    console.error('[hired.video] analytics load error:', err);
  } finally {
    hideElement('analyticsLoading');
  }
}

function renderAnalytics(data) {
  // This week snapshot
  const el = (id) => document.getElementById(id);

  if (el('statTracked')) el('statTracked').textContent = data.thisWeek?.tracked ?? '-';
  if (el('statApplied')) el('statApplied').textContent = data.thisWeek?.applied ?? '-';
  if (el('statStreak')) el('statStreak').textContent = data.thisWeek?.streak ? `🔥 ${data.thisWeek.streak}` : '0';

  // Deltas
  const renderDelta = (id, val) => {
    const d = el(id);
    if (!d) return;
    if (val > 0) { d.textContent = `↑ ${val}`; d.className = 'analytics-stat-delta delta-up'; }
    else if (val < 0) { d.textContent = `↓ ${Math.abs(val)}`; d.className = 'analytics-stat-delta delta-down'; }
    else { d.textContent = '—'; d.className = 'analytics-stat-delta'; }
  };
  renderDelta('statTrackedDelta', data.thisWeek?.trackedDelta ?? 0);
  renderDelta('statAppliedDelta', data.thisWeek?.appliedDelta ?? 0);

  // Funnel bars
  const funnelContainer = el('funnelBars');
  if (funnelContainer && data.funnel) {
    const stages = [
      { key: 'tracked', label: 'Tracked', color: 'var(--foreground-secondary)' },
      { key: 'applied', label: 'Applied', color: 'var(--brand-blue)' },
      { key: 'interviewing', label: 'Interviewing', color: 'var(--primary)' },
      { key: 'offered', label: 'Offered', color: 'var(--warning)' },
      { key: 'accepted', label: 'Accepted', color: 'var(--success)' },
      { key: 'rejected', label: 'Rejected', color: 'var(--error)' },
    ];
    const maxCount = Math.max(1, ...stages.map((s) => data.funnel[s.key] || 0));
    funnelContainer.innerHTML = stages.map((s) => {
      const count = data.funnel[s.key] || 0;
      const pct = Math.round((count / maxCount) * 100);
      return `
        <div class="funnel-row">
          <div class="funnel-label">${s.label}</div>
          <div class="funnel-bar-track">
            <div class="funnel-bar-fill" style="width: ${pct}%; background: ${s.color}"></div>
          </div>
          <div class="funnel-count">${count}</div>
        </div>
      `;
    }).join('');
  }

  // Conversion rates
  if (el('convApply')) el('convApply').textContent = `${data.conversion?.applyRate ?? 0}%`;
  if (el('convInterview')) el('convInterview').textContent = `${data.conversion?.interviewRate ?? 0}%`;
  if (el('convOffer')) el('convOffer').textContent = `${data.conversion?.offerRate ?? 0}%`;

  // Weekly trend
  const trendContainer = el('weeklyTrend');
  if (trendContainer && data.weeklyTrend) {
    const maxWeek = Math.max(1, ...data.weeklyTrend.map((w) => Math.max(w.tracked, w.applied)));
    trendContainer.innerHTML = data.weeklyTrend.map((w) => `
      <div class="trend-row">
        <div class="trend-label">${escapeHtml(w.week)}</div>
        <div class="trend-bars">
          <div class="trend-bar trend-bar-tracked" style="width: ${Math.round((w.tracked / maxWeek) * 100)}%" title="${w.tracked} tracked"></div>
          <div class="trend-bar trend-bar-applied" style="width: ${Math.round((w.applied / maxWeek) * 100)}%" title="${w.applied} applied"></div>
        </div>
        <div class="trend-count">${w.tracked}/${w.applied}</div>
      </div>
    `).join('') + '<div class="trend-legend"><span class="trend-dot trend-dot-tracked"></span>Tracked <span class="trend-dot trend-dot-applied"></span>Applied</div>';
  }

  // Response tracker
  if (el('statGhostRate')) el('statGhostRate').textContent = `${data.ghostRate ?? 0}%`;
  if (el('statTotalApplied')) el('statTotalApplied').textContent = data.totals?.applied ?? 0;
  if (el('statTotalOffers')) el('statTotalOffers').textContent = data.totals?.offers ?? 0;
}
