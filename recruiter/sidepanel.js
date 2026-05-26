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
let detectedListView = null;
let extractionBusy = false;

// Talent pool cache
let talentPoolList = [];
let pipelineData = {};
let companiesList = [];
let matchScores = {};

// Tracked jobs (gap #677) — populated lazily when the Tracked tab opens
// or when a `tracked-job-changed` event fires from the web app.
let trackedJobsList = [];

// Most-recently-extracted candidate (drives the post-extraction quick
// actions: add-to-job, log activity, click-to-call, etc.). Holds the
// rowToTalentPoolEntry-shaped object returned by /extract-profile.
let lastExtractedCandidate = null;

// Lazily populated caches feeding the universal target picker (jobs,
// lists, sequences). Reloaded the first time each picker opens after a
// session start; subsequent opens reuse the cache to keep the side
// panel feeling instant.
let recruiterJobsList = [];
let recruiterListsCache = [];
let recruiterSequencesCache = [];

// Active picker config — set when one of the openAddToX helpers fires;
// drives the click handler on each row and the optional "Create new"
// inline form at the bottom.
let activeTargetPicker = null;

// Active candidate for the "Log activity" panel — set when the user opens
// the panel from either a detected-profile banner or a candidate detail.
let activeLogCandidate = null;

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
  callViaHiredVideo: false,    // PAID — gap #1359
  callerIdNumberId: '',        // companion to callViaHiredVideo
};
let settings = { ...DEFAULT_SETTINGS };

