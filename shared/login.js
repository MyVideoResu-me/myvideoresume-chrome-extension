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
 *      The popup hosts the email-OTP step-up directly so a user
 *      with MFA enabled (or a backend that escalated because the
 *      Turnstile signal was missing/invalid) can finish sign-in
 *      without leaving the extension. Falls back to the browser
 *      flow only when the account requires a method we can't host
 *      (OAuth, passkey, etc).
 *   3. Magic link          — calls /api/auth/magic-link, then asks
 *      the user to click the email link. Auth bridge handles the
 *      rest.
 */

// Holds the in-flight 2FA challenge between password submit and code
// submit. Scoped at module level because the two form submits live in
// separate handlers — putting it on the form's dataset would round-trip
// through DOM strings.
let pendingTwoFactor = null;

document.addEventListener('DOMContentLoaded', () => {
  updateConfiguration();
  watchForExtensionAuth();

  document.getElementById('signInWithWeb').addEventListener('click', handleSignInWithWeb);
  document.getElementById('loginForm').addEventListener('submit', handleEmailPasswordLogin);
  document.getElementById('magicLinkForm').addEventListener('submit', handleMagicLink);
  document.getElementById('togglePassword').addEventListener('click', togglePasswordVisibility);
  document.getElementById('twoFactorForm').addEventListener('submit', handleTwoFactorSubmit);
  document.getElementById('twoFactorResend').addEventListener('click', handleTwoFactorResend);
  document.getElementById('twoFactorBack').addEventListener('click', () => showLoginForm());
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

    // Backend returns { requiresTwoFactor: true, tempAuthToken, email,
    // expiresAt } when MFA is on, OR when the captcha gate couldn't
    // verify a Turnstile token and escalated the user to email-OTP
    // step-up (AuthService.handleLogin: captchaFailed → requiresMfa).
    // Either way we host the OTP entry inline so the user doesn't
    // have to start over in a new tab.
    const envelope = unwrapApiResponse(data);
    if (envelope.requiresTwoFactor) {
      pendingTwoFactor = {
        tempAuthToken: envelope.tempAuthToken,
        email: envelope.email || email,
        expiresAt: envelope.expiresAt,
      };
      showTwoFactorForm();
      resetLoginState();
      return;
    }

    // TURNSTILE_FAIL fallback. The captcha gate in the production backend
    // rejects login attempts that arrive without a valid Turnstile token
    // (the extension popup can't host the widget, and the web Login page
    // is only protected if VITE_TURNSTILE_SITE_KEY is set in the build).
    // When the new step-up rail lands server-side this branch falls into
    // the requiresTwoFactor path above; until then we transparently fire
    // a magic link to the email the user already typed — /api/auth/magic-link
    // has no captcha enforcement and the auth-bridge picks up the session
    // when they click through.
    if (data.error?.code === 'TURNSTILE_FAIL') {
      const sent = await sendMagicLink(email);
      const statusBox = document.getElementById('loginError');
      statusBox.textContent = sent
        ? `📬 Captcha is misbehaving on this device — we just emailed a sign-in link to ${email} instead. Click it and this extension will pick up your session automatically.`
        : 'Captcha verification failed AND we could not send a magic link. Try "Continue in browser" above.';
      statusBox.className = sent ? 'alert alert-success' : 'alert alert-error';
      statusBox.classList.remove('hidden');
      resetLoginState();
      return;
    }

    if (!response.ok) {
      showLoginError(data.error?.message || data.errorMessage || 'Login failed. Please try again.');
      resetLoginState();
      return;
    }

    // ApiResponse: { success, data: { token, user } } — or legacy { token }.
    const token = envelope.token;

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

  const sent = await sendMagicLink(email);
  status.textContent = sent
    ? '📬 Check your email and click the link. The extension will sign you in automatically.'
    : 'Could not send magic link. Please try another sign-in method.';
  status.className = sent ? 'alert alert-success' : 'alert alert-error';
  status.classList.remove('hidden');
  button.disabled = false;
}

/**
 * POST /api/auth/magic-link with the supplied email. Single seam for every
 * caller (the explicit "Email me a magic link" form AND the
 * TURNSTILE_FAIL recovery branch in handleEmailPasswordLogin). Always
 * returns boolean ok — never throws — so consumers don't have to wrap.
 * The endpoint has no captcha enforcement, so this is the safe fallback
 * when /api/auth/login is bouncing TURNSTILE_FAIL.
 */
async function sendMagicLink(email) {
  if (!email) return false;
  try {
    const response = await fetch(magicLinkUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, redirect: '/dashboard' }),
    });
    return response.ok;
  } catch (err) {
    console.error('Magic link error:', err);
    return false;
  }
}

