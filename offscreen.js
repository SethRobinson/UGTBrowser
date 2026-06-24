// offscreen.js - Handles extension-owned long-running work when the service worker is not ideal

import { editImageWithOpenAI } from './src/background/api/openai.js';

let currentAudio = null;
const IMAGE_EDIT_TIMEOUT_MS = 180000;

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

  if (message.type === 'OFFSCREEN_OPENAI_IMAGE_EDIT_START') {
    runImageEdit(message.payload)
      .then((result) => {
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_OPENAI_IMAGE_EDIT_COMPLETE',
          ...result
        });
      })
      .catch((error) => {
        const payload = message.payload || {};
        chrome.runtime.sendMessage({
          type: 'OFFSCREEN_OPENAI_IMAGE_EDIT_ERROR',
          requestId: payload.requestId,
          tabId: payload.tabId,
          frameId: payload.frameId,
          elapsedMs: payload.startedAt ? Date.now() - payload.startedAt : undefined,
          error: error.message || String(error)
        });
      });

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

function dataUrlToBlob(dataUrl) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/.exec(dataUrl || '');
  if (!match) {
    throw new Error('Invalid image data URL');
  }

  const mimeType = match[1] || 'image/png';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mimeType });
}

function sendImageEditProgress(payload, progress) {
  chrome.runtime.sendMessage({
    type: 'OFFSCREEN_OPENAI_IMAGE_EDIT_PROGRESS',
    requestId: payload.requestId,
    tabId: payload.tabId,
    frameId: payload.frameId,
    progress
  });
}

async function runImageEdit(payload = {}) {
  const {
    requestId,
    tabId,
    frameId,
    imageDataUrl,
    apiKey,
    prompt,
    model,
    quality,
    size,
    outputFormat,
    startedAt = Date.now()
  } = payload;

  if (!requestId) throw new Error('Image translation request ID is missing.');
  if (!imageDataUrl) throw new Error('Image translation image data is missing.');

  const imageBlob = dataUrlToBlob(imageDataUrl);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_EDIT_TIMEOUT_MS);

  try {
    sendImageEditProgress(payload, {
      title: 'Sending image',
      detail: 'Starting upload',
      loadedBytes: 0,
      totalBytes: payload.imageByteLength || imageBlob.size || null
    });

    const result = await editImageWithOpenAI({
      imageBlob,
      apiKey,
      prompt,
      model,
      quality,
      size,
      outputFormat,
      signal: controller.signal,
      onUploadProgress: ({ loaded, total }) => {
        sendImageEditProgress(payload, {
          title: 'Sending image',
          loadedBytes: loaded,
          totalBytes: total || payload.imageByteLength || imageBlob.size || null
        });
      },
      onUploadComplete: () => {
        sendImageEditProgress(payload, {
          title: 'Waiting for translated image',
          detail: 'OpenAI is processing the image'
        });
      }
    });

    return {
      requestId,
      tabId,
      frameId,
      imageDataUrl: result.dataUrl,
      elapsedMs: Date.now() - startedAt,
      requestedSize: size
    };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`OpenAI image edit timed out after ${Math.round(IMAGE_EDIT_TIMEOUT_MS / 1000)} seconds.`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
