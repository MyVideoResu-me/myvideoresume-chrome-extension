/**
 * hired.video Chrome Extension - Login Handler
 *
 * Three sign-in paths:
 *   1. Continue in browser  — opens hired.video/login in a new
 *      tab. The user can use any method the web app supports
 *      (Google, LinkedIn, GitHub, Microsoft, magic link, passkey,
 *      2FA, etc). The auth-bridge content script forwards the JWT
 *      back to the extension via chrome.storage.local.
 *   2. Email + password    — direct API call to /api/auth/login.
 *      Falls back to "continue in browser" automatically if the
 *      account requires 2FA.
 *   3. Magic link          — calls /api/auth/magic-link, then asks
 *      the user to click the email link. Auth bridge handles the
 *      rest.
 */

document.addEventListener('DOMContentLoaded', () => {
  updateConfiguration();
  watchForExtensionAuth();

  document.getElementById('signInWithWeb').addEventListener('click', handleSignInWithWeb);
  document.getElementById('loginForm').addEventListener('submit', handleEmailPasswordLogin);
  document.getElementById('magicLinkForm').addEventListener('submit', handleMagicLink);
  document.getElementById('togglePassword').addEventListener('click', togglePasswordVisibility);
});

/**
 * Show/hide the password field. Toggles the input type and updates
 * the button glyph + aria state for screen readers.
 */
function togglePasswordVisibility() {
  const input = document.getElementById('password');
  const btn = document.getElementById('togglePassword');
  if (!input || !btn) return;

  const showing = input.type === 'text';
  input.type = showing ? 'password' : 'text';
  btn.textContent = showing ? '👁' : '🙈';
  btn.setAttribute('aria-pressed', showing ? 'false' : 'true');
  btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
}

/**
 * Watch chrome.storage for a JWT being written by the auth bridge.
 * As soon as one appears, redirect to the side panel.
 */
function watchForExtensionAuth() {
  const onChange = (changes, area) => {
    if (area === 'local' && changes[jwtTokenKey] && changes[jwtTokenKey].newValue) {
      chrome.storage.onChanged.removeListener(onChange);
      window.location.href = chrome.runtime.getURL('sidepanel-global.html');
    }
  };
  chrome.storage.onChanged.addListener(onChange);
}

/**
 * Open hired.video/login in a new tab. The auth-bridge content
 * script picks up the JWT after a successful sign-in.
 */
function handleSignInWithWeb() {
  const url = buildWebUrl('/login?source=extension');
  chrome.tabs.create({ url });
  document.getElementById('webAuthHint').classList.remove('hidden');
}

/**
 * Email + password login (direct API call).
 */
async function handleEmailPasswordLogin(event) {
  event.preventDefault();

  const loginButton = document.getElementById('login');
  const loadingContainer = document.getElementById('loading');
  const errorContainer = document.getElementById('loginError');

  loginButton.disabled = true;
  loadingContainer.classList.remove('hidden');
  errorContainer.classList.add('hidden');

  const email = document.getElementById('userId').value.trim();
  const password = document.getElementById('password').value;

  if (!email || !password) {
    showLoginError('Please enter both email and password');
    resetLoginState();
    return;
  }

  try {
    const response = await fetch(login, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json().catch(() => ({}));
    consoleAlerts('Login response: ' + JSON.stringify(data));

    if (response.status === 401) {
      showLoginError('Invalid email or password. Please try again.');
      resetLoginState();
      return;
    }

    // Backend returns { requiresTwoFactor: true, tempAuthToken } when 2FA is on.
    // The extension can't host the full 2FA UI cleanly, so delegate.
    if (data.requiresTwoFactor || data?.data?.requiresTwoFactor) {
      showLoginError('This account uses two-factor auth. Use "Continue in browser" instead.');
      resetLoginState();
      return;
    }

    if (!response.ok) {
      showLoginError(data.error?.message || data.errorMessage || 'Login failed. Please try again.');
      resetLoginState();
      return;
    }

    // ApiResponse: { success, data: { token, user } } — or legacy { token }.
    const token = data?.data?.token || data?.token || null;

    if (token) {
      // Stamp `tokenSource: 'extension'` so the service worker can
      // tell this came from the extension's own form (not from the
      // auth-bridge web→extension push) and reload any open
      // hired.video tabs to surface the new session there too.
      chrome.storage.local.set({ jwtToken: token, tokenSource: 'extension' }, () => {
        window.location.href = chrome.runtime.getURL('sidepanel-global.html');
      });
    } else {
      showLoginError(data.error?.message || 'Login failed. Please check your credentials.');
      resetLoginState();
    }
  } catch (err) {
    console.error('Login error:', err);
    showLoginError('Connection error. Please check your internet connection and try again.');
    resetLoginState();
  }
}

/**
 * Magic link login — fire-and-forget call to /api/auth/magic-link.
 * The auth-bridge content script handles the post-login token sync.
 */
async function handleMagicLink(event) {
  event.preventDefault();

  const button = document.getElementById('magicLinkBtn');
  const status = document.getElementById('magicLinkStatus');
  const email = document.getElementById('magicEmail').value.trim();

  if (!email) return;

  button.disabled = true;
  status.classList.add('hidden');

  try {
    const response = await fetch(magicLinkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirect: '/dashboard' }),
    });

    if (!response.ok) {
      throw new Error('Failed to send magic link');
    }

    status.textContent = '📬 Check your email and click the link. The extension will sign you in automatically.';
    status.className = 'alert alert-success';
    status.classList.remove('hidden');
  } catch (err) {
    console.error('Magic link error:', err);
    status.textContent = 'Could not send magic link. Please try another sign-in method.';
    status.className = 'alert alert-error';
    status.classList.remove('hidden');
  } finally {
    button.disabled = false;
  }
}

function showLoginError(message) {
  const errorContainer = document.getElementById('loginError');
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.classList.remove('hidden');
  }
}

function resetLoginState() {
  document.getElementById('loading').classList.add('hidden');
  document.getElementById('login').disabled = false;
}
