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
let masterResumeGroups = [];
let selectedResume = null;
let generatedResumeData = null;
let generatedVariationId = null; // set when "Save as Variation" succeeds
let currentJobHtml = null;
let currentJobUrl = null;
let currentJobOriginalHtml = null; // raw page HTML for the extract API
let trackedJob = null;             // { id, title, company, sourceUrl, ... }

// ---- Bootstrapping --------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  updateConfiguration();
  initializeApp();
  setupUrlChangeListener();
  setupAuthSyncListener();
});

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
      hideElement('currentJobDisplay');
      clearPreviousResults();
    }
    return true;
  });
}

/**
 * Listen for auth state changes pushed by the service worker (i.e.
 * the auth bridge picked up a JWT from app.hired.video).
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

    loadMasterResumeGroups();
    loadTrackedJobCount();
    loadCurrentUser();
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
  document.getElementById('trackedJobCount').textContent = '—';
  setupLoginButton();
}

function showSignedInState() {
  hideElement('signedOutBanner');
  showElement('profileCard');
  hideElement('resumeListEmptyHint');
}

/**
 * Auth gate. Wrap any action that requires a valid JWT.
 * If the user isn't signed in, opens login.html in a new tab and
 * returns false so the caller can short-circuit.
 */
async function requireAuth() {
  const token = await getJwtToken();
  if (token) return true;

  // Surface the banner (in case it was dismissed) and open the
  // sign-in page so the auth bridge can pick up a token.
  showSignedOutState();
  window.open(chrome.runtime.getURL('login.html'), '_blank');
  return false;
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
    masterResumeGroups = [];
    showSignedOutState();
  });
}

function setupLoginButton() {
  const btn = document.getElementById('loginButton');
  if (btn) {
    btn.onclick = () => {
      window.location.href = chrome.runtime.getURL('login.html');
    };
  }
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

  bind('refreshResumesButton', loadMasterResumeGroups);
  bind('changeResumeButton', showResumeSelection);
  bind('uploadResumeButton', () => document.getElementById('uploadResumeInput').click());
  bind('uploadResumeInput', handleResumeUpload, 'change');
  bind('signOutButton', handleSignOut);

  const profileLink = document.getElementById('openProfileLink');
  if (profileLink) {
    profileLink.onclick = (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: buildWebUrl('/profile') });
    };
  }

  bind('trackJobButton', handleTrackJob);
  bind('scoreEvaluateButton', handleScoreEvaluate);
  bind('trackGenerateButton', handleTailorGenerate);
  bind('saveVariationButton', handleSaveVariation);
  bind('markAppliedButton', handleMarkApplied);

  bind('downloadPdfButton', () => handleDownload('pdf'));
  bind('downloadDocxButton', () => handleDownload('docx'));

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
  if (!jwtToken) return;

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
      masterResumeGroups = data.data;
    } else if (Array.isArray(data)) {
      masterResumeGroups = data;
    } else {
      masterResumeGroups = [];
    }

    renderResumeSelection();

    if (!selectedResume && masterResumeGroups.length > 0) {
      selectResume(masterResumeGroups[0].masterResume);
    } else if (selectedResume) {
      const found = findResumeById(selectedResume.id);
      if (found) selectResume(found);
      else if (masterResumeGroups.length > 0) selectResume(masterResumeGroups[0].masterResume);
    }
  } catch (error) {
    console.error('Error loading resumes:', error);
    showError('resumeSelectionContainer', 'Failed to load resumes. Please try again.');
  } finally {
    hideElement('resumeLoadingContainer');
  }
}

function findResumeById(id) {
  for (const group of masterResumeGroups) {
    if (group.masterResume.id === id) return group.masterResume;
    for (const variation of (group.variations || [])) {
      if (variation.id === id) return variation;
    }
  }
  return null;
}

function renderResumeSelection() {
  const container = document.getElementById('resumeSelectionContainer');

  if (masterResumeGroups.length === 0) {
    container.innerHTML = `
      <div class="alert alert-info">
        <p>No resumes found yet. Click <strong>Upload PDF/Word</strong> below to add your first one — it will automatically become your master resume.</p>
      </div>
    `;
    showElement('resumeSelectionContainer');
    return;
  }

  let html = '';
  for (const group of masterResumeGroups) {
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

  document.getElementById('selectedResumeName').textContent = resume.name || resume.title || 'Untitled Resume';

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

    const response = await fetch(jobsExtractUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`,
      },
      body: JSON.stringify({
        url: currentJobUrl,
        sourceUrl: currentJobUrl,
        html: currentJobOriginalHtml || currentJobHtml,
      }),
    });

    if (response.status === 401) return handleTokenExpired();
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
