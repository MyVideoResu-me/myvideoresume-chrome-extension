chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Forward URL change notifications from content script to sidepanel
  if (request.action === "urlChanged") {
    // Broadcast to all extension pages (including sidepanel)
    chrome.runtime.sendMessage(request).catch(() => {
      // Sidepanel might not be open, ignore
    });
    return false;
  }

  if (request.action === "getHTML") {
    // Query the current active tab
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];

      if (tab === undefined || tab.url === undefined || tab.url.startsWith("chrome://")) {
        sendResponse({ html: null, error: "Cannot access this page" });
        return;
      }

      try {
        // First, try to send message to content script (preferred - handles SPAs better)
        chrome.tabs.sendMessage(tab.id, { action: "getHTML", timeout: 3000 }, (response) => {
          if (chrome.runtime.lastError || !response) {
            // Content script not loaded or not responding, inject and execute directly
            console.log("Content script not responding, using direct injection");
            chrome.scripting.executeScript(
              {
                target: { tabId: tab.id },
                func: () => document.documentElement.outerHTML
              },
              (result) => {
                if (chrome.runtime.lastError) {
                  sendResponse({ html: null, error: chrome.runtime.lastError.message });
                } else if (result && result[0]) {
                  sendResponse({ html: result[0].result, originUrl: tab.url });
                } else {
                  sendResponse({ html: null, error: "Could not get page content" });
                }
              }
            );
          } else {
            // Content script responded with HTML
            sendResponse(response);
          }
        });
      } catch (e) {
        console.error("Error getting HTML:", e);
        sendResponse({ html: null, error: e.message });
      }
    });
    return true;  // Keep the message channel open for the async response
  }
});