/**
 * MyVideoResume Chrome Extension - Login Handler
 */

document.addEventListener('DOMContentLoaded', () => {
  updateConfiguration();

  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const loginButton = document.getElementById('login');
    const loadingContainer = document.getElementById('loading');
    const errorContainer = document.getElementById('loginError');

    // Reset UI state
    loginButton.disabled = true;
    loadingContainer.classList.remove('hidden');
    errorContainer.classList.add('hidden');

    const email = document.getElementById('userId').value.trim();
    const password = document.getElementById('password').value;

    // Basic validation
    if (!email || !password) {
      showLoginError('Please enter both email and password');
      resetLoginState();
      return;
    }

    const request = JSON.stringify({ email, password });
    consoleAlerts('Login request: ' + email);

    try {
      const response = await fetch(login, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: request
      });

      if (response.status === 401) {
        showLoginError('Invalid email or password. Please try again.');
        resetLoginState();
        return;
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        showLoginError(errorData.error?.message || 'Login failed. Please try again.');
        resetLoginState();
        return;
      }

      const data = await response.json();
      consoleAlerts('Login response: ' + JSON.stringify(data));

      // Handle ApiResponse format: { success: true, data: { token: "...", user: {...} } }
      let token = null;

      if (data.success && data.data && data.data.token) {
        // New ApiResponse format
        token = data.data.token;
      } else if (data.token) {
        // Legacy format
        token = data.token;
      }

      if (token) {
        // Store the JWT token and redirect
        chrome.storage.local.set({ jwtToken: token }, () => {
          consoleAlerts('Login successful');
          window.location.href = chrome.runtime.getURL('sidepanel-global.html');
        });
      } else {
        // Login failed - show error message
        const errorMessage = data.error?.message ||
                           data.errorMessage ||
                           'Login failed. Please check your credentials.';
        showLoginError(errorMessage);
        resetLoginState();
      }

    } catch (err) {
      console.error('Login error:', err);
      showLoginError('Connection error. Please check your internet connection and try again.');
      resetLoginState();
    }
  });
});

/**
 * Show login error message
 */
function showLoginError(message) {
  const errorContainer = document.getElementById('loginError');
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.classList.remove('hidden');
  }
}

/**
 * Reset login button and loading state
 */
function resetLoginState() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('login').disabled = false;
}