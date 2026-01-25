// offscreen.js - Handles audio playback when content script is unavailable

let currentAudio = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'OFFSCREEN_PLAY_AUDIO') {
    playAudio(message.audio, message.mimeType)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
  
  if (message.type === 'OFFSCREEN_STOP_AUDIO') {
    stopAudio();
    sendResponse({ success: true });
    return false;
  }
});

async function playAudio(base64Audio, mimeType) {
  // Stop any currently playing audio
  stopAudio();
  
  // Convert base64 to blob
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const audioUrl = URL.createObjectURL(blob);
  
  return new Promise((resolve, reject) => {
    currentAudio = new Audio(audioUrl);
    
    currentAudio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      // Notify background that playback finished
      chrome.runtime.sendMessage({ type: 'OFFSCREEN_AUDIO_ENDED' });
      resolve();
    };
    
    currentAudio.onerror = (e) => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      reject(new Error('Audio playback failed'));
    };
    
    currentAudio.play().catch(reject);
  });
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
}