/**
 * Normalises both wire shapes the API uses for auth responses:
 *   • Current:  { success, data: { token | requiresTwoFactor | ... } }
 *   • Legacy:   { token | requiresTwoFactor | ... } at the top level
 * Returns the inner payload (or the original object when there is no
 * `data` envelope) so callers can read flags without `?.data ?? data`
 * littered at every read site.
 */
function unwrapApiResponse(body) {
  if (body && typeof body === 'object' && body.data && typeof body.data === 'object') {
    return body.data;
  }
  return body || {};
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

/**
 * Swap the email/password form for the OTP entry form. Called when the
 * backend returns `requiresTwoFactor` — either because the user has MFA
 * enabled, or because the captcha gate failed and escalated to the
 * email-OTP step-up.
 */
function showTwoFactorForm() {
  if (!pendingTwoFactor) return;
  document.getElementById('emailPasswordDetails').open = true;
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('twoFactorError').classList.add('hidden');
  document.getElementById('twoFactorCode').value = '';
  document.getElementById('twoFactorIntro').textContent =
    `We just sent a 6-digit code to ${pendingTwoFactor.email}. It expires in 10 minutes.`;
  document.getElementById('twoFactorForm').classList.remove('hidden');
  document.getElementById('twoFactorCode').focus();
}

function showLoginForm() {
  pendingTwoFactor = null;
  document.getElementById('twoFactorForm').classList.add('hidden');
  document.getElementById('twoFactorError').classList.add('hidden');
  document.getElementById('loginForm').classList.remove('hidden');
}

async function handleTwoFactorSubmit(event) {
  event.preventDefault();
  if (!pendingTwoFactor) {
    showLoginForm();
    return;
  }

  const submitBtn = document.getElementById('twoFactorSubmit');
  const loading = document.getElementById('twoFactorLoading');
  const errorBox = document.getElementById('twoFactorError');
  const code = document.getElementById('twoFactorCode').value.trim();

  if (!/^\d{4,8}$/.test(code)) {
    showTwoFactorError('Enter the 6-digit code from your email.');
    return;
  }

  submitBtn.disabled = true;
  loading.classList.remove('hidden');
  errorBox.classList.add('hidden');

  try {
    const response = await fetch(verifyTwoFactorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tempAuthToken: pendingTwoFactor.tempAuthToken,
        verificationCode: code,
      }),
    });

    const data = await response.json().catch(() => ({}));
    consoleAlerts('2FA response: ' + JSON.stringify(data));

    if (!response.ok) {
      showTwoFactorError(data.error?.message || 'Code is invalid or expired. Try again.');
      return;
    }

    const token = unwrapApiResponse(data).token || null;
    if (!token) {
      showTwoFactorError('Verification succeeded but no session was issued. Please try again.');
      return;
    }

    chrome.storage.local.set({ jwtToken: token, tokenSource: 'extension' }, () => {
      window.location.href = chrome.runtime.getURL('sidepanel-global.html');
    });
  } catch (err) {
    console.error('2FA verify error:', err);
    showTwoFactorError('Connection error. Please try again.');
  } finally {
    submitBtn.disabled = false;
    loading.classList.add('hidden');
  }
}

async function handleTwoFactorResend() {
  if (!pendingTwoFactor) return;
  const errorBox = document.getElementById('twoFactorError');
  errorBox.classList.add('hidden');
  try {
    const response = await fetch(resendTwoFactorUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempAuthToken: pendingTwoFactor.tempAuthToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      showTwoFactorError(data.error?.message || 'Could not resend the code. Try signing in again.');
      return;
    }
    // Backend issues a fresh code and a fresh tempAuthToken — adopt it.
    const next = unwrapApiResponse(data).tempAuthToken;
    if (next) pendingTwoFactor.tempAuthToken = next;
    errorBox.textContent = 'New code sent. Check your email.';
    errorBox.className = 'alert alert-success';
    errorBox.classList.remove('hidden');
  } catch (err) {
    console.error('2FA resend error:', err);
    showTwoFactorError('Connection error. Please try again.');
  }
}

function showTwoFactorError(message) {
  const box = document.getElementById('twoFactorError');
  box.textContent = message;
  box.className = 'alert alert-error';
  box.classList.remove('hidden');
}
