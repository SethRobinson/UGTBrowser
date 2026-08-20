// src/background/streaming.js
// Unified streaming orchestration for all LLM interactions

import { fetchChatFromOpenAIStreaming } from './api/openai.js';
import { fetchChatFromAnthropicStreaming } from './api/anthropic.js';
import { fetchChatFromGeminiStreaming } from './api/gemini.js';

/**
 * Unified streaming function for chat, lesson, ask, and other conversational interactions.
 * Replaces the previously duplicate fetchChatStreaming, fetchLessonStreaming, 
 * fetchAskStreaming, and fetchLessonChatStreaming functions.
 * 
 * @param {Object} options - Streaming options
 * @param {string} options.prompt - The prompt to send to the LLM
 * @param {string} options.provider - Provider name ('openai', 'anthropic', 'gemini')
 * @param {string} options.model - Model identifier
 * @param {string} options.apiKey - API key for the provider
 * @param {number} options.tabId - Chrome tab ID for message routing
 * @param {number} options.frameId - Frame ID within the tab
 * @param {Object} options.settings - Additional settings (e.g., thinkingEnabled)
 * @param {string} options.sessionId - Session ID for response routing
 * @param {AbortSignal} options.abortSignal - Abort signal for cancellation
 * @param {string} options.chunkMessageType - Message type for streaming chunks
 */
export async function fetchGenericStreaming({
  prompt,
  provider,
  model,
  apiKey,
  tabId,
  frameId,
  settings = {},
  sessionId = null,
  abortSignal = null,
  chunkMessageType = 'STREAM_CHUNK'
}) {
  console.log(`Starting generic streaming for provider: ${provider}, sessionId: ${sessionId}, messageType: ${chunkMessageType}`);
  
  const sendChunk = (chunk) => {
    if (abortSignal && abortSignal.aborted) return;
    
    chrome.tabs.sendMessage(tabId, { 
      type: chunkMessageType, 
      sessionId: sessionId,
      chunk: chunk 
    }, { frameId: frameId });
  };
  
  switch (provider) {
    case "openai":
      await fetchChatFromOpenAIStreaming(prompt, model, apiKey, sendChunk, settings, abortSignal);
      break;
    case "anthropic":
      await fetchChatFromAnthropicStreaming(prompt, model, apiKey, sendChunk, settings, abortSignal);
      break;
    case "gemini":
      await fetchChatFromGeminiStreaming(prompt, model, apiKey, sendChunk, settings, abortSignal);
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Streaming function for cultural nuance chat follow-ups
 */
export async function fetchChatStreaming(prompt, provider, model, apiKey, tabId, frameId, settings, sessionId, abortSignal) {
  return fetchGenericStreaming({
    prompt,
    provider,
    model,
    apiKey,
    tabId,
    frameId,
    settings,
    sessionId,
    abortSignal,
    chunkMessageType: 'CHAT_STREAM_CHUNK'
  });
}

/**
 * Streaming function for initial lesson generation
 */
export async function fetchLessonStreaming(prompt, provider, model, apiKey, tabId, frameId, settings, sessionId, abortSignal) {
  return fetchGenericStreaming({
    prompt,
    provider,
    model,
    apiKey,
    tabId,
    frameId,
    settings,
    sessionId,
    abortSignal,
    chunkMessageType: 'LESSON_STREAM_CHUNK'
  });
}

/**
 * Streaming function for lesson chat follow-ups
 */
export async function fetchLessonChatStreaming(prompt, provider, model, apiKey, tabId, frameId, settings, sessionId, abortSignal) {
  return fetchGenericStreaming({
    prompt,
    provider,
    model,
    apiKey,
    tabId,
    frameId,
    settings,
    sessionId,
    abortSignal,
    chunkMessageType: 'LESSON_CHAT_STREAM_CHUNK'
  });
}

/**
 * Streaming function for ask about selection
 */
export async function fetchAskStreaming(prompt, provider, model, apiKey, tabId, frameId, settings, sessionId, abortSignal) {
  return fetchGenericStreaming({
    prompt,
    provider,
    model,
    apiKey,
    tabId,
    frameId,
    settings,
    sessionId,
    abortSignal,
    chunkMessageType: 'ASK_STREAM_CHUNK'
  });
}
