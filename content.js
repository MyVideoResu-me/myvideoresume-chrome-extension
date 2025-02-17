// Function to get the HTML of the current page
function getPageHTML() {
    return document.documentElement.outerHTML;  // Get the full HTML of the page
  }
  
  // Send the HTML back to the background script
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getHTML") {
      const html = getPageHTML();
      sendResponse({ html: html });
    }
    return true;  // Keep the message channel open for the response
  });
