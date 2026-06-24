// src/background/main.js
// Main background script entry point - message routing and coordination

import {
  CONTEXT_MENU_TRANSLATE,
  CONTEXT_MENU_TRANSLATE_SIMPLE,
  CONTEXT_MENU_TRANSLATE_IMAGE,
  CONTEXT_MENU_SPEAK,
  CONTEXT_MENU_LESSON,
  CONTEXT_MENU_ASK,
  CONTEXT_MENU_SETTINGS,
  defaultPrompts,
  defaultLessonPrompt,
  unifiedDefaultPrompt
} from '../shared/constants.js';

import { isRestrictedUrl, supportsTemperature } from '../shared/utils.js';

import { fetchFromOpenAI, fetchFromOpenAIStreaming } from './api/openai.js';
import { fetchFromAnthropic, fetchFromAnthropicStreaming } from './api/anthropic.js';
import { fetchFromGemini, fetchFromGeminiStreaming } from './api/gemini.js';
import { fetchFromElevenLabs, fetchFromGoogleTTS } from './api/tts.js';

import {
  fetchChatStreaming,
  fetchLessonStreaming,
  fetchLessonChatStreaming,
  fetchAskStreaming
} from './streaming.js';

import {
  initializeContextMenus,
  setupSettingsChangeListener,
  setupContextMenuVisibilityListener
} from './context-menus.js';

import { ensureOffscreenDocument, playAudioViaOffscreen, startImageEditViaOffscreen } from './offscreen-manager.js';
import { buildChatPrompt, buildLessonChatPrompt, buildAskPrompt } from './prompt-builders.js';

// ========================================
// STATE MANAGEMENT
// ========================================

// Track active streaming ports for heartbeat responses
const activeStreamingPorts = new Map();

// Track active chat sessions for cancellation
const activeChatSessions = new Map();

// Store the last request and response for debugging
let lastLLMRequest = null;
let lastLLMResponse = null;
let lastImageTranslationRequest = null;
let lastImageTranslationResponse = null;

// ========================================
// HEARTBEAT AND CONNECTION MONITORING
// ========================================

// Set up an interval to check for stalled connections
setInterval(() => {
  const now = Date.now();
  
  activeStreamingPorts.forEach((portInfo, portId) => {
    const { port, lastActivity } = portInfo;
    const inactiveTime = now - lastActivity;
    
    // If inactive for more than 60 seconds, send a status check
    if (inactiveTime > 60000) {
      console.log(`Port ${portId} inactive for ${inactiveTime/1000} seconds, sending status check`);
      try {
        port.postMessage({ type: "STATUS_CHECK", message: "Checking connection status - please respond" });
      } catch (e) {
        console.error(`Error sending status check to port ${portId}:`, e);
        activeStreamingPorts.delete(portId);
      }
    }
    
    // If inactive for more than 5 minutes, consider it lost
    if (inactiveTime > 300000) {
      console.warn(`Port ${portId} inactive for 5+ minutes, considering connection lost`);
      try {
        port.postMessage({ type: "STREAM_ERROR", error: "Connection timed out after 5 minutes of inactivity" });
        port.disconnect();
      } catch (e) {
        console.error(`Error disconnecting stalled port ${portId}:`, e);
      }
      activeStreamingPorts.delete(portId);
    }
  });
}, 30000);

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Show a warning notification for restricted pages
 */
function showRestrictedPageWarning(url, action = 'translate') {
  let pageType = "this page";
  if (url) {
    const lowerUrl = url.toLowerCase();
    if (lowerUrl.startsWith('chrome-extension://')) pageType = "Chrome extension pages";
    else if (lowerUrl.startsWith('chrome://')) pageType = "Chrome internal pages";
    else if (lowerUrl.startsWith('edge://')) pageType = "Edge internal pages";
    else if (lowerUrl.startsWith('about:')) pageType = "browser about pages";
    else if (lowerUrl.startsWith('file://')) pageType = "local file pages";
    else pageType = "this type of page";
  }
  
  const actionVerb = action === 'speak' ? 'use text-to-speech' : 
                     action === 'lesson' ? 'create a lesson' : 
                     action === 'ask' ? 'ask about selection' : 'translate';
  
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'UGTBrowser',
    message: `Cannot ${actionVerb} on ${pageType}. Browser security prevents extensions from modifying content on these protected pages.`,
    priority: 1
  }, (notificationId) => {
    if (chrome.runtime.lastError) {
      console.error("Error showing notification:", chrome.runtime.lastError.message);
    }
    setTimeout(() => chrome.notifications.clear(notificationId), 5000);
  });
}

/**
 * Open standalone popup window for restricted pages
 */
function openStandaloneWindow(action, text, options = {}) {
  const { isRestricted = true, simpleMode = false } = options;
  const encodedText = encodeURIComponent(text);
  const restrictedParam = isRestricted ? '&restricted=true' : '';
  const simpleModeParam = simpleMode ? '&simpleMode=true' : '';
  const url = chrome.runtime.getURL(`standalone.html?action=${action}&text=${encodedText}${restrictedParam}${simpleModeParam}`);
  
  chrome.windows.create({
    url: url,
    type: 'popup',
    width: 700,
    height: 600,
    focused: true
  });
}

/**
 * Handle TTS on restricted pages via offscreen document
 */
