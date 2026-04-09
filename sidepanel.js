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
let trackedJob = null;             // { id, title, company, sourceUrl, ... }

// New for the two-tab redesign
let currentTab = 'now';
let isPremium = false;
let trackedJobsList = [];
let detectedPageJob = null; // { title, company, location, sourceUrl } from content script
let pipelineBusy = false;

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

async function loadPremiumState() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) {
    setPremium(false);
    return;
  }

  try {
    const response = await fetch(userProfileUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (!response.ok) {
      setPremium(false);
      return;
    }
    const data = await response.json();
    const profile = data?.data || data;
    setPremium(!!profile?.isPremium);
  } catch (err) {
    console.warn('[hired.video] loadPremiumState failed', err);
    setPremium(false);
  }
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
// Active page banner & job detection
// =====================================================================

function handleJobDetected(payload) {
  if (!payload || !payload.title) {
    detectedPageJob = null;
    showElement('noJobBanner');
    hideElement('activePageBanner');
    return;
  }
  detectedPageJob = payload;
  document.getElementById('activePageTitle').textContent = payload.title;
  const meta = [payload.company, payload.location].filter(Boolean).join(' • ');
  document.getElementById('activePageMeta').textContent = meta;
  hideElement('noJobBanner');
  showElement('activePageBanner');
  hideElement('quickStatus');

  if (settings.autoTailor && isPremium) {
    // Premium-only background tailoring.
    runTailorAndSavePipeline({ track: true, silent: true }).catch((err) =>
      console.warn('[hired.video] auto-tailor failed', err),
    );
  } else if (settings.autoScore) {
    // Score now so the badge appears in the row instantly when the user clicks Tailor.
    // (Implemented via the same fast pipeline but stopping after analyze.)
    runScoreOnlyPipeline().catch((err) => console.warn('[hired.video] auto-score failed', err));
  }
}

async function handleManualScan() {
  const ok = await requireAuth();
  if (!ok) return;
  await capturePageHtml();
  if (currentJobUrl) {
    handleJobDetected({
      title: 'Detected page',
      company: '',
      location: '',
      sourceUrl: currentJobUrl,
    });
    showQuickStatus('Page scanned — click Tailor & Save to continue.', 'info');
  }
}

function showQuickStatus(message, kind) {
  const el = document.getElementById('quickStatus');
  if (!el) return;
  el.className = `alert alert-${kind || 'info'} mt-2`;
  el.textContent = message;
  el.classList.remove('hidden');
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
    showQuickStatus('Select a resume in the Settings tab first.', 'error');
    return;
  }

  pipelineBusy = true;
  const track = options.track !== false;
  if (!options.silent) showQuickStatus('Extracting job from page…', 'info');

  try {
    // 1. Capture page HTML
    if (!currentJobHtml || !currentJobUrl) {
      const captured = await capturePageHtml();
      if (!captured) throw new Error('Could not read the current page.');
    }

    // 2. Extract via /api/jobs/extract (with or without tracking)
    if (!options.silent) showQuickStatus('Tracking job…', 'info');
    const jwtToken = await getJwtToken();
    const jobPaneHtml = extractJobPane(currentJobOriginalHtml || '', currentJobUrl);
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
      }),
    });

    if (extractResp.status === 401) return handleTokenExpired();
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
    const job = extractData?.data || extractData;
    trackedJob = {
      id: job.id,
      title: job.title || 'Untitled job',
      company: job.company || '',
      location: job.location || '',
      sourceUrl: currentJobUrl,
    };
    chrome.storage.local.set({ [trackedJobKey]: trackedJob });

    // 3. Tailor against the just-tracked job (rehydrates server-side via jobId)
    if (!options.silent) showQuickStatus('Tailoring resume…', 'info');
    const tailorResp = await fetch(matchTailor, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        jobId: job.id,
        resumeId: selectedResume.id,
        sourceUrl: currentJobUrl,
      }),
    });

    if (tailorResp.status === 401) return handleTokenExpired();
    if (!tailorResp.ok) throw new Error('Tailor failed');

    const tailorData = await tailorResp.json();
    const tailored = tailorData?.data || tailorData?.result || tailorData;
    generatedResumeData = tailored;

    // 4. Save as variation under the master
    if (!options.silent) showQuickStatus('Saving variation…', 'info');
    const masterId =
      selectedResume.isMaster || !selectedResume.parentId
        ? selectedResume.id
        : selectedResume.parentId;
    const variationName = `${trackedJob.title}${trackedJob.company ? ' - ' + trackedJob.company : ''}`;
    const saveResp = await fetch(buildResumeUrl(masterId, 'createvariation'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        name: variationName.slice(0, 200),
        description: `Generated for ${trackedJob.title}`,
        resumeData: tailored.markdownResume,
        jobId: job.id,
        sourceUrl: currentJobUrl,
      }),
    });

    if (saveResp.status === 401) return handleTokenExpired();
    if (!saveResp.ok) throw new Error('Save failed');

    const saveData = await saveResp.json();
    const saved = saveData?.data || saveData?.result || saveData;
    generatedVariationId = saved?.id || null;

    // 5. Refresh table + show success
    showQuickStatus(
      `✅ Tailored resume saved (new score ${formatScore(tailored.newScore || tailored.score || 0)}).`,
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
 * Auto-score variant — used by the autoScore setting. Runs extract +
 * analyze without producing a tailored resume.
 */
async function runScoreOnlyPipeline() {
  const jwtToken = await getJwtToken();
  if (!jwtToken || !selectedResume || pipelineBusy) return;

  if (!currentJobHtml || !currentJobUrl) {
    const captured = await capturePageHtml();
    if (!captured) return;
  }

  // Track the job (so we get a jobId), then analyze using rehydration.
  const jobPaneHtml = extractJobPane(currentJobOriginalHtml || '', currentJobUrl);
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
  const job = extractData?.data || extractData;
  trackedJob = { id: job.id, title: job.title, company: job.company, sourceUrl: currentJobUrl };

  await fetch(matchAnalyze, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwtToken}`,
    },
    body: JSON.stringify({ jobId: job.id, resumeId: selectedResume.id, sourceUrl: currentJobUrl }),
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

  badge.textContent = String(trackedJobsList.length);

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
    return `
      <div class="tracked-job-row" data-job-id="${id}">
        <div class="tracked-job-title">${title}</div>
        <div class="tracked-job-meta">${meta}</div>
        <div class="tracked-job-actions">
          <button class="btn btn-outline" data-action="score" data-job-id="${id}">🎯 Score</button>
          <button class="btn btn-primary" data-action="tailor" data-job-id="${id}">✨ Tailor</button>
          <button class="btn btn-outline" data-action="download" data-job-id="${id}">⤓ Download</button>
          <button class="btn btn-outline" data-action="open" data-job-id="${id}">↗ Open</button>
        </div>
      </div>
    `;
  });

  list.innerHTML = rows.join('');

  list.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', onTrackedJobAction);
  });
}

async function onTrackedJobAction(event) {
  const btn = event.currentTarget;
  const action = btn.dataset.action;
  const jobId = btn.dataset.jobId;
  if (!jobId) return;

  const job = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
  if (!job) return;

  switch (action) {
    case 'score':
      return rowScoreJob(jobId);
    case 'tailor':
      return rowTailorJob(jobId);
    case 'download':
      return rowDownloadResume(jobId);
    case 'open':
      chrome.tabs.create({ url: buildWebUrl(`/jobs/${jobId}`) });
      return;
  }
}

async function rowScoreJob(jobId) {
  const ok = await requireAuth();
  if (!ok || !selectedResume) {
    showQuickStatus('Select a resume in Settings first.', 'error');
    switchTab('settings');
    return;
  }
  const jwtToken = await getJwtToken();
  showQuickStatus('Scoring resume against job…', 'info');
  try {
    const resp = await fetch(matchAnalyze, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({ jobId, resumeId: selectedResume.id }),
    });
    if (resp.status === 401) return handleTokenExpired();
    if (!resp.ok) throw new Error('Score failed');
    const data = await resp.json();
    const result = data?.data || data;
    showQuickStatus(`Score: ${formatScore(result.score || 0)}`, 'success');
  } catch (err) {
    showQuickStatus(err.message || 'Score failed.', 'error');
  }
}

async function rowTailorJob(jobId) {
  const ok = await requireAuth();
  if (!ok || !selectedResume) {
    showQuickStatus('Select a resume in Settings first.', 'error');
    switchTab('settings');
    return;
  }
  const job = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
  if (!job) return;
  // Reuse the fast pipeline but skip the extract step by pre-seeding state.
  trackedJob = {
    id: jobId,
    title: job.title || 'Untitled job',
    company: job.company || '',
    location: job.location || '',
    sourceUrl: job.sourceUrl || '',
  };
  pipelineBusy = true;
  showQuickStatus('Tailoring resume…', 'info');
  try {
    const jwtToken = await getJwtToken();
    const tailorResp = await fetch(matchTailor, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        jobId,
        resumeId: selectedResume.id,
      }),
    });
    if (tailorResp.status === 401) return handleTokenExpired();
    if (!tailorResp.ok) throw new Error('Tailor failed');
    const tailorData = await tailorResp.json();
    const tailored = tailorData?.data || tailorData;
    generatedResumeData = tailored;

    const masterId =
      selectedResume.isMaster || !selectedResume.parentId
        ? selectedResume.id
        : selectedResume.parentId;
    const variationName = `${trackedJob.title}${trackedJob.company ? ' - ' + trackedJob.company : ''}`;
    const saveResp = await fetch(buildResumeUrl(masterId, 'createvariation'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        name: variationName.slice(0, 200),
        description: `Generated for ${trackedJob.title}`,
        resumeData: tailored.markdownResume,
        jobId,
        sourceUrl: job.sourceUrl,
      }),
    });
    if (saveResp.ok) {
      const saveData = await saveResp.json();
      generatedVariationId = (saveData?.data || saveData)?.id || null;
    }

    showQuickStatus(
      `✅ Tailored variation saved (new score ${formatScore(tailored.newScore || tailored.score || 0)}).`,
      'success',
    );
    loadMasterResumeGroups();
  } catch (err) {
    showQuickStatus(err.message || 'Tailor failed.', 'error');
  } finally {
    pipelineBusy = false;
  }
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

  // handleDownload reads generatedVariationId and selectedResume.id;
  // temporarily override generatedVariationId so the existing download
  // helper picks the row's variation without us having to fork it.
  const previous = generatedVariationId;
  generatedVariationId = resumeIdToDownload;
  try {
    await handleDownload(format);
  } finally {
    generatedVariationId = previous;
  }
}

/**
 * Listen for URL changes from the content script — clear stale state
 * when the user navigates to a new page (handles SPA navigation too).
 */
function setupUrlChangeListener() {
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.action === 'urlChanged') {
      consoleAlerts('URL changed to: ' + message.url);
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
    loadMasterResumeGroups();
    loadTrackedJobsTable();
    loadCurrentUser();
    loadPremiumState();
  });
}

/** Render the panel as signed-out: show banner, hide profile chip,
 * show "—" stats, show empty-state hint, no API calls. */
function showSignedOutState() {
  showElement('signedOutBanner');
  hideElement('profileCard');
  showElement('resumeListEmptyHint');
  hideElement('resumeSelectionContainer');
  hideElement('selectedResumeDisplay');
  hideElement('activePageBanner');
  showElement('noJobBanner');

  trackedJobsList = [];
  renderTrackedJobsTable();
  setPremium(false);

  const stripName = document.getElementById('resumeStripName');
  if (stripName) stripName.textContent = '—';

  const oldBadge = document.getElementById('trackedJobCount');
  if (oldBadge) oldBadge.textContent = '—';

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

  // ---- Now tab: active page banner & no-job state ----
  bind('quickTailorButton', gate(() => runTailorAndSavePipeline({ track: true })));
  bind('quickTrackButton', gate(handleTrackJob));
  bind('manualScanButton', gate(handleManualScan));
  bind('refreshJobsButton', gate(loadTrackedJobsTable));
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

  // ---- Resume manager (Settings tab) ----
  bind('refreshResumesButton', gate(loadMasterResumeGroups));
  bind('changeResumeButton', () => {
    switchTab('settings');
    showResumeSelection();
  });
  bind('uploadResumeButton', gate(() => document.getElementById('uploadResumeInput').click()));
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
    const user = data?.data || data;
    if (!user) return;

    const nameEl = document.getElementById('profileName');
    const emailEl = document.getElementById('profileEmail');
    if (nameEl) nameEl.textContent = user.name || user.email || 'Signed in';
    if (emailEl) emailEl.textContent = user.email || '';
  } catch (err) {
    console.error('loadCurrentUser failed:', err);
  }
}

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
  const jwtToken = await getJwtToken();
  if (!jwtToken) {
    // Silent no-op when called automatically (e.g. on init).
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

    if (!selectedResume && resumeGroups.length > 0) {
      selectResume(resumeGroups[0].masterResume);
    } else if (selectedResume) {
      const found = findResumeById(selectedResume.id);
      if (found) selectResume(found);
      else if (resumeGroups.length > 0) selectResume(resumeGroups[0].masterResume);
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

  if (resumeGroups.length === 0) {
    container.innerHTML = `
      <div class="alert alert-info">
        <p>No resumes found yet. Click <strong>Upload PDF/Word</strong> below to add your first one — it will automatically become your master resume.</p>
      </div>
    `;
    showElement('resumeSelectionContainer');
    return;
  }

  let html = '';
  for (const group of resumeGroups) {
    const master = group.masterResume;
    const variations = group.variations || [];

    html += `
      <div class="resume-group">
        <div class="resume-card master ${selectedResume?.id === master.id ? 'selected' : ''}"
             data-resume-id="${master.id}"
             data-is-master="true"
             onclick="selectResumeById('${master.id}')">
          <div class="d-flex align-items-center justify-between">
            <div>
              <div class="resume-card-title">${escapeHtml(master.name || master.title || 'Untitled Resume')}</div>
              <div class="resume-card-meta">${formatDate(master.creationDateTime || master.createdAt)}</div>
            </div>
            <span class="badge badge-master">Master</span>
          </div>
        </div>
        ${variations.map(v => `
          <div class="resume-card variation ${selectedResume?.id === v.id ? 'selected' : ''}"
               data-resume-id="${v.id}"
               data-is-master="false"
               onclick="selectResumeById('${v.id}')">
            <div class="d-flex align-items-center justify-between">
              <div>
                <div class="resume-card-title">${escapeHtml(v.name || v.title || 'Untitled Variation')}</div>
                <div class="resume-card-meta">${formatDate(v.creationDateTime || v.createdAt)}</div>
              </div>
              <div class="d-flex align-items-center gap-2">
                <span class="badge badge-variation">Variation</span>
                <button class="btn-link" onclick="event.stopPropagation(); promoteToMaster('${v.id}')">Set as Master</button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
  showElement('resumeSelectionContainer');
}

window.selectResumeById = function (id) {
  const resume = findResumeById(id);
  if (resume) selectResume(resume);
};

window.promoteToMaster = async function (id) {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  try {
    const url = buildResumeUrl(id, 'setmaster');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwtToken}` },
    });
    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) throw new Error('Failed to set as master');
    await loadMasterResumeGroups();
  } catch (err) {
    console.error('Failed to promote variation to master:', err);
    showError('resumeSelectionContainer', 'Could not set this resume as master. Please try again.');
  }
};

