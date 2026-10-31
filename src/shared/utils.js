// src/shared/utils.js
// Shared utility functions used across background, content, and options scripts

import { noTemperatureModels, imageTranslationModels, DEFAULT_IMAGE_TRANSLATION_MODEL } from './constants.js';

// ========================================
// MODEL CAPABILITY CHECKS
// ========================================

/**
 * Check if a model supports temperature settings
 */
export function supportsTemperature(model) {
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  if (noTemperatureModels.includes(lowerModel)) return false;
  // Current OpenAI models reject any non-default temperature, Anthropic API version
  // 2026-10-21 rejects sampling parameters on every model, and Gemini deprecated
  // them. Only older OpenAI chat models still accept one, so allowlist those rather
  // than letting an unknown or custom model name receive it.
  return /^(gpt-4|gpt-3\.5|chatgpt-4o)/.test(lowerModel);
}

/**
 * Check if a model is a GPT-5 variant
 */
export function isGPT5Model(model) {
  if (!model) return false;
  return model.toLowerCase().startsWith('gpt-5');
}

/**
 * Check if a model is a GPT-6 variant (GPT-6 Astra/Luna, GPT-6.1 Sol/Terra)
 */
export function isGPT6Model(model) {
  if (!model) return false;
  return model.toLowerCase().startsWith('gpt-6');
}

/**
 * Check if an OpenAI model takes a reasoning effort setting
 */
export function isOpenAIReasoningModel(model) {
  return isGPT5Model(model) || isGPT6Model(model);
}

/**
 * Check if a model is GPT-5.2 Pro specifically
 */
export function isGPT52Pro(model) {
  if (!model) return false;
  return model.toLowerCase() === 'gpt-5.2-pro';
}

/**
 * Check if an OpenAI model should use the Responses API.
 */
export function usesOpenAIResponsesApi(model) {
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith('gpt-6') ||
    lowerModel.startsWith('gpt-5.6') ||
    lowerModel === 'gpt-5.5' ||
    lowerModel.startsWith('gpt-5.4') ||
    lowerModel === 'gpt-5.2-pro';
}

/**
 * Check if a GPT-5 model supports 'none' reasoning effort
 */
export function supportsNoneReasoningEffort(model) {
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  if (lowerModel === 'gpt-5.2-pro') return false;
  return lowerModel.startsWith('gpt-5.1') || lowerModel.startsWith('gpt-5.2');
}

/**
 * Get the appropriate reasoning effort setting for a GPT-5 or GPT-6 model
 */
export function getReasoningEffort(model, thinkingEnabled) {
  if (!model) return null;
  const lowerModel = model.toLowerCase();
  
  if (!isOpenAIReasoningModel(model)) {
    return null;
  }
  
  if (lowerModel === 'gpt-5.2-pro') {
    return thinkingEnabled ? "high" : "medium";
  }

  // GPT-6 Astra and GPT-6.1 Sol have no 'none' level, so every current model uses low/medium.
  if (isGPT6Model(model) || lowerModel.startsWith('gpt-5.6') || lowerModel === 'gpt-5.5' || lowerModel.startsWith('gpt-5.4')) {
    return thinkingEnabled ? "medium" : "low";
  }
  
  if (thinkingEnabled) {
    return "medium";
  } else {
    return supportsNoneReasoningEffort(model) ? "none" : "low";
  }
}

/**
 * Check if a model is a Gemini 3.x model
 */
export function isGemini3Model(model) {
  if (!model) return false;
  return model.toLowerCase().startsWith('gemini-3');
}

/**
 * Check if a Gemini model is configured with thinkingLevel (Gemini 3.x and 4.x)
 * rather than the Gemini 2.5 thinkingBudget.
 */
export function usesGeminiThinkingLevel(model) {
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith('gemini-3') || lowerModel.startsWith('gemini-4');
}

/**
 * Check if a Gemini model supports thinking configuration
 */
export function supportsGeminiThinking(model) {
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith('gemini-2.5') || usesGeminiThinkingLevel(lowerModel);
}

/**
 * Check if a model is Gemini 2.5 or 3.x (for options page)
 */
export function isGemini25Or3Model(model) {
  if (!model) return false;
  return model.startsWith('gemini-2.5') || usesGeminiThinkingLevel(model);
}

/**
 * Pick an OpenAI image-edit output size near the minimum legal pixel budget that
 * keeps the clicked image's aspect ratio (edges multiples of 16, ratio 1:3 to 3:1).
 */
export function chooseImageEditSize(width, height) {
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

/**
 * Map a saved image translation model to a supported OpenAI image-edit model.
 */
export function normalizeImageTranslationModel(model) {
  return imageTranslationModels.includes(model) ? model : DEFAULT_IMAGE_TRANSLATION_MODEL;
}

// ========================================
// ID GENERATION
// ========================================

/**
 * Generate a unique ID using timestamp and random string
 */
export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

/**
 * Generate a session ID with a prefix
 */
export function generateSessionId(prefix = 'session') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 10)}`;
}

// ========================================
// TEXT UTILITIES
// ========================================

/**
 * Escape HTML special characters for safe display
 */
export function escapeHtml(text) {
  if (typeof document !== 'undefined') {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  // Fallback for environments without DOM (like service workers)
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// ========================================
// URL UTILITIES
// ========================================

// Protocols where content scripts cannot run (Set for O(1) lookup)
const RESTRICTED_PROTOCOLS = new Set([
  'chrome:', 'chrome-extension:', 'about:', 'edge:', 'brave:',
  'opera:', 'vivaldi:', 'moz-extension:', 'file:', 'view-source:',
  'data:', 'javascript:', 'devtools:'
]);

// Hosts that block content scripts despite using http/https
const RESTRICTED_HOSTS = new Set([
  'chrome.google.com',
  'chromewebstore.google.com',
  'microsoftedge.microsoft.com',
  'addons.mozilla.org'
]);

/**
 * Check if a URL is likely restricted (content scripts cannot run)
 * Fast synchronous check using URL parsing - use for quick UI decisions
 */
export function isRestrictedUrl(url) {
  if (!url) return true;
  try {
    const parsed = new URL(url);
    return RESTRICTED_PROTOCOLS.has(parsed.protocol) ||
           RESTRICTED_HOSTS.has(parsed.hostname);
  } catch {
    return true; // Invalid URL = treat as restricted
  }
}

/**
 * Definitively check if content scripts can run on a tab
 * Use when you need certainty (async, requires tab ID)
 */
export async function canInjectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => true
    });
    return true;
  } catch {
    return false;
  }
}

// ========================================
// TTS UTILITIES
// ========================================

/**
 * Get test phrase for a language code or name
 */
export function getTestPhraseForLanguage(langKey, testPhrases) {
  if (!langKey) return testPhrases['en'];
  const key = langKey.toLowerCase().replace(/[^a-z]/g, '');
  return testPhrases[key] || testPhrases['en'];
}

/**
 * Extract language code from Google TTS voice ID
 */
export function getLanguageFromGoogleVoiceId(voiceId) {
  if (!voiceId) return 'en';
  return voiceId.split('-')[0].toLowerCase();
}

/**
 * Check if Google TTS voice supports pitch adjustment
 */
export function googleTtsVoiceSupportsPitch(voiceId) {
  if (!voiceId) return true;
  const lowerVoice = voiceId.toLowerCase();
  return !lowerVoice.includes('studio') && !lowerVoice.includes('journey');
}