async function handleTTSForRestrictedPage(text) {
  const data = await chrome.storage.local.get([
    'ttsProvider', 'elevenlabsApiKey', 'elevenlabsVoice', 'elevenlabsCustomVoiceId', 'elevenlabsModel',
    'googleTtsApiKey', 'googleTtsVoice', 'googleTtsSpeakingRate', 'googleTtsPitch'
  ]);
  
  const ttsProvider = data.ttsProvider || 'elevenlabs';
  
  try {
    let base64Audio, mimeType;
    
    if (ttsProvider === 'google') {
      const apiKey = data.googleTtsApiKey;
      if (!apiKey) {
        showTTSNotConfiguredNotification('Google Cloud TTS');
        return;
      }
      base64Audio = await fetchFromGoogleTTS(
        text, 
        data.googleTtsVoice || 'en-US-Studio-O', 
        apiKey, 
        data.googleTtsSpeakingRate || 1.0, 
        data.googleTtsPitch || 0
      );
      mimeType = "audio/mp3";
    } else {
      const apiKey = data.elevenlabsApiKey;
      if (!apiKey) {
        showTTSNotConfiguredNotification('ElevenLabs');
        return;
      }
      const customVoiceId = data.elevenlabsCustomVoiceId || '';
      const voiceId = customVoiceId.length > 0 ? customVoiceId : (data.elevenlabsVoice || "21m00Tcm4TlvDq8ikWAM");
      base64Audio = await fetchFromElevenLabs(text, voiceId, apiKey, data.elevenlabsModel || "eleven_multilingual_v2");
      mimeType = "audio/mpeg";
    }
    
    console.log('Playing TTS via offscreen document (restricted page)');
    await playAudioViaOffscreen(base64Audio, mimeType);
  } catch (error) {
    const providerName = ttsProvider === 'google' ? 'Google TTS' : 'ElevenLabs';
    console.error(`${providerName} TTS error on restricted page:`, error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon128.png',
      title: 'UGTBrowser',
      message: `${providerName} TTS error: ${error.message}`,
      priority: 1
    }, (notificationId) => {
      setTimeout(() => chrome.notifications.clear(notificationId), 5000);
    });
  }
}

function showTTSNotConfiguredNotification(providerName) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icon128.png',
    title: 'UGTBrowser',
    message: `${providerName} API key is not configured. Please add your API key in UGTBrowser Settings.`,
    priority: 1
  }, (notificationId) => {
    setTimeout(() => chrome.notifications.clear(notificationId), 5000);
  });
}

/**
 * Get selection text from context menu info or page
 */
async function getSelectionText(info, tab) {
  if (info.selectionText) {
    return info.selectionText;
  }
  
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(
      tab.id,
      { type: "GET_SELECTION" },
      { frameId: info.frameId },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn("Could not get selection from page:", chrome.runtime.lastError.message);
          resolve(null);
        } else if (response && response.selectionText) {
          resolve(response.selectionText);
        } else {
          resolve(null);
        }
      }
    );
  });
}

/**
 * Get API key for the specified provider
 */
function getApiKeyForProvider(provider, data) {
  if (provider === 'openai') return data.openaiApiKey;
  if (provider === 'anthropic') return data.anthropicApiKey;
  if (provider === 'gemini') return data.geminiApiKey;
  return null;
}

function getImageTranslationTargetLanguage(data) {
  const settings = data.settings || {};
  const languageMode = data.languageMode || settings.languageMode || 'standard';

  if (languageMode === 'custom') {
    return (data.customLanguage || settings.customLanguage || settings.targetLang || 'English').trim() || 'English';
  }

  return data.targetLanguage || settings.targetLang || 'English';
}

function buildImageTranslationPrompt(targetLanguage) {
  return [
    `Translate all visible source-language text in this image to ${targetLanguage} directly in the image.`,
    'Preserve the original layout, borders, spacing, alignment, typography hierarchy, photos, graphics, and overall visual appearance.',
    'Favor literal translation over paraphrase. Preserve reading order, dates, names, brands, quoted titles, and unusual phrasing as much as possible.',
    'Resize translated text as needed to fit the original text regions.',
    'Do not add subtitles, annotations, callouts, bounding boxes, JSON, coordinates, or side-by-side translations.',
    'Do not leave untranslated source-language text visible unless it is a proper noun, brand name, or intentionally untranslated title.'
  ].join(' ');
}

function chooseImageEditSize(width, height) {
  const minPixels = 655360;
  const maxPixels = 8294400;
  const multiple = 16;

  if (!width || !height) {
    return 'auto';
  }

  let aspect = width / height;
  aspect = Math.min(3, Math.max(1 / 3, aspect));

  let targetWidth = Math.sqrt(minPixels * aspect);
  let targetHeight = targetWidth / aspect;

  const roundUpToMultiple = (value) => Math.max(multiple, Math.ceil(value / multiple) * multiple);
  let outputWidth = roundUpToMultiple(targetWidth);
  let outputHeight = roundUpToMultiple(targetHeight);

  while (outputWidth * outputHeight < minPixels) {
    if (outputWidth / outputHeight < aspect) {
      outputWidth += multiple;
    } else {
      outputHeight += multiple;
    }
  }

  while (outputWidth * outputHeight > maxPixels) {
    outputWidth = Math.max(multiple, outputWidth - multiple);
    outputHeight = Math.max(multiple, outputHeight - multiple);
  }

  return `${outputWidth}x${outputHeight}`;
}

function sendMessageToFrame(tabId, frameId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, { frameId }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function captureVisibleTab(windowId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!dataUrl) {
        reject(new Error('Could not capture the visible tab'));
      } else {
        resolve(dataUrl);
      }
    });
  });
}

function estimateDataUrlByteLength(dataUrl) {
  const value = String(dataUrl || '');
  const comma = value.indexOf(',');
  if (comma === -1) return value.length;
  const metadata = value.slice(0, comma);
  const payload = value.slice(comma + 1);
  return metadata.includes(';base64') ? Math.floor(payload.length * 3 / 4) : payload.length;
}

function sendImageTranslationProgress(tabId, frameId, requestId, progress) {
  return sendMessageToFrame(tabId, frameId, {
    type: "UGT_IMAGE_TRANSLATION_PROGRESS",
    requestId,
    progress
  }).catch(() => null);
}

function createInactiveTab(url) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

function removeTab(tabId) {
  return new Promise((resolve) => {
    chrome.tabs.remove(tabId, () => resolve());
  });
}

async function waitForContentScript(tabId, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await sendMessageToFrame(tabId, 0, { type: "PING" });
      if (response?.status === "ok") return;
    } catch {
      // Retry until the tab finishes loading and the content script is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The image source tab did not become ready.');
}

async function fetchImageFromSourceTab(sourceUrl) {
  if (!/^https?:\/\//i.test(sourceUrl || '')) {
    throw new Error('Image source tab fallback only supports http and https images.');
  }

  let sourceTab = null;
  try {
    sourceTab = await createInactiveTab(sourceUrl);
    await waitForContentScript(sourceTab.id);
    const result = await sendMessageToFrame(sourceTab.id, 0, {
      type: "UGT_IMAGE_TRANSLATION_FETCH_URL",
      sourceUrl
    });

    if (!result?.ok || !result.imageDataUrl) {
      throw new Error(result?.error || 'Could not fetch the full image from the source tab.');
    }

    return result;
  } finally {
    if (sourceTab?.id) {
      await removeTab(sourceTab.id);
    }
  }
}

