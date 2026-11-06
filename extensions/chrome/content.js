// HeyGuy Content Script: runs inside authorized web pages
chrome.runtime.onMessage.addListener((req, _sender, sendResponse) => {
  if (req.action === 'extract_content') {
    const text = document.body ? document.body.innerText.slice(0, 50000) : '';
    const title = document.title || '';
    sendResponse({ title, text });
    return true;
  }

  if (req.action === 'click_element') {
    const sel = req.params?.selector;
    if (!sel) {
      sendResponse({ error: 'No selector provided' });
      return true;
    }
    const el = document.querySelector(sel);
    if (!el) {
      sendResponse({ error: `Element not found: ${sel}` });
      return true;
    }
    el.click();
    sendResponse({ clicked: true });
    return true;
  }
});

