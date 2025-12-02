/**
 * MyVideoResume Chrome Extension - Side Panel
 * Handles job analysis, resume tailoring, and variation management
 */

// Global state
let masterResumeGroups = [];
let selectedResume = null;
let generatedResumeData = null;
let currentJobHtml = null;
let currentJobUrl = null;

document.addEventListener('DOMContentLoaded', () => {
  updateConfiguration();
  initializeApp();
  setupUrlChangeListener();
});

/**
 * Listen for URL changes from the content script
 * This handles SPA navigation (like LinkedIn)
 */
function setupUrlChangeListener() {
  chrome.runtime.onMessage.addListener((message, _sender, _sendResponse) => {
    if (message.action === 'urlChanged') {
      consoleAlerts('URL changed to: ' + message.url);
      // Clear cached job data when URL changes
      currentJobHtml = null;
      currentJobUrl = null;
      // Clear any previous results
      clearPreviousResults();
    }
    return true;
  });
}

/**
 * Clear previous analysis/generation results when navigating to a new page
 */
function clearPreviousResults() {
  // Clear recommendation display
  const evalRecommendations = document.getElementById('evalRecommendations');
  if (evalRecommendations) {
    evalRecommendations.innerHTML = '';
  }

  // Clear score displays
  const evalScore = document.getElementById('evalScore');
  if (evalScore) {
    evalScore.textContent = '';
  }

  // Clear generated resume data
  generatedResumeData = null;

  // Hide result sections
  hideElement('generateResults');
  hideElement('variationSection');
}

/**
 * Initialize the application
 */
function initializeApp() {
  // Check authentication status
  chrome.storage.local.get([jwtTokenKey, selectedResumeKey], (data) => {
    if (data.jwtToken) {
      const token = data.jwtToken;
      try {
        const decodedToken = jwt_decode(token);
        const currentTime = Math.floor(Date.now() / 1000);

        if (decodedToken.exp < currentTime) {
          // Token expired
          handleTokenExpired();
        } else {
          // Token valid - show main content
          showElement('jobResumePrompt');
          hideElement('loginPrompt');

          // Restore selected resume if available
          if (data[selectedResumeKey]) {
            selectedResume = data[selectedResumeKey];
          }

          // Load resumes
          loadMasterResumeGroups();

          // Setup event listeners
          setupEventListeners();
        }
      } catch (e) {
        console.error('Error decoding token:', e);
        handleTokenExpired();
      }
    } else {
      // Not logged in
      showElement('loginPrompt');
      hideElement('jobResumePrompt');
      setupLoginButton();
    }
  });
}

/**
 * Handle expired token
 */
function handleTokenExpired() {
  chrome.storage.local.remove([jwtTokenKey, selectedResumeKey], () => {
    showElement('loginPrompt');
    hideElement('jobResumePrompt');
    setupLoginButton();
  });
}

/**
 * Setup login button
 */
function setupLoginButton() {
  document.getElementById('loginButton').addEventListener('click', () => {
    window.location.href = chrome.runtime.getURL('login.html');
  });
}

/**
 * Setup all event listeners
 */
function setupEventListeners() {
  // Resume selection
  document.getElementById('refreshResumesButton').addEventListener('click', loadMasterResumeGroups);
  document.getElementById('changeResumeButton').addEventListener('click', showResumeSelection);

  // Step 1: Score & Evaluate
  document.getElementById('scoreEvaluateButton').addEventListener('click', handleScoreEvaluate);

  // Step 2: Tailor & Generate
  document.getElementById('trackGenerateButton').addEventListener('click', handleTailorGenerate);

  // Save as Variation
  document.getElementById('saveVariationButton').addEventListener('click', handleSaveVariation);

  // Download buttons
  document.getElementById('downloadPdfButton').addEventListener('click', () => handleDownload('pdf'));
  document.getElementById('downloadDocxButton').addEventListener('click', () => handleDownload('docx'));

  // Modal buttons
  document.getElementById('closeModalButton').addEventListener('click', hideModal);
  document.getElementById('cancelModalButton').addEventListener('click', hideModal);
  document.getElementById('confirmSaveButton').addEventListener('click', handleModalSave);
}

