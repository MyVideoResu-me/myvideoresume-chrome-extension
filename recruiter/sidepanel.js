/**
 * hired.video Chrome Extension - Recruiter Side Panel
 *
 * Five-tab UI for recruiters:
 *   1. Now — active page detection (jobs, profiles, companies) + extraction
 *   2. Pipeline — kanban view of candidates by submission stage
 *   3. Candidates — talent pool list with search, scores, detail view
 *   4. Companies — extracted companies list
 *   5. Settings — auto-detect toggles (pro), account management
 */

// ---- Global state -------------------------------------------------------

let currentTab = 'now';
let isPro = false;
let detectedPageJob = null;
let detectedPageProfile = null;
let detectedPageCompany = null;
let extractionBusy = false;

// Talent pool cache
let talentPoolList = [];
let pipelineData = {};
let companiesList = [];
let matchScores = {};

// Messaging state
let currentUserId = null;
let activeConversationId = null;
let activeRecipientId = null;
let pendingJobAttachment = null; // job card to attach when composing

// Settings - all auto-detect features are PAID for the recruiter extension.
const DEFAULT_SETTINGS = {
  autoDetectJobs: false,       // PAID
  autoDetectProfiles: false,   // PAID
  autoDetectCompanies: false,  // PAID
  autoScore: false,            // PAID
};
let settings = { ...DEFAULT_SETTINGS };

// ---- Bootstrapping ------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  wireLoginButtons();
  updateConfiguration();
  initializeApp();
  setupTabNavigation();
  setupAuthSyncListener();
  setupDetectionListeners();
  setupWebAppEventListener();

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      getJwtToken().then((token) => { if (token) loadUserProfile(token); });
    }
  });
});

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

// ---- Initialization -----------------------------------------------------

async function initializeApp() {
  const token = await getJwtToken();
  if (!token) {
    showSignedOutState();
    return;
  }

  try {
    await loadUserProfile(token);
    showSignedInState();
    await loadSettings();
    // Load data for the active tab
    loadTabData(currentTab);
  } catch (err) {
    console.error('[hired.video] init error:', err);
    showSignedOutState();
  }
}

function showSignedOutState() {
  showElement('signedOutBanner');
  hideElement('profileCard');
}

function showSignedInState() {
  hideElement('signedOutBanner');
  showElement('profileCard');
}

async function loadUserProfile(token) {
  const res = await fetch(apiBase + PATHS.me, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (res.status === 401) {
    chrome.storage.local.remove('jwtToken');
    throw new Error('Token expired');
  }
  if (!res.ok) throw new Error('Failed to load profile');
  const data = await res.json();
  const user = data.data || data;

  currentUserId = user.id || user.sub || null;

  const nameEl = document.getElementById('profileName');
  const emailEl = document.getElementById('profileEmail');
  if (nameEl) nameEl.textContent = user.name || user.email || 'Signed in';
  if (emailEl) emailEl.textContent = user.email || '';

  // Backend treats SuperAdmin/Admin as pro regardless of plan. Paid-plan
  // detection lives on /api/billing/token-budget; the recruiter extension
  // doesn't use it today, so pro gating relies on role alone.
  const role = (user.role || '').toString().toLowerCase();
  isPro = role === 'superadmin' || role === 'admin' || role === 'pro' || role === 'premium';
  applyProGating();
}

function applyProGating() {
  // Auto-detect settings — all four are gated for the recruiter extension.
  const jobsToggle = document.getElementById('settingAutoDetectJobs');
  const profileToggle = document.getElementById('settingAutoDetectProfiles');
  const companyToggle = document.getElementById('settingAutoDetectCompanies');
  const scoreToggle = document.getElementById('settingAutoScore');

  if (!isPro) {
    if (jobsToggle) jobsToggle.disabled = true;
    if (profileToggle) profileToggle.disabled = true;
    if (companyToggle) companyToggle.disabled = true;
    if (scoreToggle) scoreToggle.disabled = true;
    showElement('autoDetectUpgrade');
    hideElement('headerUpgradeButton');
  } else {
    if (jobsToggle) jobsToggle.disabled = false;
    if (profileToggle) profileToggle.disabled = false;
    if (companyToggle) companyToggle.disabled = false;
    if (scoreToggle) scoreToggle.disabled = false;
    hideElement('autoDetectUpgrade');
  }
}

// ---- Settings -----------------------------------------------------------

async function loadSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get('recruiterSettings', (data) => {
      if (data.recruiterSettings) {
        settings = { ...DEFAULT_SETTINGS, ...data.recruiterSettings };
      }
      applySettingsToUI();
      resolve();
      // Upgrade local state with the server's truth after the UI paints.
      loadSettingsFromServer();
    });
  });
}

/**
 * Pull the recruiter slice of extension_settings from the server and
 * merge into local `settings`, so changes made in /settings?tab=extensions
 * (or from another device) show up here.
 */
async function loadSettingsFromServer() {
  try {
    const jwtToken = await getJwtToken();
    if (!jwtToken) return;
    const resp = await fetch(extensionPreferencesUrl, {
      headers: { Authorization: `Bearer ${jwtToken}` },
    });
    if (!resp.ok) return;
    const data = await resp.json();
    const server = data?.data?.recruiter;
    if (!server || typeof server !== 'object') return;

    let changed = false;
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (key in server && settings[key] !== server[key]) {
        settings[key] = server[key];
        changed = true;
      }
    }
    if (changed) {
      chrome.storage.local.set({ recruiterSettings: settings });
      applySettingsToUI();
    }
  } catch (err) {
    console.warn('[hired.video] loadSettingsFromServer failed:', err);
  }
}

