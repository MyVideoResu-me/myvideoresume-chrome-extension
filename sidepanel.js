document.addEventListener('DOMContentLoaded', () => {
    // Check if the user is logged in by fetching the JWT token from storage
    chrome.storage.local.get(jwtTokenKey, (data) => {
      if (data.jwtToken) {
        const token = data.jwtToken;
        const decodedToken = jwt_decode(token); // Decode JWT token
  
        // Check if token has expired
        const currentTime = Math.floor(Date.now() / 1000); // Get current time in seconds
        if (decodedToken.exp < currentTime) {
          // Token expired, clear it from storage
          chrome.storage.local.remove(jwtTokenKey, () => {
            alert('Session expired. Please log in again.');
            window.location.href = chrome.runtime.getURL('login.html');
          });
        } else {
          // Token is valid, show the "Add Job" button
          document.getElementById('jobResumePrompt').style.display = 'block';
        }
      } else {
        // No JWT token, show the login prompt
        document.getElementById('loginPrompt').style.display = 'block';
        document.getElementById('loginButton').addEventListener('click', () => {
          window.location.href = chrome.runtime.getURL('login.html');
        });
      }
    });
  
    // "Add Job" button click handler
    document.getElementById('addJobButton').addEventListener('click', () => {
      alert("Add job");
      
        chrome.storage.local.get(jwtTokenKey, (data) => {
        const jwtToken = data.jwtToken;
        if (jwtToken) {
            chrome.runtime.sendMessage({ action: "getHTML" }, (response) => {
                let html = response.html;
                let originUrl = response.originUrl;
                alert(html);
                alert(originUrl);

                const jobChromeRequest = {
                    token: jwtToken,
                    html: html,  // You can capture the full HTML of the page or other details
                    originUrl: originUrl
                  };
                  
                  let data = JSON.stringify(jobChromeRequest);
      
                fetch(createjobbestmatch, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${jwtToken}` // Use Bearer token authentication
                  },
                  body: data
                })
                .then(response =>  {
                    
                    if(response.status === 401){
                        alert('Login Failed. Try again.');
                        chrome.storage.local.remove(jwtTokenKey);
                        window.location.href = chrome.runtime.getURL('login.html')
                    }else if (response.ok || response.status === 200){
                        alert("success");
                        return response.json();
                    }
                    
                })
                .then(data =>{
                    alert(JSON.stringify(data));

                    console.log('Job Created:', data)})
                .catch(err => {
                    alert(err);
                    console.error('Error:', err);
                });
              });
        }
      });
    });
  });
  