/**
 * Load master resume groups from API
 */
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
        'Content-Type': 'application/json'
      }
    });

    if (response.status === 401) {
      handleTokenExpired();
      return;
    }

    if (!response.ok) {
      throw new Error('Failed to load resumes');
    }

    const data = await response.json();
    consoleAlerts('Resume groups loaded: ' + JSON.stringify(data));

    // Handle ApiResponse format
    if (data.success && data.data) {
      masterResumeGroups = data.data;
    } else if (Array.isArray(data)) {
      masterResumeGroups = data;
    } else {
      masterResumeGroups = [];
    }

    renderResumeSelection();

    // Auto-select first master resume if none selected
    if (!selectedResume && masterResumeGroups.length > 0) {
      selectResume(masterResumeGroups[0].masterResume);
    } else if (selectedResume) {
      // Verify selected resume still exists
      const found = findResumeById(selectedResume.id);
      if (found) {
        selectResume(found);
      } else if (masterResumeGroups.length > 0) {
        selectResume(masterResumeGroups[0].masterResume);
      }
    }

  } catch (error) {
    console.error('Error loading resumes:', error);
    showError('resumeSelectionContainer', 'Failed to load resumes. Please try again.');
  } finally {
    hideElement('resumeLoadingContainer');
  }
}

/**
 * Find resume by ID in master groups
 */
function findResumeById(id) {
  for (const group of masterResumeGroups) {
    if (group.masterResume.id === id) {
      return group.masterResume;
    }
    for (const variation of (group.variations || [])) {
      if (variation.id === id) {
        return variation;
      }
    }
  }
  return null;
}

/**
 * Render resume selection UI
 */
function renderResumeSelection() {
  const container = document.getElementById('resumeSelectionContainer');

  if (masterResumeGroups.length === 0) {
    container.innerHTML = `
      <div class="alert alert-info">
        <p>No resumes found. <a href="https://app.myvideoresu.me/resumes/" target="_blank">Upload a resume</a> to get started.</p>
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
              <div class="resume-card-title">${escapeHtml(master.name || 'Untitled Resume')}</div>
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
                <div class="resume-card-title">${escapeHtml(v.name || 'Untitled Variation')}</div>
                <div class="resume-card-meta">${formatDate(v.creationDateTime || v.createdAt)}</div>
              </div>
              <span class="badge badge-variation">Variation</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
  showElement('resumeSelectionContainer');
}

/**
 * Select resume by ID (called from onclick)
 */
window.selectResumeById = function(id) {
  const resume = findResumeById(id);
  if (resume) {
    selectResume(resume);
  }
};

/**
 * Select a resume
 */
function selectResume(resume) {
  selectedResume = resume;

  // Save to storage
  chrome.storage.local.set({ [selectedResumeKey]: resume });

  // Update UI
  document.getElementById('selectedResumeName').textContent = resume.name || 'Untitled Resume';

  const badge = document.getElementById('selectedResumeBadge');
  if (resume.isMaster) {
    badge.textContent = 'Master';
    badge.className = 'badge badge-master';
  } else {
    badge.textContent = 'Variation';
    badge.className = 'badge badge-variation';
  }

  // Update selection highlight
  document.querySelectorAll('.resume-card').forEach(card => {
    card.classList.remove('selected');
    if (card.dataset.resumeId === resume.id) {
      card.classList.add('selected');
    }
  });

  hideElement('resumeSelectionContainer');
  showElement('selectedResumeDisplay');

  // Reset results when resume changes
  resetResults();
}

/**
 * Show resume selection dropdown
 */
function showResumeSelection() {
  hideElement('selectedResumeDisplay');
  showElement('resumeSelectionContainer');
}

/**
 * Reset analysis results
 */
function resetResults() {
  generatedResumeData = null;

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
}


/**
 * Handle Step 1: Score & Evaluate
 */
async function handleScoreEvaluate() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  if (!selectedResume) {
    showError('evalRecommendations', 'Please select a resume first');
    showElement('evalRecommendations');
    return;
  }

  // Get page HTML
  chrome.runtime.sendMessage({ action: "getHTML" }, async (response) => {
    if (!response || !response.html) {
      showError('evalRecommendations', 'Could not read page content. Please make sure you are on a job posting page.');
      showElement('evalRecommendations');
      return;
    }

    currentJobHtml = jobDescriptionParser(response.html);
    currentJobUrl = response.originUrl;

    consoleAlerts('Job HTML: ' + currentJobHtml.substring(0, 200));

    // Prepare request using new API format
    const analyzeRequest = {
      jobHtml: currentJobHtml,
      resumeId: selectedResume.id,
      sourceUrl: currentJobUrl
    };

    // Update UI
    document.getElementById('scoreEvaluateButton').disabled = true;
    showElement('evalLoading');
    hideElement('evalScoreSection');
    hideElement('evalRecommendations');

    try {
      const response = await fetch(matchAnalyze, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${jwtToken}`
        },
        body: JSON.stringify(analyzeRequest)
      });

      if (response.status === 401) {
        handleTokenExpired();
        return;
      }

      if (response.status === 404) {
        handleApiNotFound('evalRecommendations');
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || 'Analysis failed');
      }

      const data = await response.json();
      consoleAlerts('Analysis result: ' + JSON.stringify(data));

      // Handle response
      if (data.errorMessage) {
        showError('evalRecommendations', data.errorMessage);
        showElement('evalRecommendations');
      } else if (data.result || data.data) {
        const result = data.result || data.data;

        // Show score
        const score = result.score || result.oldScore || 0;
        document.getElementById('evalScore').textContent = formatScore(score);
        applyScoreStyle('evalScore', score);
        showElement('evalScoreSection');

        // Show recommendations
        if (result.summaryRecommendations) {
          const converter = new showdown.Converter();
          document.getElementById('evalRecommendations').innerHTML = converter.makeHtml(result.summaryRecommendations);
          showElement('evalRecommendations');
        }

        // Enable Step 2
        document.getElementById('trackGenerateButton').disabled = false;

        // Reset Step 2 results
        document.getElementById('custom').innerHTML = '<p class="text-center text-muted"><em>Your AI-generated tailored resume will appear here</em></p>';
        hideElement('score');
        hideElement('recommendations');
        hideElement('resumeActions');
      }
    } catch (error) {
      console.error('Error analyzing job:', error);
      showError('evalRecommendations', 'Failed to analyze job posting. Please try again.');
      showElement('evalRecommendations');
    } finally {
      hideElement('evalLoading');
      document.getElementById('scoreEvaluateButton').disabled = false;
    }
  });
}

