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
    //alert("Add job");

    chrome.storage.local.get(jwtTokenKey, (data) => {
      const jwtToken = data.jwtToken;
      if (jwtToken) {
        //alert("jwt");
        chrome.runtime.sendMessage({ action: "getHTML" }, (response) => {
          let html = response.html;
          let originUrl = response.originUrl;
          //alert(html);
          //alert(originUrl);

          //verify that the page is a Job
          let isJob = true //findWholeWord(html, 'job');
          if (isJob) {

            const jobChromeRequest = {
              token: jwtToken,
              html: html,  // You can capture the full HTML of the page or other details
              originUrl: originUrl
            };

            let data = JSON.stringify(jobChromeRequest);

            //alert(data)

            document.getElementById('custom').innerHTML = "<i>Placeholder for AI generated tailored resume</i>.";
            document.getElementById('addJobButton').disabled = true;
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
                  alert('Login Failed. Try again.');
                  chrome.storage.local.remove(jwtTokenKey);
                  window.location.href = chrome.runtime.getURL('login.html')
                } else if (response.ok || response.status === 200) {
                  //alert("success");
                  return response.json();
                }

              })
              .then(data => {

                //   {
                //    "errorcode": '', 
                //    "errorMessage" : '',
                //     result: {
                //       markdownResume : '',
                //       summaryRecommendations : '',
                //       oldScore : '',
                //       newScore : ''
                //      }
                //    }

                //console.log('Job Created:', data)

                //alert(JSON.stringify(data));
                if (data.errorMessage) {
                  alert(data.errorMessage);
                } else if (data.result) {
                  //alert(data.result.markdownResume);
                  let converter = new showdown.Converter();
                  let htmlConverted = converter.makeHtml(data.result.markdownResume);
                  let recommedationConverted = converter.makeHtml(data.result.summaryRecommendations);
                  //alert(htmlConverted);
                  let element = document.getElementById('custom');
                  if (element) {
                    element.innerHTML = htmlConverted;
                    document.getElementById('score').style.display = 'block';
                    let recom = document.getElementById('recommendations');
                    recom.style.display = 'block';
                    recom.innerHTML = recommedationConverted;
                    document.getElementById('newScore').innerText = data.result.newScore;
                  }
                }
              })
              .catch(err => {
                //alert("is error");
                //console.error('Error:', err.message);
              })
              .finally(s => {
                document.getElementById('loading').style.cssText = 'display: none !important;';
                document.getElementById('addJobButton').disabled = false;
                document.getElementById('disclaimer').style.display = 'block';
              });
          }
        });
      }
    });
  });
});

// "Add Job" button click handler
document.getElementById('evaluateButton').addEventListener('click', () => {
  //alert("Add job");

  chrome.storage.local.get(jwtTokenKey, (data) => {
    const jwtToken = data.jwtToken;
    if (jwtToken) {
      //alert("jwt");
      chrome.runtime.sendMessage({ action: "getHTML" }, (response) => {
        let html = response.html;
        let originUrl = response.originUrl;
        //alert(html);
        //alert(originUrl);

        //verify that the page is a Job
        let isJob = true //findWholeWord(html, 'job');
        if (isJob) {

          const jobChromeRequest = {
            token: jwtToken,
            html: html,  // You can capture the full HTML of the page or other details
            originUrl: originUrl
          };

          let data = JSON.stringify(jobChromeRequest);

          //alert(data)

          document.getElementById('evaluateButton').disabled = true;
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
                alert('Login Failed. Try again.');
                chrome.storage.local.remove(jwtTokenKey);
                window.location.href = chrome.runtime.getURL('login.html')
              } else if (response.ok || response.status === 200) {
                //alert("success");
                return response.json();
              }

            })
            .then(data => {

              //   {
              //    "errorcode": '', 
              //    "errorMessage" : '',
              //     result: {
              //       summaryRecommendations : '',
              //       score : ''
              //      }
              //    }

              //console.log('Job Created:', data)
              //alert(JSON.stringify(data));
              
              if (data.errorMessage) {
                alert(data.errorMessage);
              } else if (data.result) {
                //alert(data.result.markdownResume);
                let converter = new showdown.Converter();
                let recommedationConverted = converter.makeHtml(data.result.summaryRecommendations);
                let element = document.getElementById('evalRecommendations');
                if (element) {
                  element.innerHTML = recommedationConverted;
                  element.style.display = 'block';
                  document.getElementById('evalScoreSection').style.display = 'block';
                  document.getElementById('evalScore').innerText = data.result.score;
                  document.getElementById('addJobButton').disabled = false;
                  
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
              //alert("is error");
              //console.error('Error:', err.message);
            })
            .finally(s => {
              document.getElementById('evalLoading').style.cssText = 'display: none !important;';
              document.getElementById('evaluateButton').disabled = false;
            });
        }
      });
    }
  });
});



function findWholeWord(text, word) {
  const regex = new RegExp('\\b' + word + '\\b');
  return regex.test(text);
}

