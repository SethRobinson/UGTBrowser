// src/shared/utils.js
// Shared utility functions used across background, content, and options scripts

import { noTemperatureModels } from './constants.js';

// ========================================
// MODEL CAPABILITY CHECKS
// ========================================

/**
 * Check if a model supports temperature settings
 */
export function supportsTemperature(model) {
  return !noTemperatureModels.includes(model);
}

/**
 * Check if a model is a GPT-5 variant
 */
export function isGPT5Model(model) {
  if (!model) return false;
  return model.startsWith('gpt-5');
}

/**
 * Check if a model is GPT-5.2 Pro specifically
 */
export function isGPT52Pro(model) {
  if (!model) return false;
  return model.toLowerCase() === 'gpt-5.2-pro';
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
 * Get the appropriate reasoning effort setting for a GPT-5 model
 */
export function getReasoningEffort(model, thinkingEnabled) {
  if (!model) return null;
  const lowerModel = model.toLowerCase();
  
  if (!isGPT5Model(model)) {
    return null;
  }
  
  if (lowerModel === 'gpt-5.2-pro') {
    return thinkingEnabled ? "high" : "medium";
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
 * Check if a Gemini model supports thinking configuration
 */
export function supportsGeminiThinking(model) {
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith('gemini-2.5') || lowerModel.startsWith('gemini-3');
}

/**
 * Check if a model is Gemini 2.5 or 3.x (for options page)
 */
export function isGemini25Or3Model(model) {
  if (!model) return false;
  return model.startsWith('gemini-2.5') || model.startsWith('gemini-3');
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
