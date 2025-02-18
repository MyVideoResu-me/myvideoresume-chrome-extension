document.getElementById('loginForm').addEventListener('submit', (event) => {
    event.preventDefault();

    document.getElementById('login').disabled = true;
    document.getElementById('loading').style.display = 'block';
    
    const email = document.getElementById('userId').value;
    const password = document.getElementById('password').value;
    let request = JSON.stringify({ email, password });
    //alert(request);
  
    // Send login request to your API
    fetch(login, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: request
    })
    .then(response => {
        if(response.status === 401){
            alert('Login Failed. Try again.');
        }else if (response.ok){
            return response.json();
        }
    })
    .then(data => {
      if(data){
        if (data.token) {
            // Store the JWT token securely
            chrome.storage.local.set({ jwtToken: data.token }, () => {
            //alert('Login Successful');
            window.location.href = chrome.runtime.getURL('sidepanel.html');
            });
        } else {
            alert(JSON.stringify(data), 'Login Failed');
            alert('Login Failed.');
        }
      }
    })
    .catch(err => {
      //console.error('Login error:', err);
      alert(err);
    })
    .finally(s => {
        document.getElementById('loading').style.cssText = 'display: none !important;';
        document.getElementById('login').disabled = false; 
    });
  });
  