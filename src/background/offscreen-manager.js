// src/background/offscreen-manager.js
// Offscreen document management for audio playback

let creatingOffscreen = null;

/**
 * Ensure the offscreen document exists for audio playback
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
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Playing TTS audio when content script is unavailable'
  });
  
  await creatingOffscreen;
  creatingOffscreen = null;
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