function setImageTranslationDebugRequest(details) {
  lastImageTranslationRequest = {
    timestamp: new Date().toISOString(),
    ...details
  };
}

function setImageTranslationDebugResponse(details) {
  lastImageTranslationResponse = {
    timestamp: new Date().toISOString(),
    ...details
  };
}

async function handleOffscreenImageEditComplete(message) {
  const {
    requestId,
    tabId,
    frameId = 0,
    imageDataUrl,
    elapsedMs,
    requestedSize
  } = message;

  setImageTranslationDebugResponse({
    requestId,
    status: 'complete',
    elapsedMs,
    requestedSize
  });

  const response = await sendMessageToFrame(tabId, frameId, {
    type: "UGT_IMAGE_TRANSLATION_COMPLETE",
    requestId,
    imageDataUrl,
    elapsedMs,
    requestedSize
  });

  if (!response?.ok) {
    const error = response?.error || 'Content script did not apply the translated image.';
    setImageTranslationDebugResponse({
      requestId,
      status: 'error',
      elapsedMs,
      requestedSize,
      error
    });
    await sendMessageToFrame(tabId, frameId, {
      type: "UGT_IMAGE_TRANSLATION_ERROR",
      requestId,
      error
    }).catch(() => null);
    throw new Error(error);
  }
}

async function handleOffscreenImageEditError(message) {
  const {
    requestId,
    tabId,
    frameId = 0,
    error,
    elapsedMs
  } = message;

  setImageTranslationDebugResponse({
    requestId,
    status: 'error',
    elapsedMs,
    error: error || 'Image translation failed'
  });

  await sendMessageToFrame(tabId, frameId, {
    type: "UGT_IMAGE_TRANSLATION_ERROR",
    requestId,
    error: error || 'Image translation failed'
  });
}

// ========================================
// TRANSLATION FUNCTIONS
// ========================================

async function fetchTranslationStreaming(promptText, settings, port, abortSignal = null) {
  const { provider = "openai", model, apiKey } = settings;
  
  lastLLMRequest = {
    timestamp: new Date().toISOString(),
    prompt: promptText,
    provider,
    model,
    streaming: true
  };
  
  console.log(`Starting fetchTranslationStreaming for provider: ${provider}`);
  
  let accumulatedStreamForDebug = "";
  const streamUpdateCallbackForDebug = (chunk) => {
    if (typeof chunk === 'string') accumulatedStreamForDebug += chunk;
  };
  
  try {
    switch (provider) {
      case "openai":
        await fetchFromOpenAIStreaming(promptText, model, apiKey, port, streamUpdateCallbackForDebug, settings, abortSignal);
        break;
      case "anthropic":
        await fetchFromAnthropicStreaming(promptText, model, apiKey, port, streamUpdateCallbackForDebug, abortSignal);
        break;
      case "gemini":
        await fetchFromGeminiStreaming(promptText, model, apiKey, port, streamUpdateCallbackForDebug, settings, abortSignal);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
    
    lastLLMResponse = {
      timestamp: new Date().toISOString(),
      response: accumulatedStreamForDebug,
      provider,
      model,
      streaming: true
    };
    console.log("fetchTranslationStreaming completed successfully for provider:", provider);
  } catch (e) {
    console.error(`${provider} API error in fetchTranslationStreaming:`, e);
    lastLLMResponse = {
      timestamp: new Date().toISOString(),
      error: e.message || String(e),
      provider,
      model,
      streaming: true
    };
    throw e;
  }
}

async function fetchTranslation(promptText, settings) {
  const { provider = "openai", model, apiKey, internalBatch } = settings;
  
  lastLLMRequest = {
    timestamp: new Date().toISOString(),
    prompt: promptText,
    provider,
    model
  };
  
  if (internalBatch) {
    try {
      let result;
      switch (provider) {
        case "openai":
          result = await fetchFromOpenAI(promptText, model, apiKey);
          break;
        case "anthropic":
          result = await fetchFromAnthropic(promptText, model, apiKey);
          break;
        case "gemini":
          result = await fetchFromGemini(promptText, model, apiKey);
          break;
        default:
          throw new Error(`Unknown provider: ${provider}`);
      }
      
      lastLLMResponse = {
        timestamp: new Date().toISOString(),
        response: result,
        provider,
        model
      };
      
      return result;
    } catch (e) {
      console.error(`${provider} API error:`, e);
      lastLLMResponse = {
        timestamp: new Date().toISOString(),
        error: e.message || String(e),
        provider,
        model
      };
      throw e;
    }
  } else {
    throw new Error("Direct translation not supported");
  }
}

// ========================================
// MESSAGE HANDLERS
// ========================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_TRANSLATION") {
    handleTranslationMessage(message, sender, sendResponse);
    return true;
  }
  
  if (message.type === "OPEN_SETTINGS") {
    chrome.runtime.openOptionsPage();
    return false;
  }
  
  if (message.type === "GET_LAST_LLM_DATA") {
    sendResponse({
      lastRequest: lastLLMRequest,
      lastResponse: lastLLMResponse,
      lastImageRequest: lastImageTranslationRequest,
      lastImageResponse: lastImageTranslationResponse
    });
    return true;
  }

  if (message.type === "OFFSCREEN_OPENAI_IMAGE_EDIT_COMPLETE") {
    handleOffscreenImageEditComplete(message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === "OFFSCREEN_OPENAI_IMAGE_EDIT_PROGRESS") {
    sendImageTranslationProgress(message.tabId, message.frameId ?? 0, message.requestId, message.progress || {})
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === "OFFSCREEN_OPENAI_IMAGE_EDIT_ERROR") {
    handleOffscreenImageEditError(message)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message || String(error) }));
    return true;
  }
  
  // Relay messages to content script
  if (message.type === "UGT_SHOW_OVERLAY_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_SHOW_OVERLAY", provider: message.provider });
    return;
  }
  if (message.type === "UGT_HIDE_OVERLAY_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_HIDE_OVERLAY", force: message.force });
    return;
  }
  if (message.type === "UGT_SHOW_ERROR_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_SHOW_ERROR", message: message.message, errorContext: message.errorContext });
    return;
  }
  if (message.type === "UGT_UPDATE_OVERLAY_PREVIEW_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_UPDATE_OVERLAY_PREVIEW", text: message.text });
    return;
  }
  if (message.type === "UGT_TRANSLATION_COMPLETE_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_TRANSLATION_COMPLETE", provider: message.provider });
    return;
  }
  if (message.type === "UGT_OPEN_PREVIEW_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_OPEN_PREVIEW", text: message.text });
    return;
  }
  if (message.type === "UGT_HIDE_TTS_OVERLAY_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_HIDE_TTS_OVERLAY" });
    return;
  }
  
  // TTS test handlers
  if (message.type === "TEST_TTS") {
    handleTTSTest(message, sendResponse);
    return true;
  }
  if (message.type === "TEST_GOOGLE_TTS") {
    handleGoogleTTSTest(message, sendResponse);
    return true;
  }
  
  if (message.type === "OFFSCREEN_AUDIO_ENDED") {
    console.log("Offscreen audio playback completed");
    return false;
  }
  
  if (message.type === "STANDALONE_TRANSLATE") {
    handleStandaloneTranslate(message, sendResponse);
    return true;
  }
  
  // Chat followup handler
  if (message.type === "CHAT_FOLLOWUP") {
    handleChatFollowup(message, sender, sendResponse);
    return true;
  }
  if (message.type === "CHAT_CANCEL") {
    handleChatCancel(message, sendResponse);
    return true;
  }
  
  // Lesson handlers
  if (message.type === "LESSON_REQUEST") {
    handleLessonRequest(message, sender, sendResponse);
    return true;
  }
  if (message.type === "LESSON_FOLLOWUP") {
    handleLessonFollowup(message, sender, sendResponse);
    return true;
  }
  if (message.type === "LESSON_CANCEL") {
    handleLessonCancel(message, sendResponse);
    return true;
  }
  
  // Ask handlers
  if (message.type === "ASK_REQUEST") {
    handleAskRequest(message, sender, sendResponse);
    return true;
  }
  if (message.type === "ASK_CANCEL") {
    handleAskCancel(message, sendResponse);
    return true;
  }
});

