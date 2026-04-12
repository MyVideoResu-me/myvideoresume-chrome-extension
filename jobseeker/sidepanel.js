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
let currentTab = 'now';
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
      loadPremiumState();
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
 * Find a tracked job whose sourceUrl matches the given URL.
 * Returns the matched job object or null.
 */
function findMatchingTrackedJob(url) {
  if (!url || !trackedJobsList.length) return null;
  const norm = normalizeUrlForMatch(url);
  if (!norm) return null;
  return trackedJobsList.find((j) => {
    const jUrl = normalizeUrlForMatch(j.sourceUrl);
    return jUrl && jUrl === norm;
  }) || null;
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

  // Check if this job is already tracked — if so, wire up state and
  // swap the banner to "Already tracked" mode so the user doesn't
  // re-extract.
  const matched = findMatchingTrackedJob(payload.sourceUrl);

  document.getElementById('activePageTitle').textContent =
    matched?.title || payload.title;
  const meta = matched
    ? [matched.company, matched.location].filter(Boolean).join(' • ')
    : [payload.company, payload.location].filter(Boolean).join(' • ');
  document.getElementById('activePageMeta').textContent = meta;

  const eyebrow = document.querySelector('#activePageBanner .active-page-eyebrow');

  if (matched) {
    // Already tracked — set up trackedJob state so tailor/score flows
    // can use the existing jobId without re-extracting.
    trackedJob = {
      id: matched.id || matched.Id,
      title: matched.title,
      company: matched.company,
      sourceUrl: matched.sourceUrl,
      applyUrl: matched.applyUrl || matched.sourceUrl,
    };
    currentJobUrl = matched.sourceUrl;
    if (eyebrow) eyebrow.textContent = '✅ Already tracked';
    // Hide all banner action buttons — the tracked job card below
    // has Score, Tailor, Open, and the resume row already.
    hideElement('quickTailorButton');
    hideElement('quickTailorOnlyButton');
    hideElement('quickTrackButton');
    hideElement('quickScoreButton');
  } else {
    if (eyebrow) eyebrow.textContent = '📌 Job detected on this page';
    showElement('quickTailorButton');
    showElement('quickTailorOnlyButton');
    showElement('quickTrackButton');
    showElement('quickScoreButton');
  }

  hideElement('noJobBanner');
  showElement('activePageBanner');
  hideElement('quickStatus');
  highlightActiveTrackedJob(matched);

  if (!matched) {
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
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(response?.payload || null);
    });
  });

  const payload = detected || {
    title: 'Detected page',
    company: '',
    location: '',
    sourceUrl: currentJobUrl,
  };
  handleJobDetected(payload);

  // Only show the "click Tailor & Save" hint for new/untracked jobs
  if (!findMatchingTrackedJob(payload.sourceUrl)) {
    showQuickStatus('Page scanned — click Tailor & Save to continue.', 'info');
  }
}

/**
 * Ask the active tab's content script to re-run job detection and
 * surface the result in the banner. Used after tab switches.
 */
