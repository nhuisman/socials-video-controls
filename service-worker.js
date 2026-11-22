'use strict';

// Automatically inject CSS & JS into already-open Instagram tabs on install/reload
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const tabs = await chrome.tabs.query({ url: ['*://*.instagram.com/*', '*://*.facebook.com/*'] });
    for (const tab of tabs) {
      if (!tab.id) continue;
      try {
        await chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ['content/content.css']
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/capture-url.js', 'content/core.js', 'content/content.js']
        });
      } catch (err) {
        // Ignore restricted tabs
      }
    }
  } catch (err) {
    // Ignore errors
  }
});
