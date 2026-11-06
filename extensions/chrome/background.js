// HeyGuy Chrome Extension Background Service Worker
// Bridges browser tab actions with the desktop companion via Chrome Native Messaging.

const HOST_NAME = 'dev.thanmay.heyguy';
let port = null;

function connectHost() {
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener(handleHostMessage);
    port.onDisconnect.addListener(() => {
      port = null;
      setTimeout(connectHost, 5000);
    });
  } catch (err) {
    console.warn('[heyguy-ext] Native host connection failed:', err);
  }
}

async function handleHostMessage(msg) {
  if (!msg || !msg.id || !msg.action) return;
  const { id, action, params } = msg;

  try {
    if (action === 'query_tabs') {
      const tabs = await chrome.tabs.query({});
      const summaries = tabs.map((t) => ({ id: t.id, url: t.url, title: t.title, active: t.active }));
      port?.postMessage({ id, success: true, data: summaries });
      return;
    }

    if (action === 'navigate') {
      const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.id || !params?.url) throw new Error('No active tab or URL specified');
      await chrome.tabs.update(tab.id, { url: params.url });
      port?.postMessage({ id, success: true });
      return;
    }

    if (action === 'extract_content' || action === 'click_element') {
      const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!tab?.id) throw new Error('No active tab found');
      const res = await chrome.tabs.sendMessage(tab.id, { action, params });
      port?.postMessage({ id, success: true, data: res });
      return;
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (err) {
    port?.postMessage({ id, success: false, error: err.message || String(err) });
  }
}

connectHost();