// Provisioned phone numbers — populated when the VoIP toggle is enabled
// so the dialer knows which number to call from.
let recruiterPhoneNumbers = [];

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
    showElement('profileUpgradeButton');
  } else {
    if (jobsToggle) jobsToggle.disabled = false;
    if (profileToggle) profileToggle.disabled = false;
    if (companyToggle) companyToggle.disabled = false;
    if (scoreToggle) scoreToggle.disabled = false;
    hideElement('autoDetectUpgrade');
    hideElement('profileUpgradeButton');
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

// Map each <input id> to the matching settings key. Used by both
// applySettingsToUI (read) and setupTabNavigation's change listener
// (write) so the two stay in sync.
const SETTING_TOGGLE_IDS = {
  settingAutoDetectJobs: 'autoDetectJobs',
  settingAutoDetectProfiles: 'autoDetectProfiles',
  settingAutoDetectCompanies: 'autoDetectCompanies',
  settingAutoScore: 'autoScore',
  settingCallViaHiredVideo: 'callViaHiredVideo',
};

function applySettingsToUI() {
  for (const [elId, key] of Object.entries(SETTING_TOGGLE_IDS)) {
    const el = document.getElementById(elId);
    if (el) el.checked = !!settings[key];
  }
  const callerIdSelect = document.getElementById('settingCallerIdNumber');
  if (callerIdSelect) callerIdSelect.value = settings.callerIdNumberId || '';
  applyVoipToggleVisibility();
}

function applyVoipToggleVisibility() {
  const row = document.getElementById('callerIdRow');
  if (!row) return;
  if (settings.callViaHiredVideo) {
    row.classList.remove('hidden');
    if (recruiterPhoneNumbers.length === 0) loadRecruiterPhoneNumbers();
  } else {
    row.classList.add('hidden');
  }
}

async function loadRecruiterPhoneNumbers() {
  try {
    const res = await apiFetch(phoneNumbersUrl);
    if (!res.ok) throw new Error('Failed to load phone numbers');
    const data = await res.json();
    recruiterPhoneNumbers = data.data?.numbers || data.data || [];
  } catch (err) {
    console.warn('[hired.video] loadRecruiterPhoneNumbers failed:', err);
    recruiterPhoneNumbers = [];
  }
  const select = document.getElementById('settingCallerIdNumber');
  if (!select) return;
  if (recruiterPhoneNumbers.length === 0) {
    select.innerHTML = '<option value="">No numbers yet — provision one on hired.video</option>';
    return;
  }
  select.innerHTML = recruiterPhoneNumbers
    .map((n) => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.phoneNumber || n.friendlyName || n.id)}</option>`)
    .join('');
  if (settings.callerIdNumberId) select.value = settings.callerIdNumberId;
  else if (recruiterPhoneNumbers[0]) {
    settings.callerIdNumberId = recruiterPhoneNumbers[0].id;
    saveSettings();
    select.value = settings.callerIdNumberId;
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
        callViaHiredVideo: !!settings.callViaHiredVideo,
        callerIdNumberId: settings.callerIdNumberId || '',
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
    if (message.type === 'tracked-job-changed') {
      // Saving/unsaving a job on hired.video should keep the recruiter
      // panel's Tracked tab in sync without a manual refresh. Gap #677.
      loadTrackedJobs();
    }
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

  // Settings toggles — driven by the shared SETTING_TOGGLE_IDS mapping
  // so a new toggle only needs to be added in one place.
  for (const [id, key] of Object.entries(SETTING_TOGGLE_IDS)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
      if (key === 'callViaHiredVideo') applyVoipToggleVisibility();
    });
  }

  // Caller-ID dropdown is keyed but not in SETTING_TOGGLE_IDS (it's a
  // select, not a checkbox).
  const callerIdSelect = document.getElementById('settingCallerIdNumber');
  if (callerIdSelect) {
    callerIdSelect.addEventListener('change', () => {
      settings.callerIdNumberId = callerIdSelect.value;
      saveSettings();
    });
  }

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
  ['profileUpgradeButton', 'upgradeAutoDetectButton'].forEach((id) => {
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

  // Interactive picker buttons (gap #946) — three modes share the same
  // launcher; the button's data-picker-mode drives the mode parameter.
  document.querySelectorAll('[data-picker-mode]').forEach((el) => {
    el.addEventListener('click', () => launchPicker(el.dataset.pickerMode || 'job'));
  });

  // Extract buttons
  const extractJob = document.getElementById('extractJobButton');
  if (extractJob) extractJob.addEventListener('click', handleExtractJob);

  const extractProfile = document.getElementById('extractProfileButton');
  if (extractProfile) extractProfile.addEventListener('click', handleExtractProfile);

  const extractCompany = document.getElementById('extractCompanyButton');
  if (extractCompany) extractCompany.addEventListener('click', handleExtractCompany);

  // Bulk capture from search-result list views (gap #1358).
  const bulkCapture = document.getElementById('bulkCaptureButton');
  if (bulkCapture) bulkCapture.addEventListener('click', handleBulkCapture);

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

  // Tracked-jobs search (gap #677)
  const trackedJobsSearch = document.getElementById('trackedJobsSearch');
  if (trackedJobsSearch) {
    trackedJobsSearch.addEventListener('input', () => {
      renderTrackedJobs(trackedJobsSearch.value.trim());
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

  // Universal target picker (add-to-job / list / call-queue / sequence)
  const closeTargetPicker = document.getElementById('closeTargetPickerPanel');
  if (closeTargetPicker) {
    closeTargetPicker.addEventListener('click', () => hideElement('targetPickerPanel'));
  }
  const targetPickerSearch = document.getElementById('targetPickerSearch');
  if (targetPickerSearch) {
    targetPickerSearch.addEventListener('input', () => renderTargetPickerList(targetPickerSearch.value.trim()));
  }
  const targetPickerCreate = document.getElementById('targetPickerCreateButton');
  if (targetPickerCreate) {
    targetPickerCreate.addEventListener('click', handleTargetPickerCreate);
  }

  // Log-interaction panel
  const closeLogInteraction = document.getElementById('closeLogInteractionPanel');
  if (closeLogInteraction) {
    closeLogInteraction.addEventListener('click', () => hideElement('logInteractionPanel'));
  }
  const saveLogInteraction = document.getElementById('saveLogInteractionButton');
  if (saveLogInteraction) {
    saveLogInteraction.addEventListener('click', handleSaveLogInteraction);
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
    case 'tracked':
      loadTrackedJobs();
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
    if (msg.action === 'listViewDetected' && isPro && settings.autoDetectProfiles) {
      detectedListView = msg.payload;
      showListViewDetectedBanner(msg.payload);
    }
    if (msg.action === 'listViewCleared') {
      detectedListView = null;
      hideElement('listViewDetectedBanner');
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

function showListViewDetectedBanner(payload) {
  const el = document.getElementById('listViewDetectedBanner');
  const title = document.getElementById('listViewDetectedTitle');
  const sub = document.getElementById('listViewDetectedSub');
  if (title) title.textContent = `${payload.count} candidates on this page`;
  if (sub) sub.textContent = payload.host || '';
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
  detectedListView = null;
  hideElement('jobDetectedBanner');
  hideElement('profileDetectedBanner');
  hideElement('companyDetectedBanner');
  hideElement('listViewDetectedBanner');
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
    lastExtractedCandidate = profile.talentPoolCandidate || null;
    showExtractionSuccess('profile', profile);

    // Auto-log the capture as a "sourcing" interaction so the activity
    // timeline reflects the action — matches Loxo Boost's "Auto-logging
    // of all extension activities back to candidate profiles."
    if (lastExtractedCandidate?.id) {
      autoLogInteraction(lastExtractedCandidate.id, {
        type: 'sourcing',
        subject: 'Captured from ' + extractHost(response?.originUrl || ''),
        notes: 'Profile extracted via Chrome extension.',
      });
    }

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

// ---- Bulk capture (search-results list views) --------------------------
//
// Loxo-Boost-parity flow: when the recruiter is on a LinkedIn / Indeed /
// GitHub search-result page, the content script reports the visible card
// count via `listViewDetected`; clicking the button below ships up to 25
// card HTMLs to `/api/recruiter/extract-profiles/batch` which runs each
// through the same pipeline as the single endpoint.

async function handleBulkCapture() {
  if (extractionBusy) return;
  if (!detectedListView) {
    showExtractionError('No search-result list detected on this page.');
    return;
  }

  extractionBusy = true;
  showElement('extractionLoading');
  const loadingText = document.getElementById('extractionLoadingText');
  if (loadingText) loadingText.textContent = `Capturing ${detectedListView.count} candidates...`;

  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getListCardsHTML', limit: 25 }, resolve);
    });

    const cards = response?.cards || [];
    if (cards.length === 0) {
      throw new Error('Could not read profile cards from the page.');
    }

    const res = await apiFetch(recruiterExtractProfilesBatchUrl, {
      method: 'POST',
      body: JSON.stringify({ sourceUrl: response.originUrl || window.location.href, cards }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Bulk capture failed');

    const result = data.data;
    showBulkExtractionSummary(result);

    // Reset the cache so the recruiter sees the new candidates after switching.
    if (currentTab === 'candidates') loadCandidates();
  } catch (err) {
    showExtractionError('Bulk capture failed: ' + err.message);
  } finally {
    extractionBusy = false;
    hideElement('extractionLoading');
  }
}

function showBulkExtractionSummary(result) {
  const container = document.getElementById('extractionResultContent');
  if (!container) return;
  container.innerHTML = `
    <div class="extraction-success">
      <div class="d-flex align-items-center gap-2">
        <span class="extraction-icon">📋</span>
        <div>
          <div class="font-medium">Captured ${result.created} new · ${result.duplicates} duplicate · ${result.failed} failed</div>
          <div class="text-sm text-muted">Switch to the Candidates tab to view, tag, or submit them to a job.</div>
        </div>
      </div>
    </div>
  `;
  showElement('extractionResult');
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
    const candidateId = data.talentPoolCandidate?.id || profile.talentPoolCandidateId;
    const contactCard = renderContactCard(extracted.contactInfo || {}, candidateId);
    const tagChips = renderTagChips(data.talentPoolCandidate?.tags || extracted.skills || []);
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
        ${contactCard}
        ${tagChips ? `<div class="mt-2">${tagChips}</div>` : ''}
        ${renderCandidateActions(candidateId)}
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

  // Wire the post-extraction quick actions for the profile success card.
  // Same `data-action` convention is reused by candidate detail and the
  // detected-profile banner, so a single delegated listener (below) covers
  // all three surfaces.
}

function showExtractionError(message) {
  const container = document.getElementById('extractionResultContent');
  if (!container) return;
  container.innerHTML = `<div class="alert alert-error">${escapeHtml(message)}</div>`;
  showElement('extractionResult');
}

// ---- Contact info + quick actions (Loxo Boost parity) ------------------

/**
 * Render the contact info card surfaced on the extraction-success panel
 * and the candidate-detail slideout. Click-to-call / mailto / SMS / social
 * links match what Loxo Boost surfaces from a captured profile — but the
 * native handlers go through the OS so there's no separate VoIP licence
 * to pay for.
 *
 * `candidateId` is optional — when present, clicks also auto-log an
 * `interaction` row so the activity timeline reflects every outreach
 * attempt without manual entry.
 */
function renderContactCard(contactInfo, candidateId) {
  const ci = contactInfo || {};
  const rows = [];
  if (ci.email) {
    rows.push(`<a class="contact-link" href="mailto:${escapeHtml(ci.email)}" data-contact-action="email" data-contact-id="${escapeHtml(candidateId || '')}">📧 ${escapeHtml(ci.email)}</a>`);
  }
  if (ci.phone) {
    const telHref = ci.phone.replace(/[^+0-9]/g, '');
    rows.push(`<a class="contact-link" href="tel:${escapeHtml(telHref)}" data-contact-action="call" data-contact-id="${escapeHtml(candidateId || '')}">📞 ${escapeHtml(ci.phone)}</a>`);
    rows.push(`<a class="contact-link" href="sms:${escapeHtml(telHref)}" data-contact-action="sms" data-contact-id="${escapeHtml(candidateId || '')}">💬 Text</a>`);
  }
  if (ci.linkedin) {
    rows.push(`<a class="contact-link" href="${escapeHtml(ci.linkedin)}" target="_blank" rel="noopener">in LinkedIn</a>`);
  }
  if (ci.github) {
    rows.push(`<a class="contact-link" href="${escapeHtml(ci.github)}" target="_blank" rel="noopener">⌨️ GitHub</a>`);
  }
  if (ci.twitter) {
    rows.push(`<a class="contact-link" href="${escapeHtml(ci.twitter)}" target="_blank" rel="noopener">𝕏 X</a>`);
  }
  if (ci.website) {
    rows.push(`<a class="contact-link" href="${escapeHtml(ci.website)}" target="_blank" rel="noopener">🌐 Site</a>`);
  }

  if (rows.length === 0) {
    return '<div class="text-xs text-muted mt-2">No contact info found on the page — try refreshing or scrolling so the email / phone / social links are loaded.</div>';
  }

  return `
    <div class="contact-card mt-2">
      <div class="text-xs text-muted contact-card-label">Contact</div>
      <div class="contact-card-rows">${rows.join('')}</div>
    </div>
  `;
}

/**
 * Render the post-capture action row shown on both the extraction-success
 * card and the candidate-detail slide-out. One place to add a new action
 * (e.g. "Send SMS") and it appears in every surface that already has a
 * resolved candidate. The delegated `data-action` click handler upstream
 * makes each button self-routing.
 *
 * Pass `extras` to inject surface-specific buttons (e.g. "Message" /
 * "Score Jobs") only available where a full candidate identity is known.
 */
function renderCandidateActions(candidateId, extras = '') {
  if (!candidateId) return '';
  return `
    <div class="d-flex gap-1 flex-wrap mt-2">
      ${extras}
      <button class="btn btn-primary btn-xs" data-action="add-to-job">📌 Add to job</button>
      <button class="btn btn-outline btn-xs" data-action="add-to-list">📋 Add to list</button>
      <button class="btn btn-outline btn-xs" data-action="add-to-call-queue">☎️ Call queue</button>
      <button class="btn btn-outline btn-xs" data-action="enroll-in-sequence">▶️ Sequence</button>
      <button class="btn btn-outline btn-xs" data-action="log-activity">📝 Log</button>
      <button class="btn btn-outline btn-xs" data-action="view-candidate">👁️ View</button>
    </div>
  `;
}

function renderTagChips(tags) {
  const items = Array.isArray(tags) ? tags : [];
  if (items.length === 0) return '';
  return items
    .slice(0, 8)
    .map((t) => `<span class="tag">${escapeHtml(String(t))}</span>`)
    .join(' ');
}

function extractHost(url) {
  if (!url) return 'this page';
  try { return new URL(url).hostname; } catch { return 'this page'; }
}

/**
 * POST /api/recruiter/interactions silently — used as a fire-and-forget
 * auto-log so the recruiter doesn't have to remember to file a note for
 * every action.
 */
async function autoLogInteraction(candidateRowId, { type, subject, notes }) {
  try {
    await apiFetch(recruiterInteractionsUrl, {
      method: 'POST',
      body: JSON.stringify({
        talentPoolId: candidateRowId,
        interactionType: type,
        subject: subject || '',
        notes: notes || '',
        interactionDate: new Date().toISOString(),
        requiresFollowUp: false,
      }),
    });
  } catch (err) {
    console.warn('[hired.video] autoLogInteraction failed:', err);
  }
}

/**
 * Delegated click handler for all quick-action buttons and contact-link
 * rows. Lives at the document level so it covers the extraction card,
 * the candidate-detail slide-out, and the detected-profile banner without
 * each one wiring its own onclick.
 */
document.addEventListener('click', (e) => {
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    const action = actionBtn.dataset.action;
    if (action === 'add-to-job') {
      e.preventDefault();
      openAddToJobPanel(lastExtractedCandidate);
      return;
    }
    if (action === 'add-to-list') {
      e.preventDefault();
      openAddToListPanel(lastExtractedCandidate, 'list');
      return;
    }
    if (action === 'add-to-call-queue') {
      e.preventDefault();
      openAddToListPanel(lastExtractedCandidate, 'call_queue');
      return;
    }
    if (action === 'enroll-in-sequence') {
      e.preventDefault();
      openEnrollInSequencePanel(lastExtractedCandidate);
      return;
    }
    if (action === 'log-activity') {
      e.preventDefault();
      openLogInteractionPanel(lastExtractedCandidate);
      return;
    }
    if (action === 'score-candidates-for-tracked-job') {
      e.preventDefault();
      triggerBackgroundScoring('candidates', actionBtn.dataset.jobId);
      consoleAlerts('Scoring candidates against this job...');
      return;
    }
    if (action === 'view-candidate' && lastExtractedCandidate?.id) {
      e.preventDefault();
      switchTab('candidates');
      loadCandidates().then(() => viewCandidateDetail(lastExtractedCandidate.id));
      return;
    }
  }

  const contactLink = e.target.closest('[data-contact-action]');
  if (contactLink) {
    const channel = contactLink.dataset.contactAction;
    const candidateRowId = contactLink.dataset.contactId;

    // VoIP route (gap #1359): if the recruiter has "Call via hired.video"
    // enabled and this is a phone-call click, intercept and place the
    // call through SignalWire so it lands in `call_logs` with a
    // recording instead of dropping out to the OS dialer.
    if (channel === 'call' && settings.callViaHiredVideo && settings.callerIdNumberId) {
      e.preventDefault();
      const href = contactLink.getAttribute('href') || '';
      const to = href.replace(/^tel:/, '').trim();
      placeBusinessCall(to, candidateRowId);
      return;
    }

    if (candidateRowId) {
      autoLogInteraction(candidateRowId, {
        type: channel,
        subject: `Outreach via ${channel}`,
        notes: 'Initiated from Chrome extension.',
      });
    }
    // Don't preventDefault — let the OS handle mailto:/tel:/sms:.
  }
});

async function placeBusinessCall(to, candidateRowId) {
  if (!to) return;
  try {
    const res = await apiFetch(phoneCallUrl, {
      method: 'POST',
      body: JSON.stringify({
        phoneNumberId: settings.callerIdNumberId,
        to,
        record: true,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Call failed');
    if (candidateRowId) {
      autoLogInteraction(candidateRowId, {
        type: 'call',
        subject: 'Outbound call (recorded)',
        notes: `Placed via hired.video business line (call SID ${data.data?.sid ?? data.sid ?? ''}).`,
      });
    }
    showCallStatusBanner('Calling ' + to + '...', 'info');
  } catch (err) {
    showCallStatusBanner('Call failed: ' + err.message, 'error');
  }
}

function showCallStatusBanner(message, kind) {
  const container = document.getElementById('extractionResultContent');
  if (!container) return;
  const cls = kind === 'error' ? 'alert-error' : 'alert-info';
  container.innerHTML = `<div class="alert ${cls}">${escapeHtml(message)}</div>`;
  showElement('extractionResult');
}

// ---- Universal target picker ------------------------------------------
//
// One slide-out panel covers every "drop this candidate somewhere" flow:
//   - Add to job        (POST /api/recruiter/submissions)
//   - Add to list       (POST /api/recruiter/lists/:id/members)
//   - Add to call queue (same endpoint, kind=call_queue)
//   - Enroll in sequence (POST /api/recruiter/sequences/:id/enroll)
//
// Each opener registers a `config` describing how to fetch the targets,
// render one row, submit the selection, and (optionally) create a new
// target inline. The panel HTML lives once in sidepanel-global.html.

async function openTargetPicker(config) {
  if (!config?.candidate?.id) {
    showExtractionError('No candidate selected. Extract a profile first.');
    return;
  }
  activeTargetPicker = config;

  const titleEl = document.getElementById('targetPickerTitle');
  if (titleEl) titleEl.textContent = config.title;

  const search = document.getElementById('targetPickerSearch');
  if (search) {
    search.placeholder = config.searchPlaceholder || 'Filter…';
    search.value = '';
  }

  const empty = document.getElementById('targetPickerEmpty');
  if (empty) empty.textContent = config.emptyText || 'Nothing here yet.';

  const createCard = document.getElementById('targetPickerCreate');
  if (createCard) {
    if (config.createPlaceholder) {
      createCard.classList.remove('hidden');
      const label = document.getElementById('targetPickerCreateLabel');
      if (label) label.textContent = config.createPlaceholder.label;
      const input = document.getElementById('targetPickerCreateName');
      if (input) input.value = '';
    } else {
      createCard.classList.add('hidden');
    }
  }

  const preview = document.getElementById('targetPickerCandidatePreview');
  if (preview) {
    const candidate = config.candidate;
    preview.innerHTML = `
      <div class="d-flex align-items-center gap-2">
        <span class="extraction-icon">👤</span>
        <div>
          <div class="font-medium">${escapeHtml(candidate.candidateName || 'Candidate')}</div>
          <div class="text-sm text-muted">${escapeHtml(candidate.candidateTitle || candidate.currentTitle || '')} ${candidate.currentCompany ? '· ' + escapeHtml(candidate.currentCompany) : ''}</div>
        </div>
      </div>
    `;
  }

  showElement('targetPickerPanel');
  showElement('targetPickerLoading');
  hideElement('targetPickerEmpty');

  try {
    activeTargetPicker.items = await config.loadItems();
  } catch (err) {
    activeTargetPicker.items = [];
    console.error('[hired.video] target picker load error:', err);
  }

  hideElement('targetPickerLoading');
  renderTargetPickerList();
}

function renderTargetPickerList(filter = '') {
  if (!activeTargetPicker) return;
  const container = document.getElementById('targetPickerList');
  const empty = document.getElementById('targetPickerEmpty');
  if (!container) return;

  let items = activeTargetPicker.items || [];
  if (filter && activeTargetPicker.filterItem) {
    items = items.filter((i) => activeTargetPicker.filterItem(i, filter.toLowerCase()));
  }

  if (items.length === 0) {
    container.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  container.innerHTML = items.map((item, idx) => `
    <div class="candidate-picker-item" data-picker-idx="${idx}">
      ${activeTargetPicker.renderItem(item)}
    </div>
  `).join('');

  container.querySelectorAll('.candidate-picker-item').forEach((el) => {
    el.addEventListener('click', async () => {
      const idx = Number(el.dataset.pickerIdx);
      const item = activeTargetPicker.items[idx];
      try {
        const result = await activeTargetPicker.submitItem(item);
        hideElement('targetPickerPanel');
        if (activeTargetPicker.onSuccess) activeTargetPicker.onSuccess(item, result);
      } catch (err) {
        showExtractionError(activeTargetPicker.errorPrefix + ': ' + err.message);
      }
    });
  });
}

async function handleTargetPickerCreate() {
  if (!activeTargetPicker?.createPlaceholder) return;
  const input = document.getElementById('targetPickerCreateName');
  const name = (input?.value || '').trim();
  if (!name) return;
  try {
    const created = await activeTargetPicker.createPlaceholder.create(name);
    activeTargetPicker.items = [created, ...(activeTargetPicker.items || [])];
    if (input) input.value = '';
    renderTargetPickerList();
  } catch (err) {
    showExtractionError('Could not create: ' + err.message);
  }
}

// ---- Add to job ---------------------------------------------------------

async function loadRecruiterJobs() {
  try {
    const res = await apiFetch(userJobsUrl);
    if (!res.ok) throw new Error('Failed to load jobs');
    const data = await res.json();
    recruiterJobsList = (data.data || data || []).filter((j) => {
      const status = (j.status || j.jobStatus || '').toLowerCase();
      return !status || status === 'open' || status === 'active' || status === 'published';
    });
  } catch (err) {
    console.error('[hired.video] loadRecruiterJobs error:', err);
    recruiterJobsList = [];
  }
  return recruiterJobsList;
}

function openAddToJobPanel(candidate) {
  openTargetPicker({
    candidate,
    title: 'Add candidate to a job',
    searchPlaceholder: 'Filter your open jobs…',
    emptyText: 'No open jobs yet. Post a job from hired.video first.',
    errorPrefix: 'Failed to submit candidate',
    loadItems: async () => {
      if (recruiterJobsList.length === 0) await loadRecruiterJobs();
      return recruiterJobsList;
    },
    filterItem: (j, lc) =>
      (j.title || j.jobTitle || '').toLowerCase().includes(lc) ||
      (j.company || j.companyName || '').toLowerCase().includes(lc) ||
      (j.location || '').toLowerCase().includes(lc),
    renderItem: (j) => `
      <div>
        <div class="font-medium">${escapeHtml(j.title || j.jobTitle || 'Untitled job')}</div>
        <div class="text-sm text-muted">${escapeHtml(j.company || j.companyName || '')} ${j.location ? '· ' + escapeHtml(j.location) : ''}</div>
      </div>
      <button class="btn btn-primary btn-xs">📌 Submit</button>
    `,
    submitItem: async (j) => {
      const res = await apiFetch(recruiterSubmissionsUrl, {
        method: 'POST',
        body: JSON.stringify({
          jobId: j.id,
          candidateName: candidate.candidateName || 'Candidate',
          candidateEmail: candidate.candidateEmail || '',
          jobTitle: j.title || j.jobTitle || '',
          companyName: j.company || j.companyName || '',
          recruiterNotes: 'Submitted from Chrome extension.',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Submission failed');
      return data.data;
    },
    onSuccess: (j) => {
      if (candidate.id) {
        autoLogInteraction(candidate.id, {
          type: 'submission',
          subject: `Submitted to ${j.title || j.jobTitle || 'a job'}`,
          notes: `Submitted to ${j.company || j.companyName || ''} via Chrome extension.`,
        });
      }
      showExtractionSuccess('job', {
        title: j.title || j.jobTitle,
        company: j.company || j.companyName,
        submitted: true,
      });
    },
  });
}

// ---- Add to list / call queue (gap #1360) -----------------------------

async function loadRecruiterLists(kind) {
  try {
    const res = await apiFetch(recruiterListsUrl);
    if (!res.ok) throw new Error('Failed to load lists');
    const data = await res.json();
    recruiterListsCache = data.data || data || [];
  } catch (err) {
    console.error('[hired.video] loadRecruiterLists error:', err);
    recruiterListsCache = [];
  }
  return recruiterListsCache.filter((l) => (l.kind || 'list') === kind);
}

function openAddToListPanel(candidate, kind = 'list') {
  const niceName = kind === 'call_queue' ? 'call queue' : 'list';
  openTargetPicker({
    candidate,
    title: `Add candidate to a ${niceName}`,
    searchPlaceholder: `Filter your ${niceName}s…`,
    emptyText: `No ${niceName}s yet — create one below.`,
    errorPrefix: `Failed to add to ${niceName}`,
    loadItems: () => loadRecruiterLists(kind),
    filterItem: (l, lc) =>
      (l.name || '').toLowerCase().includes(lc) ||
      (l.description || '').toLowerCase().includes(lc),
    renderItem: (l) => `
      <div>
        <div class="font-medium">${escapeHtml(l.name)}</div>
        <div class="text-sm text-muted">${escapeHtml(l.description || '')}</div>
      </div>
      <button class="btn btn-primary btn-xs">➕ Add</button>
    `,
    submitItem: async (l) => {
      const res = await apiFetch(`${recruiterListsUrl}/${encodeURIComponent(l.id)}/members`, {
        method: 'POST',
        body: JSON.stringify({ talentPoolCandidateId: candidate.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Add failed');
      return data.data;
    },
    createPlaceholder: {
      label: `Or create a new ${niceName}`,
      create: async (name) => {
        const res = await apiFetch(recruiterListsUrl, {
          method: 'POST',
          body: JSON.stringify({ name, kind }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || 'Create failed');
        recruiterListsCache = [data.data, ...recruiterListsCache];
        return data.data;
      },
    },
    onSuccess: (l) => {
      if (candidate.id) {
        autoLogInteraction(candidate.id, {
          type: kind === 'call_queue' ? 'queued_for_call' : 'added_to_list',
          subject: `Added to ${niceName}: ${l.name}`,
          notes: 'Via Chrome extension.',
        });
      }
    },
  });
}

// ---- Enroll in sequence (gap #1357) -----------------------------------

async function loadRecruiterSequences() {
  try {
    const res = await apiFetch(recruiterSequencesUrl);
    if (!res.ok) throw new Error('Failed to load sequences');
    const data = await res.json();
    recruiterSequencesCache = (data.data || data || []).filter((s) => s.isActive !== false);
  } catch (err) {
    console.error('[hired.video] loadRecruiterSequences error:', err);
    recruiterSequencesCache = [];
  }
  return recruiterSequencesCache;
}

function openEnrollInSequencePanel(candidate) {
  openTargetPicker({
    candidate,
    title: 'Enroll in outreach sequence',
    searchPlaceholder: 'Filter sequences…',
    emptyText: 'No sequences yet — author one on hired.video, then it shows up here.',
    errorPrefix: 'Failed to enroll',
    loadItems: () => loadRecruiterSequences(),
    filterItem: (s, lc) =>
      (s.name || '').toLowerCase().includes(lc) ||
      (s.description || '').toLowerCase().includes(lc),
    renderItem: (s) => {
      const stepCount = Array.isArray(s.steps) ? s.steps.length : 0;
      return `
        <div>
          <div class="font-medium">${escapeHtml(s.name)}</div>
          <div class="text-sm text-muted">${stepCount} step${stepCount === 1 ? '' : 's'} · ${escapeHtml(s.description || '')}</div>
        </div>
        <button class="btn btn-primary btn-xs">▶️ Enroll</button>
      `;
    },
    submitItem: async (s) => {
      const res = await apiFetch(`${recruiterSequencesUrl}/${encodeURIComponent(s.id)}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ talentPoolCandidateId: candidate.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Enroll failed');
      return data.data;
    },
    onSuccess: (s) => {
      if (candidate.id) {
        autoLogInteraction(candidate.id, {
          type: 'sequence_enrollment',
          subject: `Enrolled in ${s.name}`,
          notes: 'Via Chrome extension.',
        });
      }
    },
  });
}