/**
 * Handle Step 2: Tailor & Generate
 */
async function handleTailorGenerate() {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  if (!selectedResume) {
    showError('custom', 'Please select a resume first');
    return;
  }

  // Get page HTML if not already captured
  if (!currentJobHtml) {
    chrome.runtime.sendMessage({ action: "getHTML" }, (response) => {
      if (response && response.html) {
        currentJobHtml = jobDescriptionParser(response.html);
        currentJobUrl = response.originUrl;
        performTailorGenerate(jwtToken);
      } else {
        showError('custom', 'Could not read page content.');
      }
    });
  } else {
    performTailorGenerate(jwtToken);
  }
}

/**
 * Perform the tailor and generate API call
 */
async function performTailorGenerate(jwtToken) {
  // Prepare request using new API format
  const tailorRequest = {
    jobHtml: currentJobHtml,
    resumeId: selectedResume.id,
    sourceUrl: currentJobUrl
  };

  // Update UI
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
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify(tailorRequest)
    });

    if (response.status === 401) {
      handleTokenExpired();
      return;
    }

    if (response.status === 404) {
      handleApiNotFound('custom');
      return;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Generation failed');
    }

    const data = await response.json();
    consoleAlerts('Generate result: ' + JSON.stringify(data));

    if (data.errorMessage) {
      showError('custom', data.errorMessage);
    } else if (data.result || data.data) {
      const result = data.result || data.data;
      generatedResumeData = result;

      // Show generated resume
      if (result.markdownResume) {
        const converter = new showdown.Converter();
        document.getElementById('custom').innerHTML = converter.makeHtml(result.markdownResume);
        document.getElementById('custom').classList.add('success');
      }

      // Show new score
      const newScore = result.newScore || result.score || 0;
      document.getElementById('newScore').textContent = formatScore(newScore);
      applyScoreStyle('newScore', newScore);
      showElement('score');

      // Show recommendations
      if (result.summaryRecommendations) {
        const converter = new showdown.Converter();
        document.getElementById('recommendations').innerHTML = converter.makeHtml(result.summaryRecommendations);
        showElement('recommendations');
      }

      // Show action buttons
      showElement('resumeActions');
      showElement('disclaimer');

      // Pre-fill variation name suggestion
      const suggestedName = generateVariationName();
      document.getElementById('variationName').value = suggestedName;

      // Reset save status
      hideElement('saveVariationSuccess');
      hideElement('saveVariationError');
    }
  } catch (error) {
    console.error('Error generating resume:', error);
    showError('custom', 'Failed to generate tailored resume. Please try again.');
  } finally {
    hideElement('loading');
    document.getElementById('trackGenerateButton').disabled = false;
    document.getElementById('scoreEvaluateButton').disabled = false;
  }
}

/**
 * Generate a suggested variation name based on job URL
 */