function handleTranslationMessage(message, sender, sendResponse) {
  const { textPayload, settings, simpleMode } = message.payload;
  
  let actualPromptText = "";
  const provider = settings.provider || "openai";
  const targetLang = settings.targetLang || "English";

  // In simpleMode, always use the simple unified prompt without creative tasks
  if (simpleMode) {
    actualPromptText = unifiedDefaultPrompt;
  } else if (settings.promptTemplate && settings.promptTemplate.trim() !== "") {
    actualPromptText = settings.promptTemplate;
  } else {
    actualPromptText = defaultPrompts[provider] || defaultPrompts["openai"];
  }

  // Transform textPayload to the <ugt_id>Text</ugt_id> format
  const SEGMENT_DELIMITER = '\n<<<UGT_SEG>>>\n';
  const transformedTextPayload = textPayload.split(SEGMENT_DELIMITER).map(segment => {
    const match = segment.match(/^(ugt_[^:]+):\s*([\s\S]*)$/);
    if (match) {
      return `<${match[1]}>${match[2].trim()}</${match[1]}>`;
    }
    return segment;
  }).join('\n');

  actualPromptText = actualPromptText.replace("{{text}}", transformedTextPayload);
  actualPromptText = actualPromptText.replace("{{target}}", targetLang);

  if (settings.streaming) {
    let port = chrome.tabs.connect(sender.tab.id, { name: "translation_stream", frameId: sender.frameId });
    if (chrome.runtime.lastError) {
      console.error("Failed to connect to tab:", chrome.runtime.lastError.message);
      sendResponse({ success: false, error: "Failed to establish streaming connection: " + chrome.runtime.lastError.message });
      return;
    }
    
    const portId = Date.now().toString();
    const abortController = new AbortController();
    activeStreamingPorts.set(portId, { port, tabId: sender.tab.id, lastActivity: Date.now(), abortController });
    
    port.onDisconnect.addListener(() => {
      console.log(`Port ${portId} disconnected, aborting stream`);
      abortController.abort();
      activeStreamingPorts.delete(portId);
    });
    
    port.onMessage.addListener((msg) => {
      const portInfo = activeStreamingPorts.get(portId);
      if (!portInfo) return;

      portInfo.lastActivity = Date.now();
      activeStreamingPorts.set(portId, portInfo);

      if (msg.type === "HEARTBEAT") {
        try {
          port.postMessage({ type: "HEARTBEAT_RESPONSE", timestamp: Date.now() });
        } catch (e) {
          console.error("Error sending HEARTBEAT_RESPONSE:", e);
          activeStreamingPorts.delete(portId);
        }
      } else if (msg.type === "STATUS_RESPONSE") {
        console.log("Status response from content script:", msg.status);
      }
    });
    
    fetchTranslationStreaming(actualPromptText, settings, port, abortController.signal)
      .then(() => {
        if (!abortController.signal.aborted) {
          try {
            port.postMessage({ type: "STREAM_COMPLETE", success: true, simpleMode: !!simpleMode });
          } catch (e) {
            console.log("Could not send STREAM_COMPLETE:", e.message);
          }
        }
      })
      .catch(error => {
        if (error.name === 'AbortError' || abortController.signal.aborted) {
          console.log("Translation streaming was cancelled by user");
          return;
        }
        console.error("fetchTranslationStreaming error:", error);
        try {
          port.postMessage({ type: "STREAM_ERROR", error: error.message || String(error) });
        } catch (e) {
          console.error("Error sending STREAM_ERROR:", e);
        }
      });
    
    sendResponse({ status: "streaming_started" });
  } else {
    fetchTranslation(actualPromptText, settings)
      .then(result => sendResponse({ success: true, result }))
      .catch(error => {
        console.error("Translation error:", error);
        sendResponse({ success: false, error: error.message || String(error) });
      });
  }
}

function handleTTSTest(message, sendResponse) {
  const { text, voiceId, apiKey, modelId } = message.payload;
  fetchFromElevenLabs(text, voiceId, apiKey, modelId)
    .then(base64Audio => sendResponse({ success: true, audio: base64Audio, mimeType: "audio/mpeg" }))
    .catch(error => sendResponse({ success: false, error: error.message || String(error) }));
}