// ---- Log interaction panel ---------------------------------------------

function openLogInteractionPanel(candidate) {
  if (!candidate?.id) {
    showExtractionError('No candidate selected.');
    return;
  }
  activeLogCandidate = candidate;

  const titleEl = document.getElementById('logInteractionTitle');
  if (titleEl) titleEl.textContent = 'Log activity — ' + (candidate.candidateName || 'Candidate');

  const subj = document.getElementById('logInteractionSubject');
  const notes = document.getElementById('logInteractionNotes');
  const type = document.getElementById('logInteractionType');
  const followUp = document.getElementById('logInteractionFollowUp');
  if (subj) subj.value = '';
  if (notes) notes.value = '';
  if (type) type.value = 'call';
  if (followUp) followUp.checked = false;

  showElement('logInteractionPanel');
}

async function handleSaveLogInteraction() {
  if (!activeLogCandidate?.id) return;

  const type = document.getElementById('logInteractionType')?.value || 'note';
  const subject = document.getElementById('logInteractionSubject')?.value?.trim() || '';
  const notes = document.getElementById('logInteractionNotes')?.value?.trim() || '';
  const followUp = !!document.getElementById('logInteractionFollowUp')?.checked;

  try {
    const res = await apiFetch(recruiterInteractionsUrl, {
      method: 'POST',
      body: JSON.stringify({
        talentPoolId: activeLogCandidate.id,
        interactionType: type,
        subject,
        notes,
        interactionDate: new Date().toISOString(),
        requiresFollowUp: followUp,
      }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error?.message || 'Failed to log activity');
    }
    hideElement('logInteractionPanel');
  } catch (err) {
    showExtractionError('Could not log activity: ' + err.message);
  }
}

// ---- Tag editor (inline on candidate detail) ---------------------------

async function updateCandidateTags(candidateRowId, tags) {
  try {
    const res = await apiFetch(recruiterTalentPoolUrl + '/' + candidateRowId, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    });
    if (!res.ok) throw new Error('Failed to update tags');
    // Update local cache so the candidate list reflects the new tags
    // immediately, without a full reload.
    const idx = talentPoolList.findIndex((c) => c.id === candidateRowId);
    if (idx >= 0) talentPoolList[idx] = { ...talentPoolList[idx], tags };
  } catch (err) {
    console.error('[hired.video] updateCandidateTags error:', err);
  }
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

  // Set this as the active candidate for the post-extraction quick-action
  // buttons (Add to job, Log activity, contact-link auto-logging).
  lastExtractedCandidate = candidate;

  const nameEl = document.getElementById('candidateDetailName');
  if (nameEl) nameEl.textContent = candidate.candidateName || 'Candidate';

  const contactInfo = candidate.contactInfo || {
    email: candidate.candidateEmail || '',
    phone: candidate.candidatePhone || '',
    linkedin: candidate.linkedinUrl || '',
  };
  const contactCard = renderContactCard(contactInfo, candidate.id);
  const tagChips = renderTagChips(candidate.tags || []);

  const content = document.getElementById('candidateDetailContent');
  if (content) {
    content.innerHTML = `
      <div class="card">
        <div class="font-medium">${escapeHtml(candidate.candidateName || '')}</div>
        <div class="text-sm">${escapeHtml(candidate.candidateTitle || candidate.currentTitle || '')}</div>
        <div class="text-sm text-muted">${escapeHtml(candidate.currentCompany || '')}</div>
        ${candidate.preferredLocations ? `<div class="text-sm">📍 ${escapeHtml(candidate.preferredLocations)}</div>` : ''}
        ${contactCard}
      </div>
      <div class="card">
        <h4 class="card-title">Tags</h4>
        <div id="candidateTagsRow">${tagChips || '<span class="text-xs text-muted">No tags yet.</span>'}</div>
        <div class="d-flex gap-1 mt-2">
          <input id="candidateTagInput" type="text" class="form-control form-control-sm" placeholder="Add a tag (press Enter)">
        </div>
      </div>
      <div class="card">
        <h4 class="card-title">Notes</h4>
        <div class="text-sm">${escapeHtml(candidate.notes || 'No notes yet.')}</div>
      </div>
      <div class="card">
        <h4 class="card-title">Match Scores</h4>
        <div id="candidateScores" class="text-sm text-muted">Loading scores...</div>
      </div>
      ${renderCandidateActions(candidate.id, `
        <button class="btn btn-primary btn-xs" data-action="message-candidate">💬 Message</button>
        <button class="btn btn-outline btn-xs" data-action="score-jobs">📊 Score Jobs</button>
      `)}
    `;

    // Wire the candidate-detail-only actions that need the candidate
    // identity in closure (Message / Score Jobs aren't covered by the
    // global delegated handler because they need this candidate's id).
    content.querySelector('[data-action="message-candidate"]')
      ?.addEventListener('click', () => openMessagePanel(candidateId, candidate.candidateName || ''));
    content.querySelector('[data-action="score-jobs"]')
      ?.addEventListener('click', () => scoreCandidateJobs(candidateId));

    // Inline tag editor — press Enter to add, click a chip to remove.
    const tagInput = content.querySelector('#candidateTagInput');
    tagInput?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const value = tagInput.value.trim();
      if (!value) return;
      const next = [...(candidate.tags || []), value];
      candidate.tags = next;
      updateCandidateTags(candidate.id, next);
      tagInput.value = '';
      const row = content.querySelector('#candidateTagsRow');
      if (row) row.innerHTML = renderTagChips(next) || '<span class="text-xs text-muted">No tags yet.</span>';
    });
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