function requestActiveTabDetection() {
  if (settings.autoDetect === false) return;
  chrome.runtime.sendMessage({ action: 'detectJob' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.payload) {
      handleJobDetected(response.payload);
    }
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
  if (!ok || !selectedResume) {
    showQuickStatus('Select a resume in Settings first.', 'error');
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
      const result = data?.data || data;
      renderBannerScoreResult(result.score ?? 0, result.summaryRecommendations || '');
      return;
    }

    const extractData = await extractResp.json();
    const job = extractData?.data || extractData;
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
    const result = data?.data || data;
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
    const jobPayload = extractData?.data || extractData;

    // ---- Dedup: handle duplicate_candidates response ----
    if (jobPayload.duplicate_candidates && Array.isArray(jobPayload.duplicate_candidates)) {
      if (!options.silent) {
        pipelineBusy = false;
        showDedupModal(
          jobPayload.duplicate_candidates,
          // "Use existing" — bookmark the selected candidate and continue pipeline with it.
          (candidate) => {
            trackedJob = {
              id: candidate.id,
              title: candidate.title || 'Untitled job',
              company: candidate.company || '',
              location: candidate.location || '',
              sourceUrl: candidate.sourceUrl || currentJobUrl,
              applyUrl: candidate.sourceUrl || detectedPageJob?.applyUrl || currentJobUrl,
            };
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
    trackedJob = {
      id: job.id,
      title: job.title || 'Untitled job',
      company: job.company || '',
      location: job.location || '',
      sourceUrl: currentJobUrl,
      applyUrl: job.applyUrl || detectedPageJob?.applyUrl || currentJobUrl,
    };
    chrome.storage.local.set({ [trackedJobKey]: trackedJob });

    // 3. Tailor against the just-tracked job (rehydrates server-side via jobId)
    if (!options.silent) showQuickStatus('Tailoring resume…', 'info');
    const priorRec1 = jobScores[job.id]?.recommendations || '';
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
        ...(priorRec1 ? { priorRecommendations: priorRec1 } : {}),
      }),
    });

    if (tailorResp.status === 401) return handleTokenExpired();
    if (await check429(tailorResp, 'quickStatus')) return;
    if (!tailorResp.ok) throw new Error('Tailor failed');

    const tailorData = await tailorResp.json();
    const tailored = tailorData?.data || tailorData?.result || tailorData;
    generatedResumeData = tailored;

    // 4. Save as variation under the master (shared helper in utils.js)
    if (!options.silent) showQuickStatus('Saving variation…', 'info');
    const masterId = getMasterResumeId(selectedResume);
    const variationName = `${trackedJob.title}${trackedJob.company ? ' - ' + trackedJob.company : ''}`;
    generatedVariationId = await saveAsVariation(masterId, {
      name: variationName,
      description: `Generated for ${trackedJob.title}`,
      markdownResume: tailored.markdownResume,
      jobId: job.id,
      sourceUrl: currentJobUrl,
    });

    // Cache the result so a future click on this job in the tracker
    // returns the same variation without burning AI tokens again.
    if (generatedVariationId && job?.id) {
      const newScore = tailored.newScore ?? tailored.score ?? null;
      const masterName = selectedResume?.name || selectedResume?.title || 'Resume';
      saveJobTailoring(job.id, generatedVariationId, masterId, newScore, variationName, masterName);
      if (newScore != null) {
        saveJobScore(job.id, newScore, tailored.summaryRecommendations || '', variationName);
      }
    }

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
 * Continue the fast pipeline from Step 3 (tailor) onward, skipping
 * extract. Used when the dedup modal's "Use existing" button picks an
 * already-tracked job — we just need to tailor + save the variation.
 */
async function continuePipelineFromTailor(jwtToken, jobId, options = {}) {
  pipelineBusy = true;
  try {
    if (!options.silent) showQuickStatus('Tailoring resume…', 'info');
    const priorRec2 = jobScores[jobId]?.recommendations || '';
    const tailorResp = await fetch(matchTailor, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwtToken}` },
      body: JSON.stringify({
        jobId,
        resumeId: selectedResume.id,
        sourceUrl: currentJobUrl,
        ...(priorRec2 ? { priorRecommendations: priorRec2 } : {}),
      }),
    });
    if (tailorResp.status === 401) return handleTokenExpired();
    if (await check429(tailorResp, 'quickStatus')) return;
    if (!tailorResp.ok) throw new Error('Tailor failed');

    const tailorData = await tailorResp.json();
    const tailored = tailorData?.data || tailorData?.result || tailorData;
    generatedResumeData = tailored;

    if (!options.silent) showQuickStatus('Saving variation…', 'info');
    const masterId = getMasterResumeId(selectedResume);
    const variationName = `${trackedJob.title}${trackedJob.company ? ' - ' + trackedJob.company : ''}`;
    generatedVariationId = await saveAsVariation(masterId, {
      name: variationName,
      description: `Generated for ${trackedJob.title}`,
      markdownResume: tailored.markdownResume,
      jobId,
      sourceUrl: currentJobUrl,
    });
    if (generatedVariationId && jobId) {
      const newScore = tailored.newScore ?? tailored.score ?? null;
      const masterName2 = selectedResume?.name || selectedResume?.title || 'Resume';
      saveJobTailoring(jobId, generatedVariationId, masterId, newScore, variationName, masterName2);
      if (newScore != null) saveJobScore(jobId, newScore, tailored.summaryRecommendations || '', variationName);
    }

    showQuickStatus(
      `✅ Tailored resume saved (new score ${formatScore(tailored.newScore || tailored.score || 0)}).`,
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
  const job = extractData?.data || extractData;
  trackedJob = { id: job.id, title: job.title, company: job.company, sourceUrl: currentJobUrl, applyUrl: job.applyUrl || detectedPageJob?.applyUrl || currentJobUrl };

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

    // If a job is detected on the current page and it now matches a
    // tracked job (the list just loaded), refresh the banner to show
    // "Already tracked" instead of the default detection banner.
    if (detectedPageJob?.sourceUrl) {
      const matched = findMatchingTrackedJob(detectedPageJob.sourceUrl);
      if (matched) handleJobDetected(detectedPageJob);
    } else {
      // First-open detection: the panel just opened on an already-loaded
      // page, so the content script's jobDetected message was lost. Now
      // that trackedJobsList is populated, ask the content script what's
      // on the active tab — if it matches a tracked job, the user sees
      // "Already tracked" immediately. This runs regardless of the
      // autoDetect setting because recognising an existing tracked job
      // is context awareness, not auto-detection.
      chrome.runtime.sendMessage({ action: 'detectJob' }, (response) => {
        if (chrome.runtime.lastError) return;
        if (response?.payload) {
          handleJobDetected(response.payload);
        }
      });
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
    const pipelineStatus = job.pipelineStatus || 'tracked';

    // Score button — shows score number directly when scored
    const cachedScore = jobScores[id];
    const scoreResumeTip = cachedScore?.resumeName ? ` (${cachedScore.resumeName})` : '';
    const scoreButton = cachedScore
      ? `<button class="btn btn-outline btn-scored ${scoreClass(cachedScore.score)}" data-action="toggle-score" data-job-id="${id}" title="Scored with${scoreResumeTip} — click to see recommendations">🎯 ${formatScore(cachedScore.score)}</button>`
      : `<button class="btn btn-outline" data-action="score" data-job-id="${id}">🎯 Score</button>`;

    // Status pill with pencil edit icon — clicking switches to a dropdown
    const statusPill = `<span class="status-pill-wrapper" id="statusPill-${id}"><button class="pipeline-status-pill status-${pipelineStatus}" data-action="edit-status" data-job-id="${id}" title="Change status">${pipelineStatus} ✎</button></span>`;

    // Tailor button
    const cachedTailor = jobTailorings[id];
    const tailorButton = cachedTailor
      ? `<button class="btn btn-outline btn-tailored" data-action="tailor" data-job-id="${id}" title="Re-tailor this resume">✨ Tailored</button>`
      : `<button class="btn btn-primary" data-action="tailor" data-job-id="${id}">✨ Tailor</button>`;

    // Resume row — shown when a tailored variation exists
    const resumeDisplayName = escapeHtml(cachedTailor?.variationName || '');
    const masterDisplayName = escapeHtml(cachedTailor?.masterResumeName || '');
    const resumeFullTip = masterDisplayName
      ? `${resumeDisplayName || 'Tailored resume'} (from ${masterDisplayName})`
      : resumeDisplayName || 'Tailored resume';
    const resumeRow = cachedTailor ? `
        <div class="tracked-job-resume-row">
          <div class="resume-row-info">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            <span class="resume-row-name" title="${escapeHtml(resumeFullTip)}">${resumeDisplayName || 'Tailored resume'}${masterDisplayName ? `<span class="resume-row-source"> from ${masterDisplayName}</span>` : ''}</span>
          </div>
          <div class="resume-row-actions">
            <button class="icon-btn" data-action="download-tailored" data-job-id="${id}" title="Download resume"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
            <button class="icon-btn" data-action="view-tailored" data-job-id="${id}" title="View resume"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
          </div>
        </div>` : '';

    return `
      <div class="tracked-job-row" data-job-id="${id}">
        <div class="tracked-job-row-header">
          <div class="tracked-job-info">
            <div class="tracked-job-title">${title}</div>
            <div class="tracked-job-meta">${meta}</div>
          </div>
          <div class="tracked-job-row-trailing">
            ${statusPill}
            <button class="row-delete icon-btn" data-action="delete" data-job-id="${id}" title="Remove from your tracker"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
          </div>
        </div>
        <div class="tracked-job-actions">
          ${scoreButton}
          ${tailorButton}
          <button class="btn btn-outline" data-action="open" data-job-id="${id}">↗ Open</button>
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
    highlightActiveTrackedJob(matched);
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
    case 'toggle-score':
      return toggleInlineScore(jobId);
    case 'edit-status':
      return showStatusDropdown(jobId);
    case 'tailor':
      return rowTailorJob(jobId);
    case 'download':
    case 'download-tailored':
      return rowDownloadTailoredVariation(jobId);
    case 'delete':
      return rowDeleteTrackedJob(jobId);
    case 'view-tailored': {
      const cached = jobTailorings[jobId];
      if (cached?.variationId) {
        chrome.tabs.create({ url: buildWebUrl(`/resumes/${cached.variationId}`) });
      }
      return;
    }
    case 'open': {
      const openJob = trackedJobsList.find((j) => (j.id || j.Id) === jobId);
      const openUrl = openJob?.sourceUrl || buildWebUrl(`/jobs/${jobId}`);
      chrome.tabs.create({ url: openUrl });
      return;
    }
  }
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

  // Show "Tailor to Fix Gaps" if not yet tailored, or the tailored
  // resume row if a variation exists.
  const cachedTailorDetail = jobTailorings[jobId];
  const resumeNameDetail = escapeHtml(cachedTailorDetail?.variationName || '');
  const actionHtml = cachedTailorDetail
    ? `<div class="tracked-job-resume-row mt-2">
        <div class="resume-row-info">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          <span class="resume-row-name" title="${resumeNameDetail}">${resumeNameDetail || 'Tailored resume'}</span>
        </div>
        <div class="resume-row-actions">
          <button class="icon-btn" data-action="download-tailored" data-job-id="${jobId}" title="Download resume"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          <button class="icon-btn" data-action="view-tailored" data-job-id="${jobId}" title="View resume"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
        </div>
      </div>`
    : `<button class="btn btn-primary btn-compact" data-action="tailor" data-job-id="${jobId}">✨ Tailor to Fix Gaps</button>`;

  const scoredWithName = escapeHtml(cached.resumeName || '');
  const scoredWithLabel = scoredWithName
    ? `<div class="score-detail-resume-label">Scored with: <strong>${scoredWithName}</strong></div>`
    : '';

  panel.innerHTML = `
    <div class="score-detail-content">
      ${scoredWithLabel}
      <div class="score-detail-recommendations">${recHtml}</div>
      <div class="score-detail-actions">
        ${actionHtml}
        <button class="btn btn-outline btn-compact" data-action="rescore" data-job-id="${jobId}">🔄 Re-score</button>
      </div>
    </div>
  `;
  panel.classList.remove('hidden');

  // Wire buttons inside the detail panel
  panel.querySelector('[data-action="tailor"]')?.addEventListener('click', () => {
    panel.classList.add('hidden');
    rowTailorJob(jobId);
  });
  panel.querySelector('[data-action="rescore"]')?.addEventListener('click', () => {
    panel.classList.add('hidden');
    rowScoreJob(jobId);
  });
  panel.querySelectorAll('[data-action="download-tailored"], [data-action="view-tailored"]').forEach((btn) => {
    btn.addEventListener('click', onTrackedJobAction);
  });
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

// ---- Download the variation that was tailored for this job ---------
async function rowDownloadTailoredVariation(jobId) {
  const ok = await requireAuth();
  if (!ok) return;
  const cached = jobTailorings[jobId];
  if (!cached) {
    // No cached tailoring — fall back to the heuristic resolver.
    return rowDownloadResume(jobId);
  }
  const format = isPremium ? settings.downloadFormat || 'pdf' : 'pdf';
  // Override the variation id so handleDownload picks the cached one.
  const previous = generatedVariationId;
  generatedVariationId = cached.variationId;
  try {
    await handleDownload(format);
  } finally {
    generatedVariationId = previous;
  }
}

async function rowScoreJob(jobId) {
  const ok = await requireAuth();
  if (!ok || !selectedResume) {
    showQuickStatus('Select a resume in Settings first.', 'error');
    switchTab('settings');
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
    const result = data?.data || data?.result || data;
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
  if (!ok || !selectedResume) {
    showQuickStatus('Select a resume in Settings first.', 'error');
    switchTab('settings');
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
  // Reuse the fast pipeline but skip the extract step by pre-seeding state.
  trackedJob = {
    id: jobId,
    title: job.title || 'Untitled job',
    company: job.company || '',
    location: job.location || '',
    sourceUrl: job.sourceUrl || '',
    applyUrl: job.applyUrl || job.sourceUrl || '',
  };
  pipelineBusy = true;
  const restoreRow = showRowLoading(jobId, 'Tailoring resume…');
  try {
    const jwtToken = await getJwtToken();
    // Pass prior score recommendations (truncated) so the tailor LLM targets specific gaps
    const cachedScoreData = jobScores[jobId];
    const tailorPayload = {
      jobId,
      resumeId: selectedResume.id,
    };
    if (cachedScoreData?.recommendations) {
      // Truncate to keep the LLM prompt manageable for free models
      tailorPayload.priorRecommendations = cachedScoreData.recommendations.slice(0, 800);
    }
    const tailorController = new AbortController();
    const tailorTimeout = setTimeout(() => tailorController.abort(), 90000); // 90s timeout
    const tailorResp = await fetch(matchTailor, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(tailorPayload),
      signal: tailorController.signal,
    });
    clearTimeout(tailorTimeout);
    if (tailorResp.status === 401) return handleTokenExpired();
    if (await check429(tailorResp, 'quickStatus')) return;
    if (!tailorResp.ok) throw new Error('Tailor failed');
    const tailorData = await tailorResp.json();
    const tailored = tailorData?.data || tailorData;
    generatedResumeData = tailored;

    const masterId = getMasterResumeId(selectedResume);
    const variationName = `${trackedJob.title}${trackedJob.company ? ' - ' + trackedJob.company : ''}`;
    generatedVariationId = await saveAsVariation(masterId, {
      name: variationName,
      description: `Generated for ${trackedJob.title}`,
      markdownResume: tailored.markdownResume,
      jobId,
      sourceUrl: job.sourceUrl,
    });
    if (generatedVariationId) {
      const newScore = tailored.newScore ?? tailored.score ?? null;
      const masterName3 = selectedResume?.name || selectedResume?.title || 'Resume';
      saveJobTailoring(jobId, generatedVariationId, masterId, newScore, variationName, masterName3);
      if (newScore != null) {
        saveJobScore(jobId, newScore, tailored.summaryRecommendations || '', variationName);
      }
      renderTrackedJobsTable();
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
    restoreRow();
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
    if (message.action === 'tabActivated') {
      // User switched to a different tab — clear stale state from the
      // previous tab and re-run detection on the newly active tab.
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
      // initializeApp will call loadPremiumState which refreshes the
      // upgrade CTA / locked toggles / body class.
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
    loadJobCaches();
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
  hideElement('headerUpgradeButton');
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

  // ---- Now tab: active page banner & no-job state ----
  bind('quickTailorButton', gate(() => runTailorAndSavePipeline({ track: true })));
  bind('quickTailorOnlyButton', gate(() => runTailorAndSavePipeline({ track: false })));
  bind('quickTrackButton', gate(handleTrackJob));
  bind('quickScoreButton', gate(handleBannerScore));
  bind('manualScanButton', gate(handleManualScan));
  bind('rescanButton', gate(handleManualScan));
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
  bind('headerUpgradeButton', openUpgradePage);

  const webSettingsLink = document.getElementById('openWebSettingsLink');
  if (webSettingsLink) {
    webSettingsLink.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: buildWebUrl('/settings') });
    };
  }

  // ---- Resume manager (Settings tab) ----
  bind('refreshResumesButton', gate(loadMasterResumeGroups));
  bind('openResumeButton', () => {
    if (selectedResume?.id) {
      chrome.tabs.create({ url: buildWebUrl('/resumes/' + selectedResume.id) });
    }
  });
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
    const user = data?.data || data;
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
            <div class="d-flex align-items-center gap-2">
              <span class="badge badge-master">Master</span>
              <button class="icon-btn" onclick="event.stopPropagation(); openResumeInTab('${master.id}')" title="View resume"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
            </div>
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
                <button class="icon-btn" onclick="event.stopPropagation(); openResumeInTab('${v.id}')" title="View resume"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>
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

window.openResumeInTab = function (id) {
  chrome.tabs.create({ url: buildWebUrl('/resumes/' + id) });
};

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
    const job = data?.data || data?.result || data;

    trackedJob = {
      id: job.id,
      title: job.title || 'Untitled job',
      company: job.company || job.companyName || '',
      location: job.location || '',
      sourceUrl: currentJobUrl,
      applyUrl: job.applyUrl || detectedPageJob?.applyUrl || currentJobUrl,
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
    showError('custom', 'Please select a resume first');
    return;
  }

  if (!currentJobHtml) {
    const ok = await capturePageHtmlLegacy();
    if (!ok) {
      showError('custom', 'Could not read page content.');
      return;
    }
  }

  const priorRecWizard = trackedJob?.id ? (jobScores[trackedJob.id]?.recommendations || '') : '';
  const tailorRequest = {
    jobHtml: currentJobHtml,
    resumeId: selectedResume.id,
    sourceUrl: currentJobUrl,
    jobId: trackedJob?.id,
    ...(priorRecWizard ? { priorRecommendations: priorRecWizard } : {}),
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
    const analytics = data.data || data;
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