function selectResume(resume) {
  selectedResume = resume;
  chrome.storage.local.set({ [selectedResumeKey]: resume });

  const displayName = resume.name || resume.title || 'Untitled Resume';
  document.getElementById('selectedResumeName').textContent = displayName;

  // Mirror the selection into the compact "Now" tab strip.
  const strip = document.getElementById('resumeStripName');
  if (strip) {
    const badgeText = resume.isMaster ? ' (Master)' : '';
    strip.textContent = displayName + badgeText;
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
 * Upload a resume file (PDF/Word/text) → POST /api/resumes/createfromfile.
 * The backend will auto-mark the first resume as the master.
 */
async function handleResumeUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  const status = document.getElementById('uploadResumeStatus');
  status.className = 'alert alert-info';
  status.textContent = `Uploading ${file.name}…`;
  status.classList.remove('hidden');

  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', file.name.replace(/\.[^.]+$/, ''));

    const response = await fetch(resumeCreateFromFileUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${jwtToken}` },
      body: formData,
    });

    if (response.status === 401) return handleTokenExpired();
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
    console.error('Resume upload failed:', err);
    status.className = 'alert alert-error';
    status.textContent = err.message || 'Upload failed. Please try again.';
  }
}

// =====================================================================
// Job tracking
// =====================================================================

/**
 * Load the count of tracked jobs to display on the stats card.
 */
async function loadTrackedJobCount() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  try {
    const response = await fetch(jobsSavedUrl, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${jwtToken}` },
    });
    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) throw new Error('Failed to load tracked jobs');

    const data = await response.json();
    const items = data?.data?.items || data?.items || data?.data || data || [];
    const count = Array.isArray(items) ? items.length : (items.total || 0);
    document.getElementById('trackedJobCount').textContent = count;
  } catch (err) {
    console.error('Tracked job count fetch failed:', err);
    document.getElementById('trackedJobCount').textContent = '?';
  }
}

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
    const pageData = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getHTML' }, (response) => resolve(response));
    });

    if (!pageData || !pageData.html) {
      throw new Error('Could not read the current page. Please make sure you are on a job posting.');
    }

    currentJobOriginalHtml = pageData.html;
    currentJobUrl = pageData.originUrl;
    currentJobHtml = jobDescriptionParser(pageData.html, pageData.originUrl);
    // Wider container that includes the job title/meta — used as the
    // payload for /api/jobs/extract so the AI doesn't get confused
    // between the focused job and the surrounding job board.
    const jobPaneHtml = extractJobPane(pageData.html, pageData.originUrl);

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
    const job = data?.data || data?.result || data;

    trackedJob = {
      id: job.id,
      title: job.title || 'Untitled job',
      company: job.company || job.companyName || '',
      location: job.location || '',
      sourceUrl: currentJobUrl,
    };
    chrome.storage.local.set({ [trackedJobKey]: trackedJob });

    renderTrackedJob();
    loadTrackedJobCount(); // refresh stats card
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
    showError('evalRecommendations', 'Please select a resume first');
    showElement('evalRecommendations');
    return;
  }

  if (!currentJobHtml) {
    const ok = await capturePageHtml();
    if (!ok) {
      showError('evalRecommendations', 'Could not read page content. Please make sure you are on a job posting page.');
      showElement('evalRecommendations');
      return;
    }
  }

  const analyzeRequest = {
    jobHtml: currentJobHtml,
    resumeId: selectedResume.id,
    sourceUrl: currentJobUrl,
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

    const result = data.result || data.data || data;
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

/**
 * Capture the active tab's HTML into the module-level state vars.
 * Returns true on success.
 */
function capturePageHtml() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'getHTML' }, (response) => {
      if (!response || !response.html) {
        resolve(false);
        return;
      }
      currentJobOriginalHtml = response.html;
      currentJobUrl = response.originUrl;
      currentJobHtml = jobDescriptionParser(response.html, response.originUrl);
      resolve(true);
    });
  });
}

