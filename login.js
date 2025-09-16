document.addEventListener('DOMContentLoaded', () => {
  updateConfiguration();

  document.getElementById('loginForm').addEventListener('submit', (event) => {
    event.preventDefault();

    document.getElementById('login').disabled = true;
    document.getElementById('loading').style.display = 'block';

    const email = document.getElementById('userId').value;
    const password = document.getElementById('password').value;
    let request = JSON.stringify({ email, password });

    consoleAlerts(request);

    // Send login request to your API
    fetch(login, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: request
    })
      .then(response => {
        if (response.status === 401) {
          consoleAlerts('Login Failed. Try again.');
        } else if (response.ok) {
          return response.json();
        }
      })
      .then(data => {
        if (data) {
          // Handle new ApiResponse format: { success: true, data: { token: "...", user: {...} } }
          if (data.success && data.data && data.data.token) {
            // Store the JWT token securely
            chrome.storage.local.set({ jwtToken: data.data.token }, () => {
              consoleAlerts('Login Successful');
              window.location.href = chrome.runtime.getURL('sidepanel-global.html');
            });
          } else if (data.token) {
            // Fallback for old format (just in case)
            chrome.storage.local.set({ jwtToken: data.token }, () => {
              consoleAlerts('Login Successful');
              window.location.href = chrome.runtime.getURL('sidepanel-global.html');
            });
          } else {
            consoleAlerts(JSON.stringify(data), 'Login Failed');
            consoleAlerts('Login Failed: ' + (data.error?.message || 'Unknown error'));
          }
        }
      })
      .catch(err => {
        consoleAlerts('Login error:' + err);
        consoleAlerts(err);
      })
      .finally(s => {
        document.getElementById('loading').style.cssText = 'display: none !important;';
        document.getElementById('login').disabled = false;
      });
  });

});