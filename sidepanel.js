document.addEventListener('DOMContentLoaded', () => {

  updateConfiguration();

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
          consoleAlerts('Session expired. Please log in again.');
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

  //STEP 2
  document.getElementById('trackGenerateButton').addEventListener('click', () => {
    consoleAlerts("Track job");

    chrome.storage.local.get(jwtTokenKey, (data) => {
      const jwtToken = data.jwtToken;
      if (jwtToken) {
        consoleAlerts("jwt");
        chrome.runtime.sendMessage({ action: "getHTML" }, (response) => {

          consoleAlerts(response.html);
          let html = jobDescriptionParser(response.html);
          let originUrl = response.originUrl;
          consoleAlerts(html);
          consoleAlerts(originUrl);

          //verify that the page is a Job
          let isJob = true //findWholeWord(html, 'job');
          if (isJob) {

            const jobChromeRequest = {
              token: jwtToken,
              html: html,  // You can capture the full HTML of the page or other details
              originUrl: originUrl
            };

            let data = JSON.stringify(jobChromeRequest);

            consoleAlerts(data);

            document.getElementById('custom').innerHTML = "<i>Placeholder for AI generated tailored resume</i>.";
            document.getElementById('scoreEvaluateButton').disabled = true;
            document.getElementById('loading').style.display = 'block';

            fetch(createjobbestmatch, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}` // Use Bearer token authentication
              },
              body: data
            })
              .then(response => {

                if (response.status === 401) {
                  consoleAlerts('Login Failed. Try again.');
                  chrome.storage.local.remove(jwtTokenKey);
                  window.location.href = chrome.runtime.getURL('login.html')
                } else if (response.ok || response.status === 200) {
                  consoleAlerts("success");
                  return response.json();
                }

              })
              .then(data => {

                consoleAlerts('Job Created: ' + data)
                consoleAlerts(JSON.stringify(data));

                if (data.errorMessage) {
                  consoleAlerts(data.errorMessage);
                } else if (data.result) {
                  if (data.result.summaryRecommendations) {
                    consoleAlerts(data.result.markdownResume);
                    let converter = new showdown.Converter();
                    let htmlConverted = converter.makeHtml(data.result.markdownResume);
                    let recommedationConverted = converter.makeHtml(data.result.summaryRecommendations);
                    consoleAlerts(htmlConverted);
                    let element = document.getElementById('custom');
                    if (element) {
                      element.innerHTML = htmlConverted;
                      document.getElementById('score').style.display = 'block';
                      let recom = document.getElementById('recommendations');
                      recom.style.display = 'block';
                      recom.innerHTML = recommedationConverted;
                      document.getElementById('newScore').innerText = data.result.newScore;
                    }
                  } else {
                    document.getElementById('scoreEvaluateButton').disabled = false;
                  }
                }
              })
              .catch(err => {
                consoleAlerts("is error");
                consoleAlerts('Error: ' + err.message);
              })
              .finally(s => {
                document.getElementById('loading').style.cssText = 'display: none !important;';
                document.getElementById('scoreEvaluateButton').disabled = false;
                document.getElementById('disclaimer').style.display = 'block';
              });
          }
        });
      }
    });
  });

  //STEP 1
  document.getElementById('scoreEvaluateButton').addEventListener('click', () => {
    consoleAlerts("Score Job");

    chrome.storage.local.get(jwtTokenKey, (data) => {
      const jwtToken = data.jwtToken;
      if (jwtToken) {
        consoleAlerts("jwt");
        chrome.runtime.sendMessage({ action: "getHTML" }, (response) => {

          consoleAlerts(response.html);
          let html = jobDescriptionParser(response.html);
          let originUrl = response.originUrl;
          consoleAlerts(html);

          //verify that the page is a Job
          let isJob = true //findWholeWord(html, 'job');
          if (isJob) {
            const jobChromeRequest = {
              token: jwtToken,
              html: html,  // You can capture the full HTML of the page or other details
              originUrl: originUrl
            };

            let data = JSON.stringify(jobChromeRequest);

            consoleAlerts(data)

            document.getElementById('scoreEvaluateButton').disabled = true;
            document.getElementById('evalLoading').style.display = 'block';

            fetch(jobresumeanalysis, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtToken}` // Use Bearer token authentication
              },
              body: data
            })
              .then(response => {

                if (response.status === 401) {
                  consoleAlerts('Login Failed. Try again.');
                  chrome.storage.local.remove(jwtTokenKey);
                  window.location.href = chrome.runtime.getURL('login.html')
                } else if (response.ok || response.status === 200) {
                  consoleAlerts("success");
                  return response.json();
                }

              })
              .then(data => {
                consoleAlerts('Job Created: ' + data)
                consoleAlerts(JSON.stringify(data));

                if (data.errorMessage) {
                  consoleAlerts(data.errorMessage);
                } else if (data.result) {
                  consoleAlerts(data.result.markdownResume);
                  let converter = new showdown.Converter();
                  let recommedationConverted = converter.makeHtml(data.result.summaryRecommendations);
                  let element = document.getElementById('evalRecommendations');
                  if (element) {
                    element.innerHTML = recommedationConverted;
                    element.style.display = 'block';
                    document.getElementById('evalScoreSection').style.display = 'block';
                    document.getElementById('evalScore').innerText = data.result.score;
                    document.getElementById('scoreEvaluateButton').disabled = false;

                    //reset the other values

                    document.getElementById('custom').innerHTML = "<i>Placeholder for AI generated tailored resume</i>.";
                    document.getElementById('score').style.cssText = 'display: none !important;';
                    let recom = document.getElementById('recommendations');
                    recom.style.cssText = 'display: none !important;';
                    recom.innerHTML = "";
                  }
                }
              })
              .catch(err => {
                consoleAlerts("is error");
                consoleAlerts('Error:' + err.message);
              })
              .finally(s => {
                document.getElementById('evalLoading').style.cssText = 'display: none !important;';
                document.getElementById('trackGenerateButton').disabled = false;
              });
          }
        });
      }
    });
  });

});