function handleGoogleTTSTest(message, sendResponse) {
  const { text, voiceId, apiKey, speakingRate, pitch } = message.payload;
  fetchFromGoogleTTS(text, voiceId, apiKey, speakingRate, pitch)
    .then(base64Audio => sendResponse({ success: true, audio: base64Audio, mimeType: "audio/mp3" }))
    .catch(error => sendResponse({ success: false, error: error.message || String(error) }));
}

async function handleStandaloneTranslate(message, sendResponse) {
  const { sessionId, text } = message;
  
  const data = await chrome.storage.local.get(['settings', 'selectedProvider', 'openaiApiKey', 'anthropicApiKey', 'geminiApiKey']);
  const storedSettings = data.settings || {};
  const provider = data.selectedProvider || storedSettings.provider || 'openai';
  const model = storedSettings.model;
  const targetLang = storedSettings.targetLang || 'English';
  
  const apiKey = getApiKeyForProvider(provider, data);
  
  if (!apiKey) {
    chrome.runtime.sendMessage({
      type: 'STANDALONE_ERROR',
      sessionId,
      error: `No API key configured for ${provider}. Please check your settings.`
    });
    return;
  }
  
  const prompt = `Translate the following text to ${targetLang}. Provide only the translation, no explanations:\n\n${text}`;
  
  try {
    let result;
    if (provider === 'openai') result = await fetchFromOpenAI(prompt, model, apiKey);
    else if (provider === 'anthropic') result = await fetchFromAnthropic(prompt, model, apiKey);
    else if (provider === 'gemini') result = await fetchFromGemini(prompt, model, apiKey);
    
    chrome.runtime.sendMessage({ type: 'STANDALONE_RESULT', sessionId, content: result });
  } catch (error) {
    chrome.runtime.sendMessage({ type: 'STANDALONE_ERROR', sessionId, error: error.message || String(error) });
  }
  
  sendResponse({ status: "started" });
}

async function handleChatFollowup(message, sender, sendResponse) {
  const { sessionId, question, originalText, translatedText, culturalNuances, chatHistory } = message.payload;
  
  if (!sessionId) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "CHAT_STREAM_ERROR", sessionId: null, error: "Internal error: No session ID provided" }, { frameId: sender.frameId });
    sendResponse({ status: "error", error: "No session ID" });
    return;
  }
  
  const data = await chrome.storage.local.get(['settings', 'selectedProvider', 'openaiApiKey', 'anthropicApiKey', 'geminiApiKey']);
  const settings = data.settings || {};
  const provider = data.selectedProvider || settings.provider || 'openai';
  const model = settings.model;
  const apiKey = getApiKeyForProvider(provider, data);
  
  if (!apiKey) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "CHAT_STREAM_ERROR", sessionId, error: `No API key configured for ${provider}. Please check your settings.` }, { frameId: sender.frameId });
    return;
  }
  
  const abortController = new AbortController();
  activeChatSessions.set(sessionId, { abortController, tabId: sender.tab.id, frameId: sender.frameId });
  
  const chatPrompt = buildChatPrompt(question, originalText, culturalNuances, chatHistory, translatedText);
  
  try {
    await fetchChatStreaming(chatPrompt, provider, model, apiKey, sender.tab.id, sender.frameId, settings, sessionId, abortController.signal);
    if (!abortController.signal.aborted) {
      chrome.tabs.sendMessage(sender.tab.id, { type: "CHAT_STREAM_COMPLETE", sessionId }, { frameId: sender.frameId });
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error("Chat followup error:", error);
      chrome.tabs.sendMessage(sender.tab.id, { type: "CHAT_STREAM_ERROR", sessionId, error: error.message || String(error) }, { frameId: sender.frameId });
    }
  } finally {
    activeChatSessions.delete(sessionId);
  }
  
  sendResponse({ status: "chat_started", sessionId });
}

function handleChatCancel(message, sendResponse) {
  const { sessionId } = message.payload;
  const session = activeChatSessions.get(sessionId);
  if (session?.abortController) {
    session.abortController.abort();
    activeChatSessions.delete(sessionId);
  }
  sendResponse({ status: "cancelled", sessionId });
}

async function handleLessonRequest(message, sender, sendResponse) {
  const { sessionId, selectedText, lessonPrompt } = message.payload;
  
  if (!sessionId) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "LESSON_STREAM_ERROR", sessionId: null, error: "Internal error: No session ID provided" }, { frameId: sender.frameId });
    sendResponse({ status: "error", error: "No session ID" });
    return;
  }
  
  const data = await chrome.storage.local.get(['settings', 'selectedProvider', 'openaiApiKey', 'anthropicApiKey', 'geminiApiKey']);
  const settings = data.settings || {};
  const provider = data.selectedProvider || settings.provider || 'openai';
  const model = settings.model;
  const apiKey = getApiKeyForProvider(provider, data);
  
  if (!apiKey) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "LESSON_STREAM_ERROR", sessionId, error: `No API key configured for ${provider}. Please check your settings.` }, { frameId: sender.frameId });
    return;
  }
  
  const abortController = new AbortController();
  activeChatSessions.set(sessionId, { abortController, tabId: sender.tab.id, frameId: sender.frameId });
  
  const fullPrompt = lessonPrompt.replace('{0}', selectedText);
  
  try {
    await fetchLessonStreaming(fullPrompt, provider, model, apiKey, sender.tab.id, sender.frameId, settings, sessionId, abortController.signal);
    if (!abortController.signal.aborted) {
      chrome.tabs.sendMessage(sender.tab.id, { type: "LESSON_STREAM_COMPLETE", sessionId }, { frameId: sender.frameId });
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error("Lesson request error:", error);
      chrome.tabs.sendMessage(sender.tab.id, { type: "LESSON_STREAM_ERROR", sessionId, error: error.message || String(error) }, { frameId: sender.frameId });
    }
  } finally {
    activeChatSessions.delete(sessionId);
  }
  
  sendResponse({ status: "lesson_started", sessionId });
}