// ---- Tracked jobs tab (gap #677) ---------------------------------------
//
// Recruiter-side companion to the jobseeker tracked-jobs surface. The
// recruiter saves jobs on hired.video that they want to source against;
// this tab keeps those visible inside the side panel so they don't have
// to bounce between web + extension. `tracked-job-changed` webAppEvents
// keep it live.

async function loadTrackedJobs() {
  showElement('trackedJobsLoading');
  hideElement('trackedJobsEmpty');
  try {
    const res = await apiFetch(jobsSavedUrl);
    if (!res.ok) throw new Error('Failed to load tracked jobs');
    const data = await res.json();
    const items = data?.data?.items || data?.data || data?.items || [];
    trackedJobsList = Array.isArray(items) ? items : [];
    renderTrackedJobs();
  } catch (err) {
    console.error('[hired.video] loadTrackedJobs error:', err);
    showElement('trackedJobsEmpty');
  } finally {
    hideElement('trackedJobsLoading');
  }
}

function renderTrackedJobs(filter = '') {
  const container = document.getElementById('trackedJobsList');
  const badge = document.getElementById('trackedJobsCountBadge');
  if (!container) return;

  let items = trackedJobsList;
  if (filter) {
    const lc = filter.toLowerCase();
    items = items.filter((j) =>
      (j.title || '').toLowerCase().includes(lc) ||
      (j.company || '').toLowerCase().includes(lc) ||
      (j.location || '').toLowerCase().includes(lc),
    );
  }

  if (badge) {
    badge.textContent = String(trackedJobsList.length);
    badge.classList.toggle('hidden', trackedJobsList.length === 0);
  }

  if (items.length === 0) {
    container.innerHTML = '';
    showElement('trackedJobsEmpty');
    return;
  }
  hideElement('trackedJobsEmpty');

  container.innerHTML = items.map((j) => {
    const id = j.id || j.Id || '';
    const title = escapeHtml(j.title || 'Untitled job');
    const meta = escapeHtml([j.company, j.location].filter(Boolean).join(' • '));
    const sourceUrl = j.sourceUrl || j.applyUrl || '';
    return `
      <div class="card tracked-job-card" data-job-id="${escapeHtml(id)}">
        <div class="d-flex align-items-center justify-between gap-2">
          <div>
            <div class="font-medium">${title}</div>
            <div class="text-sm text-muted">${meta}</div>
          </div>
          <div class="d-flex gap-1">
            ${sourceUrl ? `<a class="btn btn-outline btn-xs" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener">↗ Open</a>` : ''}
            <button class="btn btn-outline btn-xs" data-action="score-candidates-for-tracked-job" data-job-id="${escapeHtml(id)}">📊 Score</button>
          </div>
        </div>
      </div>
    `;
  }).join('');
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

// =====================================================================
// Interactive picker (gap #946) — recruiter-side parity with jobseeker.
// Three modes (job / profile / company) share one launcher; the mode is
// stamped onto the active tab as a window global before the picker
// content script runs, then echoed back in the pickerResult payload so
// we know which extraction endpoint to route to.
// =====================================================================

async function launchPicker(mode = 'job') {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (!tab || !tab.id || (tab.url && tab.url.startsWith('chrome://'))) {
        consoleAlerts("Open a webpage first — picker can't run on chrome:// URLs.");
        resolve(false);
        return;
      }
      // Stage 1: stamp the mode onto the page before the bundled picker
      // boots, so its `PICKER_MODE` constant resolves correctly.
      chrome.scripting.executeScript(
        {
          target: { tabId: tab.id },
          func: (m) => { window.__HIRED_VIDEO_PICKER_MODE__ = m; },
          args: [mode],
        },
        () => {
          if (chrome.runtime.lastError) {
            consoleAlerts('Could not start picker (' + chrome.runtime.lastError.message + ').');
            resolve(false);
            return;
          }
          // Stage 2: inject the picker bundle. Re-injection while already
          // loaded is safe (the SENTINEL guard in the bundle tears down
          // any prior overlay before rebuilding).
          chrome.scripting.executeScript(
            { target: { tabId: tab.id }, files: ['content-script-picker.js'] },
            () => {
              if (chrome.runtime.lastError) {
                consoleAlerts('Picker injection failed: ' + chrome.runtime.lastError.message);
                resolve(false);
                return;
              }
              window.HiredVideoTelemetry?.record('manual', {
                url: tab.url, host: hostOf(tab.url),
                payload: { kind: 'picker_launched', source: 'manual', mode },
              });
              resolve(true);
            },
          );
        },
      );
    });
  });
}

function hostOf(url) {
  if (!url) return '';
  try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * Convert a `pickerResult` message from the content script into the same
 * shape the extract-* endpoints already accept. Each mode synthesises a
 * minimal HTML stub from the captured field selectors + values so the
 * server's LLM extractor + harvest backstop can do their normal work.
 */
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.action !== 'pickerResult' || !message.result) return false;
  handlePickerResult(message.result);
  return false;
});

async function handlePickerResult(result) {
  const { mode, host, sourceUrl, fields } = result;
  try {
    await window.HiredVideoTelemetry?.saveLearned?.(host, mode, fields);
  } catch { /* non-fatal */ }
  window.HiredVideoTelemetry?.record?.('picker_capture', {
    url: sourceUrl, host,
    payload: { mode, fields },
  });

  // Build a tiny HTML envelope from the captured field snippets so the
  // server's existing LLM + harvest pipeline runs unchanged regardless
  // of mode. The snippet contains the literal user-clicked outerHTML so
  // contact/social URLs the user selected survive to the harvester.
  const stitched = stitchFieldsToHtml(fields);

  if (mode === 'profile') {
    await runManualExtract(recruiterExtractProfileUrl, stitched, sourceUrl, 'profile');
  } else if (mode === 'company') {
    await runManualExtract(companiesExtractUrl, stitched, sourceUrl, 'company');
  } else {
    await runManualExtract(jobsExtractUrl + '?track=true', stitched, sourceUrl, 'job');
  }
}

function stitchFieldsToHtml(fields) {
  if (!fields) return '';
  const parts = [];
  for (const [key, f] of Object.entries(fields)) {
    if (!f) continue;
    if (f.snippet) parts.push(f.snippet);
    else if (f.value) parts.push(`<div data-picker-key="${key}">${escapeHtml(String(f.value))}</div>`);
  }
  return `<html><body>${parts.join('\n')}</body></html>`;
}

async function runManualExtract(url, html, sourceUrl, type) {
  if (extractionBusy) return;
  extractionBusy = true;
  showElement('extractionLoading');
  const loadingText = document.getElementById('extractionLoadingText');
  if (loadingText) loadingText.textContent = `Extracting ${type}...`;

  try {
    const res = await apiFetch(url, {
      method: 'POST',
      body: JSON.stringify({ html, sourceUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Extraction failed');

    if (type === 'profile') {
      lastExtractedCandidate = data.data?.talentPoolCandidate || null;
      showExtractionSuccess('profile', data.data);
      if (lastExtractedCandidate?.id) {
        autoLogInteraction(lastExtractedCandidate.id, {
          type: 'sourcing',
          subject: 'Captured via picker from ' + extractHost(sourceUrl),
          notes: 'Profile extracted via in-page picker.',
        });
      }
    } else if (type === 'company') {
      showExtractionSuccess('company', data.data);
    } else {
      showExtractionSuccess('job', data.data);
    }
  } catch (err) {
    showExtractionError('Picker extraction failed: ' + err.message);
  } finally {
    extractionBusy = false;
    hideElement('extractionLoading');
  }
}
