// src/background/offscreen-manager.js
// Offscreen document management for extension-owned work that should not depend on service worker lifetime

let creatingOffscreen = null;

/**
 * Ensure the offscreen document exists for Blob-backed audio and image FormData work.
 */
export async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  
  // Check if offscreen document already exists
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });
  
  if (existingContexts.length > 0) {
    return; // Already exists
  }
  
  // Avoid race conditions when creating
  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  
  creatingOffscreen = chrome.offscreen.createDocument({
    url: offscreenUrl,
    reasons: ['BLOBS'],
    justification: 'Creating Blob-backed TTS audio and image translation requests from an extension-owned document'
  });
  
  await creatingOffscreen;
  creatingOffscreen = null;
}

/**
 * Start an OpenAI image edit in the offscreen document.
 */
export async function startImageEditViaOffscreen(payload) {
  await ensureOffscreenDocument();

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_OPENAI_IMAGE_EDIT_START',
      payload
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.success) {
        resolve(response);
      } else {
        reject(new Error(response?.error || 'Could not start offscreen image translation'));
      }
    });
  });
}

/**
 * Play audio via the offscreen document
 */
export async function playAudioViaOffscreen(base64Audio, mimeType) {
  await ensureOffscreenDocument();
  
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_PLAY_AUDIO',
      audio: base64Audio,
      mimeType: mimeType
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve();
      } else {
        reject(new Error(response?.error || 'Unknown error playing audio'));
      }
    });
  });
}