async function handleLessonFollowup(message, sender, sendResponse) {
  const { sessionId, question, originalText, lessonContent, chatHistory } = message.payload;
  
  if (!sessionId) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "LESSON_CHAT_STREAM_ERROR", sessionId: null, error: "Internal error: No session ID provided" }, { frameId: sender.frameId });
    sendResponse({ status: "error", error: "No session ID" });
    return;
  }
  
  const data = await chrome.storage.local.get(['settings', 'selectedProvider', 'openaiApiKey', 'anthropicApiKey', 'geminiApiKey']);
  const settings = data.settings || {};
  const provider = data.selectedProvider || settings.provider || 'openai';
  const model = settings.model;
  const apiKey = getApiKeyForProvider(provider, data);
  
  if (!apiKey) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "LESSON_CHAT_STREAM_ERROR", sessionId, error: `No API key configured for ${provider}. Please check your settings.` }, { frameId: sender.frameId });
    return;
  }
  
  const abortController = new AbortController();
  activeChatSessions.set(sessionId, { abortController, tabId: sender.tab.id, frameId: sender.frameId });
  
  const chatPrompt = buildLessonChatPrompt(question, originalText, lessonContent, chatHistory);
  
  try {
    await fetchLessonChatStreaming(chatPrompt, provider, model, apiKey, sender.tab.id, sender.frameId, settings, sessionId, abortController.signal);
    if (!abortController.signal.aborted) {
      chrome.tabs.sendMessage(sender.tab.id, { type: "LESSON_CHAT_STREAM_COMPLETE", sessionId }, { frameId: sender.frameId });
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error("Lesson chat error:", error);
      chrome.tabs.sendMessage(sender.tab.id, { type: "LESSON_CHAT_STREAM_ERROR", sessionId, error: error.message || String(error) }, { frameId: sender.frameId });
    }
  } finally {
    activeChatSessions.delete(sessionId);
  }
  
  sendResponse({ status: "lesson_chat_started", sessionId });
}

function handleLessonCancel(message, sendResponse) {
  const { sessionId } = message.payload;
  const session = activeChatSessions.get(sessionId);
  if (session?.abortController) {
    session.abortController.abort();
    activeChatSessions.delete(sessionId);
  }
  sendResponse({ status: "cancelled", sessionId });
}

async function handleAskRequest(message, sender, sendResponse) {
  const { sessionId, selectedText, question, chatHistory } = message.payload;
  
  if (!sessionId) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "ASK_STREAM_ERROR", sessionId: null, error: "Internal error: No session ID provided" }, { frameId: sender.frameId });
    sendResponse({ status: "error", error: "No session ID" });
    return;
  }
  
  const data = await chrome.storage.local.get(['settings', 'selectedProvider', 'openaiApiKey', 'anthropicApiKey', 'geminiApiKey']);
  const settings = data.settings || {};
  const provider = data.selectedProvider || settings.provider || 'openai';
  const model = settings.model;
  const apiKey = getApiKeyForProvider(provider, data);
  
  if (!apiKey) {
    chrome.tabs.sendMessage(sender.tab.id, { type: "ASK_STREAM_ERROR", sessionId, error: `No API key configured for ${provider}. Please check your settings.` }, { frameId: sender.frameId });
    return;
  }
  
  const abortController = new AbortController();
  activeChatSessions.set(sessionId, { abortController, tabId: sender.tab.id, frameId: sender.frameId });
  
  const askPrompt = buildAskPrompt(question, selectedText, chatHistory);
  
  try {
    await fetchAskStreaming(askPrompt, provider, model, apiKey, sender.tab.id, sender.frameId, settings, sessionId, abortController.signal);
    if (!abortController.signal.aborted) {
      chrome.tabs.sendMessage(sender.tab.id, { type: "ASK_STREAM_COMPLETE", sessionId }, { frameId: sender.frameId });
    }
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error("Ask request error:", error);
      chrome.tabs.sendMessage(sender.tab.id, { type: "ASK_STREAM_ERROR", sessionId, error: error.message || String(error) }, { frameId: sender.frameId });
    }
  } finally {
    activeChatSessions.delete(sessionId);
  }
  
  sendResponse({ status: "ask_started", sessionId });
}

function handleAskCancel(message, sendResponse) {
  const { sessionId } = message.payload;
  const session = activeChatSessions.get(sessionId);
  if (session?.abortController) {
    session.abortController.abort();
    activeChatSessions.delete(sessionId);
  }
  sendResponse({ status: "cancelled", sessionId });
}

// ========================================
// CONTEXT MENU CLICK HANDLER
// ========================================

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_SETTINGS) {
    chrome.runtime.openOptionsPage();
    return;
  }
  
  if (info.menuItemId === CONTEXT_MENU_TRANSLATE) {
    await handleTranslateMenuClick(info, tab, false);
    return;
  }
  
  if (info.menuItemId === CONTEXT_MENU_TRANSLATE_SIMPLE) {
    await handleTranslateMenuClick(info, tab, true);
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_TRANSLATE_IMAGE) {
    await handleImageTranslateMenuClick(info, tab);
    return;
  }
  
  if (info.menuItemId === CONTEXT_MENU_SPEAK) {
    await handleSpeakMenuClick(info, tab);
    return;
  }
  
  if (info.menuItemId === CONTEXT_MENU_LESSON) {
    await handleLessonMenuClick(info, tab);
    return;
  }
  
  if (info.menuItemId === CONTEXT_MENU_ASK) {
    await handleAskMenuClick(info, tab);
    return;
  }
});

async function handleTranslateMenuClick(info, tab, simpleMode = false) {
  if (isRestrictedUrl(tab.url)) {
    if (info.selectionText) {
      openStandaloneWindow('translate', info.selectionText, { isRestricted: true, simpleMode });
    } else {
      showRestrictedPageWarning(tab.url);
    }
    return;
  }
  
  const selectionText = await getSelectionText(info, tab);
  if (!selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: "UGT_SHOW_ERROR", message: "Please highlight some text first, then try again.", errorContext: "NO_SELECTION" }, { frameId: info.frameId });
    return;
  }
  
  const data = await chrome.storage.local.get(null);
  const settings = data.settings || {};
  
  try {
    chrome.tabs.sendMessage(tab.id, { type: "TRANSLATE_SELECTION", text: selectionText, settings, simpleMode }, { frameId: info.frameId }, (response) => {
      if (chrome.runtime.lastError) {
        openStandaloneWindow('translate', selectionText, { isRestricted: false, simpleMode });
      }
    });
  } catch (error) {
    console.error("Synchronous error in translate menu click:", error.message);
  }
}

