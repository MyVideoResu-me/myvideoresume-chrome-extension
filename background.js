chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getHTML") {
      // Query the current active tab
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs[0];
        
        if(tab === undefined || tab.url === undefined || tab.url.startsWith("chrome://")){
            return;
        }

        // Send a message to the content script to get the HTML
        chrome.scripting.executeScript(
          {
            target: { tabId: tab.id },
            func: () => document.documentElement.outerHTML  // Get the HTML of the current tab
          },
          (result) => {
            if(result){
                const html = result[0].result;
                sendResponse({ html: html, originUrl: tab.url });
            }
          }
        );
      });
      return true;  // Keep the message channel open for the response
    }
  });