function applySettingsToUI() {
  const mapping = {
    settingAutoDetectJobs: 'autoDetectJobs',
    settingAutoDetectProfiles: 'autoDetectProfiles',
    settingAutoDetectCompanies: 'autoDetectCompanies',
    settingAutoScore: 'autoScore',
  };
  for (const [elId, key] of Object.entries(mapping)) {
    const el = document.getElementById(elId);
    if (el) el.checked = !!settings[key];
  }
}

function saveSettings() {
  chrome.storage.local.set({ recruiterSettings: settings });
  saveSettingsToServer();
}

/**
 * PUT the current recruiter settings slice to the server and notify any
 * open /settings?tab=extensions tab to re-fetch.
 */
async function saveSettingsToServer() {
  try {
    const jwtToken = await getJwtToken();
    if (!jwtToken) return;
    const payload = {
      recruiter: {
        autoDetectJobs: !!settings.autoDetectJobs,
        autoDetectProfiles: !!settings.autoDetectProfiles,
        autoDetectCompanies: !!settings.autoDetectCompanies,
        autoScore: !!settings.autoScore,
      },
    };
    const resp = await fetch(extensionPreferencesUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${jwtToken}`,
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) return;
    chrome.runtime.sendMessage({
      action: 'broadcastToWebApp',
      type: 'settings-changed',
    }).catch(() => {});
  } catch (err) {
    console.warn('[hired.video] saveSettingsToServer failed:', err);
  }
}

/**
 * Listen for settings-changed events pushed from the web app so the
 * Recruiter panel doesn't hold stale state after the user edits prefs
 * on /settings?tab=extensions. Mirrors the Job Seeker side.
 */
function setupWebAppEventListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (!message || message.action !== 'webAppEvent') return false;
    if (message.type === 'settings-changed') loadSettingsFromServer();
    return false;
  });
}

// ---- Tab navigation -----------------------------------------------------

function setupTabNavigation() {
  const tabs = document.querySelectorAll('.tab-button');
  tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });

  // Settings toggles
  ['settingAutoDetectJobs', 'settingAutoDetectProfiles', 'settingAutoDetectCompanies', 'settingAutoScore'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('change', () => {
        const key = {
          settingAutoDetectJobs: 'autoDetectJobs',
          settingAutoDetectProfiles: 'autoDetectProfiles',
          settingAutoDetectCompanies: 'autoDetectCompanies',
          settingAutoScore: 'autoScore',
        }[id];
        if (key) {
          settings[key] = el.checked;
          saveSettings();
        }
      });
    }
  });

  // Sign out
  const signOut = document.getElementById('signOutButton') || document.getElementById('settingsSignOutButton');
  if (signOut) {
    signOut.addEventListener('click', () => {
      chrome.storage.local.remove(['jwtToken', 'recruiterSettings']);
      showSignedOutState();
    });
  }
  const settingsSignOut = document.getElementById('settingsSignOutButton');
  if (settingsSignOut && settingsSignOut !== signOut) {
    settingsSignOut.addEventListener('click', () => {
      chrome.storage.local.remove(['jwtToken', 'recruiterSettings']);
      showSignedOutState();
    });
  }

  // Profile link
  const profileLink = document.getElementById('openProfileLink') || document.getElementById('settingsProfileLink');
  if (profileLink) {
    profileLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: buildWebUrl('/dashboard') });
    });
  }

  // "Manage on web" deep-link: jumps straight to the Chrome Extensions
  // tab on /settings so the user doesn't have to hunt for it.
  const webSettingsLink = document.getElementById('openWebSettingsLink');
  if (webSettingsLink) {
    webSettingsLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: buildWebUrl('/settings?tab=extensions') });
    });
  }

  // Upgrade buttons
  ['headerUpgradeButton', 'upgradeAutoDetectButton'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', () => {
        chrome.tabs.create({ url: buildWebUrl('/pricing') });
      });
    }
  });

  // Scan page button
  const scanBtn = document.getElementById('scanPageButton');
  if (scanBtn) {
    scanBtn.addEventListener('click', handleScanPage);
  }

  // Extract buttons
  const extractJob = document.getElementById('extractJobButton');
  if (extractJob) extractJob.addEventListener('click', handleExtractJob);

  const extractProfile = document.getElementById('extractProfileButton');
  if (extractProfile) extractProfile.addEventListener('click', handleExtractProfile);

  const extractCompany = document.getElementById('extractCompanyButton');
  if (extractCompany) extractCompany.addEventListener('click', handleExtractCompany);

  // Candidate search
  const searchInput = document.getElementById('candidateSearch');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderCandidateList(searchInput.value.trim());
    });
  }

  // Company search
  const companySearchInput = document.getElementById('companySearch');
  if (companySearchInput) {
    companySearchInput.addEventListener('input', () => {
      renderCompanyList(companySearchInput.value.trim());
    });
  }

  // Candidate detail close
  const closeDetail = document.getElementById('closeCandidateDetail');
  if (closeDetail) {
    closeDetail.addEventListener('click', () => hideElement('candidateDetail'));
  }

  // Message panel close
  const closeMsg = document.getElementById('closeMessagePanel');
  if (closeMsg) {
    closeMsg.addEventListener('click', closeMessagePanel);
  }

  // Share job button
  const shareJob = document.getElementById('shareJobButton');
  if (shareJob) {
    shareJob.addEventListener('click', handleShareJob);
  }

  // Candidate picker
  const closePicker = document.getElementById('closeCandidatePicker');
  if (closePicker) {
    closePicker.addEventListener('click', () => hideElement('candidatePickerPanel'));
  }
  const pickerSearch = document.getElementById('candidatePickerSearch');
  if (pickerSearch) {
    pickerSearch.addEventListener('input', () => renderCandidatePickerList(pickerSearch.value.trim()));
  }

  // Personalize button
  const personalizeBtn = document.getElementById('personalizeMessageButton');
  if (personalizeBtn) {
    personalizeBtn.addEventListener('click', handlePersonalizeMessage);
  }
}

function switchTab(tab) {
  currentTab = tab;
  // Update tab buttons
  document.querySelectorAll('.tab-button').forEach((btn) => {
    const isActive = btn.dataset.tab === tab;
    btn.classList.toggle('tab-active', isActive);
    btn.setAttribute('aria-selected', isActive);
  });
  // Show/hide panels
  document.querySelectorAll('.tab-content').forEach((panel) => {
    const panelTab = panel.id.replace('tab', '').toLowerCase();
    panel.classList.toggle('tab-visible', panelTab === tab);
  });
  // Load data if needed
  loadTabData(tab);
}

async function loadTabData(tab) {
  const token = await getJwtToken();
  if (!token) return;

  switch (tab) {
    case 'pipeline':
      loadPipeline();
      break;
    case 'candidates':
      loadCandidates();
      break;
    case 'companies':
      loadCompanies();
      break;
  }
}

// ---- Detection listeners ------------------------------------------------

function setupDetectionListeners() {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'jobDetected' && settings.autoDetectJobs) {
      detectedPageJob = msg.payload;
      showJobDetectedBanner(msg.payload);
    }
    if (msg.action === 'profileDetected' && isPro && settings.autoDetectProfiles) {
      detectedPageProfile = msg.payload;
      showProfileDetectedBanner(msg.payload);
    }
    if (msg.action === 'companyDetected' && isPro && settings.autoDetectCompanies) {
      detectedPageCompany = msg.payload;
      showCompanyDetectedBanner(msg.payload);
    }
    if (msg.action === 'urlChanged' || msg.action === 'tabActivated') {
      clearDetectionBanners();
    }
    if (msg.action === 'authStateChanged') {
      initializeApp();
    }
  });
}

function setupAuthSyncListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.jwtToken) {
      initializeApp();
    }
  });
}

function showJobDetectedBanner(payload) {
  const el = document.getElementById('jobDetectedBanner');
  const title = document.getElementById('jobDetectedTitle');
  const company = document.getElementById('jobDetectedCompany');
  if (title) title.textContent = payload.title || 'Job detected on this page';
  if (company) company.textContent = [payload.company, payload.location].filter(Boolean).join(' · ');
  if (el) el.classList.remove('hidden');
}

function showProfileDetectedBanner(payload) {
  const el = document.getElementById('profileDetectedBanner');
  const name = document.getElementById('profileDetectedName');
  const title = document.getElementById('profileDetectedTitle');
  if (name) name.textContent = payload.name || 'Profile detected';
  if (title) title.textContent = [payload.title, payload.company].filter(Boolean).join(' at ');
  if (el) el.classList.remove('hidden');
}

function showCompanyDetectedBanner(payload) {
  const el = document.getElementById('companyDetectedBanner');
  const name = document.getElementById('companyDetectedName');
  const industry = document.getElementById('companyDetectedIndustry');
  if (name) name.textContent = payload.name || 'Company detected';
  if (industry) industry.textContent = [payload.industry, payload.location].filter(Boolean).join(' · ');
  if (el) el.classList.remove('hidden');
}

function clearDetectionBanners() {
  detectedPageJob = null;
  detectedPageProfile = null;
  detectedPageCompany = null;
  hideElement('jobDetectedBanner');
  hideElement('profileDetectedBanner');
  hideElement('companyDetectedBanner');
  hideElement('extractionResult');
}

// ---- Scan page ----------------------------------------------------------

async function handleScanPage() {
  // Trigger detection in the content scripts manually
  chrome.runtime.sendMessage({ action: 'getHTML' }, (response) => {
    if (response && response.html) {
      // The content scripts will detect and send jobDetected/profileDetected/companyDetected
      consoleAlerts('Page scanned for content');
    }
  });
  // Also re-trigger focused pane detection
  chrome.runtime.sendMessage({ action: 'getFocusedPaneHTML' });
  chrome.runtime.sendMessage({ action: 'getFocusedProfileHTML' });
  chrome.runtime.sendMessage({ action: 'getFocusedCompanyHTML' });
}

// ---- Extract job --------------------------------------------------------

async function handleExtractJob() {
  if (extractionBusy) return;
  extractionBusy = true;
  showElement('extractionLoading');
  const loadingText = document.getElementById('extractionLoadingText');
  if (loadingText) loadingText.textContent = 'Extracting job...';

  try {
    // Get the focused job pane HTML
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getFocusedPaneHTML' }, resolve);
    });

    const html = response?.html;
    if (!html) {
      // Fall back to full page HTML
      const fullPage = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getHTML' }, resolve);
      });
      if (!fullPage?.html) throw new Error('Could not get page content');
      await extractJobFromHtml(fullPage.html, fullPage.originUrl);
    } else {
      await extractJobFromHtml(html, response.originUrl);
    }
  } catch (err) {
    showExtractionError('Failed to extract job: ' + err.message);
  } finally {
    extractionBusy = false;
    hideElement('extractionLoading');
  }
}

async function extractJobFromHtml(html, sourceUrl) {
  const res = await apiFetch(jobsExtractUrl + '?track=true', {
    method: 'POST',
    body: JSON.stringify({ html, sourceUrl }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Extraction failed');

  const job = data.data;
  showExtractionSuccess('job', job);

  // Auto-score candidates if enabled
  if (isPro && settings.autoScore && job.id) {
    triggerBackgroundScoring('candidates', job.id);
  }
}

// ---- Extract profile ----------------------------------------------------

async function handleExtractProfile() {
  if (extractionBusy) return;
  extractionBusy = true;
  showElement('extractionLoading');
  const loadingText = document.getElementById('extractionLoadingText');
  if (loadingText) loadingText.textContent = 'Extracting profile...';

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getFocusedProfileHTML' }, resolve);
    });

    let html = response?.html;
    if (!html) {
      const fullPage = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getHTML' }, resolve);
      });
      html = fullPage?.html;
    }
    if (!html) throw new Error('Could not get page content');

    const res = await apiFetch(recruiterExtractProfileUrl, {
      method: 'POST',
      body: JSON.stringify({ html, sourceUrl: response?.originUrl || '' }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Extraction failed');

    const profile = data.data;
    showExtractionSuccess('profile', profile);

    // Auto-score against jobs if enabled
    if (isPro && settings.autoScore && profile.talentPoolCandidate?.id) {
      triggerBackgroundScoring('jobs', profile.talentPoolCandidate.id);
    }
  } catch (err) {
    showExtractionError('Failed to extract profile: ' + err.message);
  } finally {
    extractionBusy = false;
    hideElement('extractionLoading');
  }
}

// ---- Extract company ----------------------------------------------------

async function handleExtractCompany() {
  if (extractionBusy) return;
  extractionBusy = true;
  showElement('extractionLoading');
  const loadingText = document.getElementById('extractionLoadingText');
  if (loadingText) loadingText.textContent = 'Extracting company...';

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getFocusedCompanyHTML' }, resolve);
    });

    let html = response?.html;
    if (!html) {
      const fullPage = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'getHTML' }, resolve);
      });
      html = fullPage?.html;
    }
    if (!html) throw new Error('Could not get page content');

    const res = await apiFetch(companiesExtractUrl, {
      method: 'POST',
      body: JSON.stringify({ html, sourceUrl: response?.originUrl || '' }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Extraction failed');

    showExtractionSuccess('company', data.data);
  } catch (err) {
    showExtractionError('Failed to extract company: ' + err.message);
  } finally {
    extractionBusy = false;
    hideElement('extractionLoading');
  }
}

// ---- Extraction UI feedback ---------------------------------------------

function showExtractionSuccess(type, data) {
  const container = document.getElementById('extractionResultContent');
  if (!container) return;

  let html = '';
  if (type === 'job') {
    html = `
      <div class="extraction-success">
        <div class="d-flex align-items-center gap-2">
          <span class="extraction-icon">📌</span>
          <div>
            <div class="font-medium">${escapeHtml(data.title || 'Job extracted')}</div>
            <div class="text-sm text-muted">${escapeHtml(data.company || '')} ${data.location ? '· ' + escapeHtml(data.location) : ''}</div>
          </div>
        </div>
        ${data.duplicate ? '<div class="text-xs text-muted mt-1">Duplicate detected — linked to existing record.</div>' : ''}
      </div>
    `;
  } else if (type === 'profile') {
    const profile = data.profile || data;
    const extracted = profile.extractedData || profile.extracted_data || {};
    html = `
      <div class="extraction-success">
        <div class="d-flex align-items-center gap-2">
          <span class="extraction-icon">👤</span>
          <div>
            <div class="font-medium">${escapeHtml(extracted.name || 'Profile extracted')}</div>
            <div class="text-sm text-muted">${escapeHtml(extracted.title || '')} ${extracted.company ? '· ' + escapeHtml(extracted.company) : ''}</div>
          </div>
        </div>
        ${data.duplicate ? '<div class="text-xs text-muted mt-1">Duplicate detected — linked to existing record.</div>' : ''}
      </div>
    `;
  } else if (type === 'company') {
    html = `
      <div class="extraction-success">
        <div class="d-flex align-items-center gap-2">
          <span class="extraction-icon">🏢</span>
          <div>
            <div class="font-medium">${escapeHtml(data.name || data.company?.name || 'Company extracted')}</div>
            <div class="text-sm text-muted">${escapeHtml(data.industry || data.company?.industry || '')}</div>
          </div>
        </div>
        ${data.duplicate ? '<div class="text-xs text-muted mt-1">Already exists — merged with existing record.</div>' : ''}
      </div>
    `;
  }

  container.innerHTML = html;
  showElement('extractionResult');
}

function showExtractionError(message) {
  const container = document.getElementById('extractionResultContent');
  if (!container) return;
  container.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
  showElement('extractionResult');
}

// ---- Background scoring triggers ----------------------------------------

async function triggerBackgroundScoring(type, id) {
  try {
    if (type === 'candidates') {
      await apiFetch(recruiterMatchScoreCandidatesUrl, {
        method: 'POST',
        body: JSON.stringify({ jobId: id }),
      });
    } else if (type === 'jobs') {
      await apiFetch(recruiterMatchScoreJobsUrl, {
        method: 'POST',
        body: JSON.stringify({ candidateId: id }),
      });
    }
    consoleAlerts(`Background scoring triggered: ${type} for ${id}`);
  } catch (err) {
    consoleAlerts(`Background scoring failed: ${err.message}`);
  }
}

// ---- Pipeline tab -------------------------------------------------------

async function loadPipeline() {
  showElement('pipelineLoading');
  hideElement('pipelineEmpty');

  try {
    const res = await apiFetch(recruiterPipelineUrl);
    if (!res.ok) throw new Error('Failed to load pipeline');
    const data = await res.json();
    pipelineData = data.data?.stages || data.data || {};
    renderPipeline();
  } catch (err) {
    console.error('[hired.video] pipeline load error:', err);
    showElement('pipelineEmpty');
  } finally {
    hideElement('pipelineLoading');
  }
}

function renderPipeline() {
  const stages = {
    sourced: 'Sourced',
    contacted: 'Contacted',
    screening: 'Screening',
    interview: 'Interview',
    offer: 'Offer',
    placed: 'Placed',
  };

  let hasAny = false;

  for (const [stage, label] of Object.entries(stages)) {
    const container = document.getElementById('stage' + capitalizeFirst(stage));
    const countEl = document.getElementById('count' + capitalizeFirst(stage));
    const items = pipelineData[stage] || [];

    if (countEl) countEl.textContent = items.length;
    if (items.length > 0) hasAny = true;

    if (container) {
      container.innerHTML = items.map((item) => `
        <div class="pipeline-card" data-id="${escapeHtml(item.id)}">
          <div class="pipeline-card-name">${escapeHtml(item.candidateName || 'Unknown')}</div>
          <div class="pipeline-card-job text-sm text-muted">${escapeHtml(item.jobTitle || '')}</div>
          ${item.score != null ? `<div class="pipeline-card-score score-badge">${formatScore(item.score)}</div>` : ''}
        </div>
      `).join('');
    }
  }

  if (!hasAny) {
    showElement('pipelineEmpty');
  } else {
    hideElement('pipelineEmpty');
  }
}

// ---- Candidates tab -----------------------------------------------------

async function loadCandidates() {
  showElement('candidatesLoading');
  hideElement('candidatesEmpty');

  try {
    const res = await apiFetch(recruiterTalentPoolUrl);
    if (!res.ok) throw new Error('Failed to load candidates');
    const data = await res.json();
    talentPoolList = data.data || [];
    renderCandidateList();

    const countEl = document.getElementById('candidateCount');
    if (countEl) countEl.textContent = talentPoolList.length;
  } catch (err) {
    console.error('[hired.video] candidates load error:', err);
    showElement('candidatesEmpty');
  } finally {
    hideElement('candidatesLoading');
  }
}

function renderCandidateList(filter = '') {
  const container = document.getElementById('candidateList');
  if (!container) return;

  let items = talentPoolList;
  if (filter) {
    const lc = filter.toLowerCase();
    items = items.filter((c) =>
      (c.candidateName || '').toLowerCase().includes(lc) ||
      (c.candidateTitle || '').toLowerCase().includes(lc) ||
      (c.currentCompany || '').toLowerCase().includes(lc) ||
      ((c.tags || []).join(' ')).toLowerCase().includes(lc)
    );
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="text-muted text-sm text-center p-2">No candidates found.</div>';
    return;
  }

  container.innerHTML = items.map((c) => `
    <div class="candidate-card card" data-id="${escapeHtml(c.id)}">
      <div class="d-flex align-items-center justify-between">
        <div>
          <div class="font-medium">${escapeHtml(c.candidateName || 'Unknown')}</div>
          <div class="text-sm text-muted">${escapeHtml(c.candidateTitle || c.currentTitle || '')}</div>
          <div class="text-xs text-muted">${escapeHtml(c.currentCompany || '')}</div>
        </div>
        <div class="d-flex gap-1">
          <span class="badge badge-${c.relationshipStrength === 'hot' ? 'danger' : c.relationshipStrength === 'warm' ? 'warning' : 'secondary'}">${escapeHtml(c.relationshipStrength || 'warm')}</span>
          <button class="btn btn-outline btn-xs" onclick="viewCandidateDetail('${c.id}')">View</button>
        </div>
      </div>
      ${(c.tags || []).length > 0 ? `<div class="mt-1">${c.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(' ')}</div>` : ''}
    </div>
  `).join('');
}

function viewCandidateDetail(candidateId) {
  const candidate = talentPoolList.find((c) => c.id === candidateId);
  if (!candidate) return;

  const nameEl = document.getElementById('candidateDetailName');
  if (nameEl) nameEl.textContent = candidate.candidateName || 'Candidate';

  const content = document.getElementById('candidateDetailContent');
  if (content) {
    content.innerHTML = `
      <div class="card">
        <div class="font-medium">${escapeHtml(candidate.candidateName || '')}</div>
        <div class="text-sm">${escapeHtml(candidate.candidateTitle || candidate.currentTitle || '')}</div>
        <div class="text-sm text-muted">${escapeHtml(candidate.currentCompany || '')}</div>
        ${candidate.candidateEmail ? `<div class="text-sm">📧 ${escapeHtml(candidate.candidateEmail)}</div>` : ''}
        ${candidate.preferredLocations ? `<div class="text-sm">📍 ${escapeHtml(candidate.preferredLocations)}</div>` : ''}
      </div>
      <div class="card">
        <h4 class="card-title">Notes</h4>
        <div class="text-sm">${escapeHtml(candidate.notes || 'No notes yet.')}</div>
      </div>
      <div class="card">
        <h4 class="card-title">Match Scores</h4>
        <div id="candidateScores" class="text-sm text-muted">Loading scores...</div>
      </div>
      <div class="d-flex gap-2 mt-2">
        <button class="btn btn-primary btn-sm btn-block" onclick="openMessagePanel('${candidateId}', '${escapeHtml(candidate.candidateName || '')}')">💬 Message</button>
        <button class="btn btn-outline btn-sm btn-block" onclick="scoreCandidateJobs('${candidateId}')">📊 Score Jobs</button>
      </div>
    `;
  }

  showElement('candidateDetail');
  loadCandidateScores(candidateId);
}

async function loadCandidateScores(candidateId) {
  const container = document.getElementById('candidateScores');
  if (!container) return;

  try {
    const res = await apiFetch(recruiterMatchScoresUrl + '?candidateId=' + candidateId);
    if (!res.ok) throw new Error('Failed to load scores');
    const data = await res.json();
    const scores = data.data?.scores || [];

    if (scores.length === 0) {
      container.innerHTML = 'No scores yet. Click "Score Jobs" to match against active jobs.';
      return;
    }

    container.innerHTML = scores.map((s) => `
      <div class="score-row d-flex align-items-center justify-between">
        <div class="text-sm">${escapeHtml(s.jobTitle || 'Job')}</div>
        <div class="score-badge score-${s.score >= 70 ? 'high' : s.score >= 40 ? 'medium' : 'low'}">${formatScore(s.score)}</div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = 'Failed to load scores.';
  }
}

async function scoreCandidateJobs(candidateId) {
  await triggerBackgroundScoring('jobs', candidateId);
  const container = document.getElementById('candidateScores');
  if (container) container.innerHTML = 'Scoring in progress... refresh in a moment.';
}

// ---- Companies tab ------------------------------------------------------

async function loadCompanies() {
  showElement('companiesLoading');
  hideElement('companiesEmpty');

  try {
    // Use the existing companies endpoint
    const res = await apiFetch(apiBase + '/api/companies');
    if (!res.ok) throw new Error('Failed to load companies');
    const data = await res.json();
    companiesList = data.data || [];
    renderCompanyList();

    const countEl = document.getElementById('companyCount');
    if (countEl) countEl.textContent = companiesList.length;
  } catch (err) {
    console.error('[hired.video] companies load error:', err);
    showElement('companiesEmpty');
  } finally {
    hideElement('companiesLoading');
  }
}

function renderCompanyList(filter = '') {
  const container = document.getElementById('companyList');
  if (!container) return;

  let items = companiesList;
  if (filter) {
    const lc = filter.toLowerCase();
    items = items.filter((c) =>
      (c.name || '').toLowerCase().includes(lc) ||
      (c.industry || '').toLowerCase().includes(lc) ||
      (c.headquarters || '').toLowerCase().includes(lc)
    );
  }

  if (items.length === 0) {
    container.innerHTML = '<div class="text-muted text-sm text-center p-2">No companies found.</div>';
    return;
  }

  container.innerHTML = items.map((c) => `
    <div class="company-card card">
      <div class="d-flex align-items-center justify-between">
        <div>
          <div class="font-medium">${escapeHtml(c.name || 'Unknown')}</div>
          <div class="text-sm text-muted">${[c.industry, c.headquarters].filter(Boolean).map(escapeHtml).join(' · ')}</div>
          ${c.size ? `<div class="text-xs text-muted">${escapeHtml(c.size)} employees</div>` : ''}
        </div>
        ${c.website ? `<a href="${escapeHtml(c.website)}" target="_blank" class="btn btn-outline btn-xs">🌐</a>` : ''}
      </div>
    </div>
  `).join('');
}

// ---- Messaging ----------------------------------------------------------

/**
 * Open the message panel for a candidate. Finds or creates a direct
 * conversation, loads the message history, and wires the send button.
 *
 * @param {string} candidateId   - talent pool candidate row ID (== user ID)
 * @param {string} candidateName - display name
 * @param {object} [jobAttachment] - optional job to pre-attach
 */
async function openMessagePanel(candidateId, candidateName, jobAttachment) {
  const titleEl = document.getElementById('messagePanelTitle');
  if (titleEl) titleEl.textContent = candidateName;

  activeRecipientId = candidateId;
  activeConversationId = null;
  pendingJobAttachment = jobAttachment || null;

  // Clear previous thread
  const thread = document.getElementById('messageThread');
  if (thread) thread.innerHTML = '';

  // Show attachment preview if sharing a job
  renderMessageAttachment();

  showElement('messagePanel');
  showElement('messageThreadLoading');

  // Wire send button
  const sendBtn = document.getElementById('sendMessageButton');
  if (sendBtn) {
    sendBtn.onclick = () => sendConversationMessage();
  }

  try {
    // Find existing conversation with this candidate, or create one
    activeConversationId = await findOrCreateConversation(candidateId, candidateName);
    await loadConversationMessages(activeConversationId);
  } catch (err) {
    console.error('[hired.video] openMessagePanel error:', err);
    if (thread) thread.innerHTML = '<div class="text-muted text-sm text-center p-2">Could not load messages.</div>';
  } finally {
    hideElement('messageThreadLoading');
  }
}

function closeMessagePanel() {
  hideElement('messagePanel');
  activeConversationId = null;
  activeRecipientId = null;
  pendingJobAttachment = null;
  const attachment = document.getElementById('messageAttachment');
  if (attachment) { attachment.innerHTML = ''; attachment.classList.add('hidden'); }
}

/**
 * Search inbox for an existing direct conversation with this user.
 * If none exists, create one.
 */
async function findOrCreateConversation(candidateId, candidateName) {
  // Fetch inbox
  const inboxRes = await apiFetch(messagesInboxUrl);
  if (!inboxRes.ok) throw new Error('Failed to load inbox');
  const inboxData = await inboxRes.json();
  const convos = inboxData.data || [];

  // Check each conversation for this participant
  for (const convo of convos) {
    if (convo.type !== 'direct') continue;
    try {
      const detailRes = await apiFetch(messagesConversationsUrl + '/' + convo.id);
      if (!detailRes.ok) continue;
      const detail = await detailRes.json();
      const participants = detail.data?.participants || [];
      const hasCandidate = participants.some(p => p.userId === candidateId);
      if (hasCandidate) return convo.id;
    } catch { /* skip */ }
  }

  // No existing conversation — create one
  const createRes = await apiFetch(messagesConversationsUrl, {
    method: 'POST',
    body: JSON.stringify({
      subject: 'Chat with ' + (candidateName || 'Candidate'),
      participantIds: [candidateId],
    }),
  });
  if (!createRes.ok) throw new Error('Failed to create conversation');
  const created = await createRes.json();
  return created.data?.id || created.id;
}

/**
 * Load and render the full message history for a conversation.
 */
async function loadConversationMessages(convoId) {
  const thread = document.getElementById('messageThread');
  if (!thread) return;

  const res = await apiFetch(messagesConversationsUrl + '/' + convoId);
  if (!res.ok) throw new Error('Failed to load messages');
  const data = await res.json();
  const msgs = data.data?.messages || [];

  // Mark as read
  apiFetch(messagesConversationsUrl + '/' + convoId + '/read', { method: 'PUT' }).catch(() => {});

  if (msgs.length === 0) {
    thread.innerHTML = '<div class="text-muted text-sm text-center p-2">No messages yet. Start the conversation!</div>';
    return;
  }

  // Messages come newest-first from the API — reverse for chronological
  const sorted = [...msgs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  thread.innerHTML = sorted.map(m => {
    const isMine = m.senderId === currentUserId;
    const time = formatMessageTime(m.createdAt);
    const content = renderMessageContent(m.content, m.contentType);
    return `
      <div class="message-row ${isMine ? 'message-sent' : 'message-received'}">
        <div class="message-bubble ${isMine ? 'message-out' : 'message-in'}">${content}</div>
        <div class="message-time text-xs text-muted">${time}</div>
      </div>
    `;
  }).join('');

  thread.scrollTop = thread.scrollHeight;
}

function renderMessageContent(content, contentType) {
  if (contentType === 'job_share') {
    try {
      const job = JSON.parse(content);
      return `
        <div class="shared-job-card">
          <div class="shared-job-icon">📌</div>
          <div class="shared-job-info">
            <div class="shared-job-title">${escapeHtml(job.title || 'Job Opportunity')}</div>
            <div class="shared-job-company">${escapeHtml([job.company, job.location].filter(Boolean).join(' · '))}</div>
            ${job.sourceUrl ? `<a href="${escapeHtml(job.sourceUrl)}" target="_blank" class="shared-job-link">View Job →</a>` : ''}
          </div>
        </div>
        ${job.message ? `<div class="mt-1">${escapeHtml(job.message)}</div>` : ''}
      `;
    } catch {
      return escapeHtml(content);
    }
  }
  return escapeHtml(content).replace(/\n/g, '<br>');
}

function formatMessageTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Send a message in the active conversation.
 */
async function sendConversationMessage() {
  if (!activeConversationId) return;

  const input = document.getElementById('messageInput');
  if (!input) return;

  let content = input.value.trim();
  let contentType = 'text';

  // If there's a job attachment, send it as a job_share message
  if (pendingJobAttachment) {
    const jobPayload = {
      ...pendingJobAttachment,
      message: content, // recruiter's personal note
    };
    content = JSON.stringify(jobPayload);
    contentType = 'job_share';
    pendingJobAttachment = null;
    const attachment = document.getElementById('messageAttachment');
    if (attachment) { attachment.innerHTML = ''; attachment.classList.add('hidden'); }
  }

  if (!content) return;
  input.value = '';

  // Optimistically append to thread
  const thread = document.getElementById('messageThread');
  // Clear the "no messages" placeholder
  const placeholder = thread?.querySelector('.text-muted.text-center');
  if (placeholder) placeholder.remove();

  if (thread) {
    const rendered = contentType === 'job_share' ? renderMessageContent(content, contentType) : escapeHtml(content).replace(/\n/g, '<br>');
    thread.innerHTML += `
      <div class="message-row message-sent">
        <div class="message-bubble message-out">${rendered}</div>
        <div class="message-time text-xs text-muted">Just now</div>
      </div>
    `;
    thread.scrollTop = thread.scrollHeight;
  }

  try {
    await apiFetch(messagesConversationsUrl + '/' + activeConversationId + '/send', {
      method: 'POST',
      body: JSON.stringify({ content, contentType }),
    });
  } catch (err) {
    console.error('[hired.video] sendMessage error:', err);
    showExtractionError('Failed to send message: ' + err.message);
  }
}

// ---- Message attachment preview -----------------------------------------

function renderMessageAttachment() {
  const el = document.getElementById('messageAttachment');
  if (!el) return;

  if (!pendingJobAttachment) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }

  const job = pendingJobAttachment;
  el.innerHTML = `
    <div class="attachment-preview">
      <div class="attachment-label">📌 Sharing job</div>
      <div class="attachment-title">${escapeHtml(job.title || 'Job')}</div>
      <div class="attachment-sub">${escapeHtml([job.company, job.location].filter(Boolean).join(' · '))}</div>
      <button class="attachment-remove" title="Remove attachment">✕</button>
    </div>
  `;
  el.classList.remove('hidden');

  el.querySelector('.attachment-remove')?.addEventListener('click', () => {
    pendingJobAttachment = null;
    el.innerHTML = '';
    el.classList.add('hidden');
  });
}

// ---- AI Personalize message ---------------------------------------------

async function handlePersonalizeMessage() {
  const input = document.getElementById('messageInput');
  if (!input) return;

  // Find the candidate info
  const candidate = talentPoolList.find(c => c.candidateId === activeRecipientId || c.id === activeRecipientId);
  if (!candidate) {
    input.placeholder = 'Could not find candidate details for personalization.';
    return;
  }

  const btn = document.getElementById('personalizeMessageButton');
  if (btn) { btn.disabled = true; btn.textContent = '✨ Generating...'; }

  try {
    // Get recruiter's name from profile chip
    const senderName = document.getElementById('profileName')?.textContent || 'Recruiter';

    const body = {
      recipientName: candidate.candidateName || 'Candidate',
      recipientTitle: candidate.candidateTitle || candidate.currentTitle || '',
      recipientCompany: candidate.currentCompany || '',
      jobTitle: pendingJobAttachment?.title || '',
      senderName,
      context: input.value.trim() || undefined,
      tone: 'professional',
    };

    const res = await apiFetch(messagesPersonalizeUrl, {
      method: 'POST',
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error('Personalization failed');
    const data = await res.json();
    const result = data.data || data;

    input.value = result.body || result.message || '';
    input.focus();
  } catch (err) {
    console.error('[hired.video] personalize error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Personalize'; }
  }
}

// ---- Share Job with Candidate -------------------------------------------

async function handleShareJob() {
  if (!detectedPageJob) {
    showExtractionError('No job detected on this page. Try clicking "Scan this page" first.');
    return;
  }

  // Ensure candidates are loaded
  if (talentPoolList.length === 0) {
    try {
      const res = await apiFetch(recruiterTalentPoolUrl);
      if (res.ok) {
        const data = await res.json();
        talentPoolList = data.data || [];
      }
    } catch { /* ignore */ }
  }

  // Show job preview in picker
  const preview = document.getElementById('shareJobPreview');
  if (preview) {
    preview.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <span class="extraction-icon">📌</span>
        <div>
          <div class="font-medium">${escapeHtml(detectedPageJob.title || 'Job')}</div>
          <div class="text-sm text-muted">${escapeHtml([detectedPageJob.company, detectedPageJob.location].filter(Boolean).join(' · '))}</div>
        </div>
      </div>
    `;
  }

  renderCandidatePickerList();
  showElement('candidatePickerPanel');
}

function renderCandidatePickerList(filter = '') {
  const container = document.getElementById('candidatePickerList');
  const empty = document.getElementById('candidatePickerEmpty');
  if (!container) return;

  let items = talentPoolList;
  if (filter) {
    const lc = filter.toLowerCase();
    items = items.filter(c =>
      (c.candidateName || '').toLowerCase().includes(lc) ||
      (c.candidateTitle || '').toLowerCase().includes(lc) ||
      (c.currentCompany || '').toLowerCase().includes(lc)
    );
  }

  if (items.length === 0) {
    container.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  container.innerHTML = items.map(c => `
    <div class="candidate-picker-item" data-candidate-id="${escapeHtml(c.candidateId || c.id)}" data-candidate-name="${escapeHtml(c.candidateName || '')}">
      <div>
        <div class="font-medium">${escapeHtml(c.candidateName || 'Unknown')}</div>
        <div class="text-sm text-muted">${escapeHtml(c.candidateTitle || c.currentTitle || '')}</div>
      </div>
      <button class="btn btn-primary btn-xs">📤 Share</button>
    </div>
  `).join('');

  // Wire click handlers
  container.querySelectorAll('.candidate-picker-item').forEach(el => {
    el.addEventListener('click', () => {
      const candidateId = el.dataset.candidateId;
      const candidateName = el.dataset.candidateName;
      selectCandidateForShare(candidateId, candidateName);
    });
  });
}

function selectCandidateForShare(candidateId, candidateName) {
  hideElement('candidatePickerPanel');

  const jobAttachment = {
    title: detectedPageJob?.title || '',
    company: detectedPageJob?.company || '',
    location: detectedPageJob?.location || '',
    sourceUrl: detectedPageJob?.sourceUrl || detectedPageJob?.applyUrl || '',
  };

  openMessagePanel(candidateId, candidateName, jobAttachment);
}