async function handleImageTranslateMenuClick(info, tab) {
  const frameId = info.frameId ?? 0;
  const requestId = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

  if (isRestrictedUrl(tab.url)) {
    showRestrictedPageWarning(tab.url, 'translate image');
    return;
  }

  try {
    const data = await chrome.storage.local.get([
      'settings',
      'languageMode',
      'targetLanguage',
      'customLanguage',
      'openaiApiKey'
    ]);

    if (!data.openaiApiKey) {
      chrome.tabs.sendMessage(tab.id, {
        type: "UGT_SHOW_ERROR",
        message: "OpenAI API key is not configured. Please add your API key in UGTBrowser Settings.",
        errorContext: "API_KEY_ISSUE"
      }, { frameId });
      return;
    }

    const targetLanguage = getImageTranslationTargetLanguage(data);
    const target = await sendMessageToFrame(tab.id, frameId, {
      type: "UGT_IMAGE_TRANSLATION_GET_TARGET",
      requestId,
      srcUrl: info.srcUrl || ''
    });

    if (!target?.ok) {
      throw new Error(target?.error || 'Could not identify the clicked image');
    }

    if (!target.isTopFrame) {
      throw new Error('Image translation currently supports images in the main page frame.');
    }

    await sendImageTranslationProgress(tab.id, frameId, requestId, {
      targetLanguage,
      title: 'Preparing image',
      detail: 'Reading full image'
    });

    let capture = await sendMessageToFrame(tab.id, frameId, {
      type: "UGT_IMAGE_TRANSLATION_CAPTURE",
      requestId,
      targetLanguage
    });

    if (capture?.needsScreenshot) {
      await sendImageTranslationProgress(tab.id, frameId, requestId, {
        targetLanguage,
        title: 'Preparing image',
        detail: 'Opening image source'
      });

      try {
        capture = await fetchImageFromSourceTab(target.sourceUrl);
      } catch (sourceTabError) {
        await sendImageTranslationProgress(tab.id, frameId, requestId, {
          targetLanguage,
          title: 'Preparing image',
          detail: 'Full image blocked; capturing visible area'
        });

        const screenshotDataUrl = await captureVisibleTab(tab.windowId);
        capture = await sendMessageToFrame(tab.id, frameId, {
          type: "UGT_IMAGE_TRANSLATION_CAPTURE",
          requestId,
          screenshotDataUrl,
          targetLanguage
        });
        capture.warning = capture.warning || `Full image unavailable: ${sourceTabError.message || String(sourceTabError)}`;
      }
    }

    if (!capture?.ok || !capture.imageDataUrl) {
      throw new Error(capture?.error || 'Could not capture the clicked image');
    }

    const imageByteLength = capture.byteLength || estimateDataUrlByteLength(capture.imageDataUrl);
    const size = chooseImageEditSize(capture.width, capture.height);
    const startedAt = Date.now();

    await sendImageTranslationProgress(tab.id, frameId, requestId, {
      targetLanguage,
      title: 'Sending image',
      detail: 'Starting upload',
      loadedBytes: 0,
      totalBytes: imageByteLength
    });

    setImageTranslationDebugRequest({
      requestId,
      status: 'started',
      tabId: tab.id,
      frameId,
      targetLanguage,
      capturedWidth: capture.width,
      capturedHeight: capture.height,
      captureSource: capture.captureSource || 'unknown',
      imageByteLength,
      warning: capture.warning,
      requestedSize: size,
      model: 'gpt-image-2',
      quality: 'low',
      outputFormat: 'png'
    });

    await startImageEditViaOffscreen({
      requestId,
      tabId: tab.id,
      frameId,
      imageDataUrl: capture.imageDataUrl,
      apiKey: data.openaiApiKey,
      prompt: buildImageTranslationPrompt(targetLanguage),
      model: 'gpt-image-2',
      quality: 'low',
      size,
      outputFormat: 'png',
      imageByteLength,
      captureSource: capture.captureSource || 'unknown',
      startedAt
    });

    setImageTranslationDebugResponse({
      requestId,
      status: 'offscreen_started',
      elapsedMs: Date.now() - startedAt,
      requestedSize: size
    });
  } catch (error) {
    console.error("Image translation error:", error);
    setImageTranslationDebugResponse({
      requestId,
      status: 'error',
      error: error.message || String(error)
    });

    try {
      await sendMessageToFrame(tab.id, frameId, {
        type: "UGT_IMAGE_TRANSLATION_ERROR",
        requestId,
        error: error.message || String(error)
      });
    } catch (sendError) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'UGTBrowser',
        message: `Image translation error: ${error.message || String(error)}`,
        priority: 1
      }, (notificationId) => {
        setTimeout(() => chrome.notifications.clear(notificationId), 5000);
      });
    }
  }
}