function generateVariationName() {
  if (!currentJobUrl) return 'Job Application ' + new Date().toLocaleDateString();

  try {
    const url = new URL(currentJobUrl);
    const hostname = url.hostname.replace('www.', '').split('.')[0];
    return `${capitalizeFirst(hostname)} - ${new Date().toLocaleDateString()}`;
  } catch {
    return 'Job Application ' + new Date().toLocaleDateString();
  }
}

/**
 * Handle Save as Variation
 */
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

  // Find master resume ID
  let masterResumeId = selectedResume.id;
  if (!selectedResume.isMaster && selectedResume.parentId) {
    masterResumeId = selectedResume.parentId;
  }

  // Update UI
  document.getElementById('saveVariationButton').disabled = true;
  showElement('saveVariationLoading');
  hideElement('saveVariationError');
  hideElement('saveVariationSuccess');

  try {
    const createVariationUrl = buildResumeUrl(masterResumeId, 'createVariation');

    const response = await fetch(createVariationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwtToken}`
      },
      body: JSON.stringify({
        name: variationName,
        description: `Generated for: ${currentJobUrl || 'Job Application'}`,
        resumeData: generatedResumeData.markdownResume
      })
    });

    if (response.status === 401) {
      handleTokenExpired();
      return;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || 'Failed to save variation');
    }

    const data = await response.json();
    consoleAlerts('Variation saved: ' + JSON.stringify(data));

    // Show success
    showElement('saveVariationSuccess');

    // Refresh resume list
    setTimeout(() => {
      loadMasterResumeGroups();
    }, 1500);

  } catch (error) {
    console.error('Error saving variation:', error);
    document.getElementById('saveVariationError').textContent = error.message || 'Failed to save variation. Please try again.';
    showElement('saveVariationError');
  } finally {
    hideElement('saveVariationLoading');
    document.getElementById('saveVariationButton').disabled = false;
  }
}

/**
 * Handle Resume Download
 */
async function handleDownload(format) {
  const jwtToken = await getJwtToken();
  if (!jwtToken) return;

  if (!selectedResume) {
    showError('downloadError', 'No resume selected');
    showElement('downloadError');
    return;
  }

  showElement('downloadLoading');
  hideElement('downloadError');

  try {
    const exportUrl = buildResumeUrl(selectedResume.id, 'export', `format=${format}`);

    const response = await fetch(exportUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${jwtToken}`
      }
    });

    if (response.status === 401) {
      handleTokenExpired();
      return;
    }

    if (!response.ok) {
      throw new Error('Download failed');
    }

    // Check if response is a blob (file) or JSON (URL)
    const contentType = response.headers.get('content-type');

    if (contentType && contentType.includes('application/json')) {
      // API returns a URL to the file
      const data = await response.json();
      const downloadUrl = data.data?.exportUrl || data.exportUrl;

      if (downloadUrl) {
        // Open download in new tab
        window.open(downloadUrl, '_blank');
      } else {
        throw new Error('No download URL received');
      }
    } else {
      // API returns the file directly
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selectedResume.name || 'resume'}.${format}`;
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

// Modal functions
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

// Utility functions
async function getJwtToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get(jwtTokenKey, (data) => {
      resolve(data.jwtToken || null);
    });
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

/**
 * Handle 404 API response - extension may need update
 */
function handleApiNotFound(containerId) {
  const message = `
    <div class="alert alert-warning">
      <strong>⚠️ Update Required</strong><br>
      This feature requires a newer version of MyVideoResume.
      Please update your Chrome extension to the latest version.
      <br><br>
      <a href="https://chrome.google.com/webstore/detail/myvideoresume" target="_blank" class="btn btn-sm btn-outline">
        Update Extension
      </a>
    </div>
  `;
  const container = document.getElementById(containerId);
  if (container) {
    container.innerHTML = message;
    showElement(containerId);
  }

  // Also hide loading indicators
  hideElement('evalLoading');
  hideElement('loading');
  document.getElementById('scoreEvaluateButton').disabled = false;
  document.getElementById('trackGenerateButton').disabled = false;
}

function formatScore(score) {
  if (typeof score === 'number') {
    return Math.round(score) + '%';
  }
  return score + '%';
}

function applyScoreStyle(elementId, score) {
  const el = document.getElementById(elementId);
  if (!el) return;

  el.classList.remove('score-high', 'score-medium', 'score-low');

  const numScore = parseFloat(score);
  if (numScore >= 70) {
    el.classList.add('score-high');
  } else if (numScore >= 40) {
    el.classList.add('score-medium');
  } else {
    el.classList.add('score-low');
  }
}

function formatDate(dateString) {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString();
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