// =====================================================================
// Tailor & generate
// =====================================================================

async function handleTailorGenerate() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  if (!selectedResume) {
    showError('custom', 'Please select a resume first');
    return;
  }

  if (!currentJobHtml) {
    const ok = await capturePageHtml();
    if (!ok) {
      showError('custom', 'Could not read page content.');
      return;
    }
  }

  const tailorRequest = {
    jobHtml: currentJobHtml,
    resumeId: selectedResume.id,
    sourceUrl: currentJobUrl,
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

    const result = data.result || data.data || data;
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

  let masterResumeId = selectedResume.id;
  if (!selectedResume.isMaster && selectedResume.parentId) {
    masterResumeId = selectedResume.parentId;
  }

  document.getElementById('saveVariationButton').disabled = true;
  showElement('saveVariationLoading');
  hideElement('saveVariationError');
  hideElement('saveVariationSuccess');

  try {
    const createVariationUrl = buildResumeUrl(masterResumeId, 'createvariation');

    const response = await fetch(createVariationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        name: variationName,
        description: trackedJob
          ? `Generated for: ${trackedJob.title} at ${trackedJob.company || 'unknown company'}`
          : `Generated for: ${currentJobUrl || 'Job Application'}`,
        resumeData: generatedResumeData.markdownResume,
        jobId: trackedJob?.id,
        sourceUrl: currentJobUrl,
      }),
    });

    if (response.status === 401) return handleTokenExpired();
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to save variation');
    }

    const data = await response.json();
    consoleAlerts('Variation saved: ' + JSON.stringify(data));

    const saved = data?.data || data?.result || data;
    generatedVariationId = saved?.id || null;

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
    loadTrackedJobCount();
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

async function handleDownload(format) {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  const resumeIdToDownload = generatedVariationId || selectedResume?.id;
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
      a.download = `${selectedResume?.name || 'resume'}.${format}`;
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
// Generic helpers
// =====================================================================

async function getJwtToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(jwtTokenKey, (data) => resolve(data.jwtToken || null));
  });
}

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