async function handleSpeakMenuClick(info, tab) {
  if (isRestrictedUrl(tab.url)) {
    if (info.selectionText) {
      handleTTSForRestrictedPage(info.selectionText);
    } else {
      showRestrictedPageWarning(tab.url, 'speak');
    }
    return;
  }
  
  const selectionText = await getSelectionText(info, tab);
  if (!selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: "UGT_SHOW_ERROR", message: "Please highlight some text first, then try again.", errorContext: "NO_SELECTION" }, { frameId: info.frameId });
    return;
  }
  
  const data = await chrome.storage.local.get([
    'ttsProvider', 'elevenlabsApiKey', 'elevenlabsVoice', 'elevenlabsCustomVoiceId', 'elevenlabsModel',
    'googleTtsApiKey', 'googleTtsVoice', 'googleTtsSpeakingRate', 'googleTtsPitch'
  ]);
  
  const ttsProvider = data.ttsProvider || 'elevenlabs';
  let contentScriptReachable = true;
  
  await new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "UGT_SHOW_TTS_OVERLAY" }, { frameId: info.frameId }, (response) => {
      if (chrome.runtime.lastError) {
        contentScriptReachable = false;
      }
      resolve();
    });
  });
  
  try {
    let base64Audio, mimeType;
    
    if (ttsProvider === 'google') {
      const apiKey = data.googleTtsApiKey;
      if (!apiKey) {
        if (contentScriptReachable) {
          chrome.tabs.sendMessage(tab.id, { type: "UGT_SHOW_ERROR", message: "Google Cloud TTS API key is not configured. Please add your API key in UGTBrowser Settings.", errorContext: "API_KEY_ISSUE" }, { frameId: info.frameId });
          chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" }, { frameId: info.frameId });
        } else {
          showTTSNotConfiguredNotification('Google Cloud TTS');
        }
        return;
      }
      base64Audio = await fetchFromGoogleTTS(selectionText, data.googleTtsVoice || 'en-US-Studio-O', apiKey, data.googleTtsSpeakingRate || 1.0, data.googleTtsPitch || 0);
      mimeType = "audio/mp3";
    } else {
      const apiKey = data.elevenlabsApiKey;
      if (!apiKey) {
        if (contentScriptReachable) {
          chrome.tabs.sendMessage(tab.id, { type: "UGT_SHOW_ERROR", message: "ElevenLabs API key is not configured. Please add your API key in UGTBrowser Settings.", errorContext: "API_KEY_ISSUE" }, { frameId: info.frameId });
          chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" }, { frameId: info.frameId });
        } else {
          showTTSNotConfiguredNotification('ElevenLabs');
        }
        return;
      }
      const customVoiceId = data.elevenlabsCustomVoiceId || '';
      const voiceId = customVoiceId.length > 0 ? customVoiceId : (data.elevenlabsVoice || "21m00Tcm4TlvDq8ikWAM");
      base64Audio = await fetchFromElevenLabs(selectionText, voiceId, apiKey, data.elevenlabsModel || "eleven_multilingual_v2");
      mimeType = "audio/mpeg";
    }
    
    // Calculate max duration (rough: 10 chars/sec + buffer)
    const maxDurationMs = Math.max(15000, (selectionText.length / 10) * 1000 + 10000);
    
    console.log('[UGT TTS BG] Audio fetched, size:', base64Audio?.length || 0, 'contentScriptReachable:', contentScriptReachable);
    
    // Always set a failsafe timeout to hide overlay
    const failsafeTimeout = setTimeout(() => {
      console.log('[UGT TTS BG] Failsafe timeout - hiding overlay');
      chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" });
    }, maxDurationMs);
    
    if (contentScriptReachable) {
      console.log('[UGT TTS BG] Sending PLAY_TTS_AUDIO to tab:', tab.id, 'frameId:', info.frameId);
      chrome.tabs.sendMessage(tab.id, { type: "PLAY_TTS_AUDIO", audio: base64Audio, mimeType }, { frameId: info.frameId }, (response) => {
        console.log('[UGT TTS BG] PLAY_TTS_AUDIO response:', response, 'lastError:', chrome.runtime.lastError?.message);
        if (chrome.runtime.lastError || (response && response.status === "failed")) {
          // Content script couldn't play audio, fall back to offscreen
          console.log('[UGT TTS BG] Content script audio failed, falling back to offscreen playback');
          clearTimeout(failsafeTimeout);
          playAudioViaOffscreen(base64Audio, mimeType)
            .then(() => {
              chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" });
            })
            .catch((err) => {
              console.error('Offscreen audio playback error:', err);
              chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" });
            });
        }
        // If status is "playing", content script is handling audio and will hide overlay when done
        // Failsafe timeout will hide it if 'ended' event doesn't fire
      });
    } else {
      clearTimeout(failsafeTimeout);
      console.log('[UGT TTS BG] Content script unreachable, using offscreen playback');
      await playAudioViaOffscreen(base64Audio, mimeType);
      console.log('[UGT TTS BG] Offscreen playback complete, hiding overlay');
      // Try to hide overlay anyway - the overlay might have been shown even if response failed
      chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" });
    }
  } catch (error) {
    const providerName = ttsProvider === 'google' ? 'Google TTS' : 'ElevenLabs';
    console.error(`${providerName} TTS error:`, error);
    if (contentScriptReachable) {
      chrome.tabs.sendMessage(tab.id, { type: "UGT_SHOW_ERROR", message: `${providerName} TTS error: ${error.message}`, errorContext: "API_KEY_ISSUE" }, { frameId: info.frameId });
      chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" }, { frameId: info.frameId });
    } else {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icon128.png',
        title: 'UGTBrowser',
        message: `${providerName} TTS error: ${error.message}`,
        priority: 1
      }, (notificationId) => {
        setTimeout(() => chrome.notifications.clear(notificationId), 5000);
      });
    }
  }
}

async function handleLessonMenuClick(info, tab) {
  if (isRestrictedUrl(tab.url)) {
    if (info.selectionText) {
      openStandaloneWindow('lesson', info.selectionText, { isRestricted: true });
    } else {
      showRestrictedPageWarning(tab.url, 'lesson');
    }
    return;
  }
  
  const selectionText = await getSelectionText(info, tab);
  if (!selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: "UGT_SHOW_ERROR", message: "Please highlight some text first, then try again.", errorContext: "NO_SELECTION" }, { frameId: info.frameId });
    return;
  }
  
  const data = await chrome.storage.local.get(['lessonPrompt']);
  const lessonPrompt = data.lessonPrompt || defaultLessonPrompt;
  
  chrome.tabs.sendMessage(tab.id, { type: "CREATE_LESSON", text: selectionText, lessonPrompt }, { frameId: info.frameId }, (response) => {
    if (chrome.runtime.lastError) {
      openStandaloneWindow('lesson', selectionText, { isRestricted: false });
    }
  });
}

async function handleAskMenuClick(info, tab) {
  if (isRestrictedUrl(tab.url)) {
    if (info.selectionText) {
      openStandaloneWindow('ask', info.selectionText, { isRestricted: true });
    } else {
      showRestrictedPageWarning(tab.url, 'ask');
    }
    return;
  }
  
  const selectionText = await getSelectionText(info, tab);
  if (!selectionText) {
    chrome.tabs.sendMessage(tab.id, { type: "UGT_SHOW_ERROR", message: "Please highlight some text first, then try again.", errorContext: "NO_SELECTION" }, { frameId: info.frameId });
    return;
  }
  
  chrome.tabs.sendMessage(tab.id, { type: "ASK_ABOUT", text: selectionText }, { frameId: info.frameId }, (response) => {
    if (chrome.runtime.lastError) {
      openStandaloneWindow('ask', selectionText, { isRestricted: false });
    }
  });
}

// ========================================
// INITIALIZATION
// ========================================

// Initialize context menus on install
chrome.runtime.onInstalled.addListener(() => {
  initializeContextMenus();
});

// Set up settings change listener
setupSettingsChangeListener();
setupContextMenuVisibilityListener();

// Open options page when browser action is clicked
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
