// src/background/api/anthropic.js
// Anthropic (Claude) API integration for translation and chat

import { supportsTemperature } from '../../shared/utils.js';

const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5";

export function isClaude5Model(model) {
  if (!model) return false;
  return /^claude-(sonnet|opus|fable)-5(?:$|-)/i.test(model);
}

export function isClaudeFable5Model(model) {
  if (!model) return false;
  return /^claude-fable-5(?:$|-)/i.test(model);
}

/**
 * Determine max tokens based on model.
 */
export function getMaxTokensForModel(model) {
  if (!model) return 4096;

  if (isClaude5Model(model)) {
    return 16384;
  }

  if (model.includes("claude-opus-4-8") || model.includes("claude-sonnet-4-6") ||
      model.includes("claude-sonnet-4-5") || model.includes("claude-opus-4-5") ||
      model.includes("claude-haiku-4-5")) {
    return 8192;
  }

  if (model.includes("claude-3-7-sonnet")) {
    return 64000;
  }

  if (model.includes("claude-3-5-sonnet") || model.includes("claude-3-5-haiku")) {
    return 8192;
  }

  return 4096;
}

export function buildAnthropicRequestBody(
  prompt,
  model,
  { stream = false, temperature = 0.1, settings = {} } = {}
) {
  const modelToUse = model || DEFAULT_ANTHROPIC_MODEL;
  const requestBody = {
    model: modelToUse,
    messages: [{ role: "user", content: prompt }],
    max_tokens: getMaxTokensForModel(modelToUse)
  };

  if (stream) {
    requestBody.stream = true;
  }

  if (isClaude5Model(modelToUse)) {
    requestBody.thinking = isClaudeFable5Model(modelToUse) || settings.anthropicThinkingEnabled === true
      ? { type: "adaptive" }
      : { type: "disabled" };
  }

  if (supportsTemperature(modelToUse)) {
    requestBody.temperature = temperature;
  }

  return requestBody;
}

function getAnthropicHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  };
}

function getRefusalExplanation(stopDetails) {
  if (!stopDetails || typeof stopDetails !== 'object') return null;
  for (const key of ['explanation', 'refusal', 'reason', 'message', 'details']) {
    if (typeof stopDetails[key] === 'string' && stopDetails[key].trim()) {
      return stopDetails[key].trim();
    }
  }
  return null;
}

function buildRefusalError(stopDetails) {
  const explanation = getRefusalExplanation(stopDetails);
  return new Error(explanation
    ? `Anthropic refused the request: ${explanation}`
    : "Anthropic refused the request for safety reasons.");
}

export function extractAnthropicText(data) {
  if (data?.stop_reason === 'refusal') {
    throw buildRefusalError(data.stop_details);
  }

  const text = Array.isArray(data?.content)
    ? data.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('')
    : '';

  if (!text) {
    throw new Error("No text content in Anthropic response");
  }

  return text;
}

export function parseAnthropicSseEvent(data) {
  if (data?.type === 'error') {
    return { error: new Error(data.error?.message || "Anthropic stream returned an error") };
  }

  if (data?.type === 'content_block_delta' && typeof data.delta?.text === 'string') {
    return { text: data.delta.text };
  }

  const stopReason = data?.type === 'message_delta'
    ? data.delta?.stop_reason
    : data?.stop_reason;
  if (stopReason === 'refusal') {
    return {
      refusal: buildRefusalError(data.delta?.stop_details || data.stop_details)
    };
  }

  return {};
}

export async function readAnthropicSseStream(response, abortSignal, onText) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let refusalError = null;

  const processLine = (line) => {
    if (!line.trim() || !line.startsWith("data:")) return;
    const payload = line.substring(5).trim();
    if (!payload || payload === '[DONE]') return;

    let data;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }

    const event = parseAnthropicSseEvent(data);
    if (event.error) throw event.error;
    if (event.refusal) refusalError = event.refusal;
    if (event.text) onText(event.text);
  };

  try {
    while (true) {
      if (abortSignal?.aborted) break;

      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (abortSignal?.aborted) break;
        processLine(line);
      }
    }

    if (buffer.trim() && !abortSignal?.aborted) {
      processLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }

  if (refusalError && !abortSignal?.aborted) {
    throw refusalError;
  }
}

async function parseAnthropicErrorResponse(response) {
  const error = await response.json().catch(() => null);
  return new Error(error?.error?.message || `Anthropic API error: ${response.status}`);
}

/**
 * Non-streaming Anthropic API call.
 */
export async function fetchFromAnthropic(prompt, model, apiKey, settings = {}) {
  if (!apiKey) throw new Error("Anthropic API key is required");

  const requestBody = buildAnthropicRequestBody(prompt, model, { settings });
  console.log("Using Anthropic model:", requestBody.model);

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
      method: "POST",
      headers: getAnthropicHeaders(apiKey),
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw await parseAnthropicErrorResponse(response);
    }

    return extractAnthropicText(await response.json());
  } catch (error) {
    console.error("Anthropic API error with model:", requestBody.model, error);
    throw error;
  }
}

/**
 * Streaming Anthropic API call for translations.
 */
export async function fetchFromAnthropicStreaming(
  prompt,
  model,
  apiKey,
  port,
  updateCallback,
  settings = {},
  abortSignal = null
) {
  if (!apiKey) throw new Error("Anthropic API key is required");

  const requestBody = buildAnthropicRequestBody(prompt, model, {
    stream: true,
    temperature: 0.1,
    settings
  });
  console.log("Using Anthropic model:", requestBody.model);

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
      method: "POST",
      headers: getAnthropicHeaders(apiKey),
      body: JSON.stringify(requestBody),
      signal: abortSignal
    });

    if (!response.ok) {
      throw await parseAnthropicErrorResponse(response);
    }

    let chunkCount = 0;
    await readAnthropicSseStream(response, abortSignal, (text) => {
      if (abortSignal?.aborted) return;
      try {
        port.postMessage({ type: "STREAM_CHUNK", chunk: text });
      } catch {
        const error = new Error("Port disconnected during Anthropic streaming");
        error.name = 'PortDisconnectedError';
        throw error;
      }
      if (updateCallback) updateCallback(text);
      chunkCount++;
    });
    console.log("Anthropic streaming finished from provider function, total chunks:", chunkCount);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("Anthropic streaming was cancelled");
      return;
    }
    if (error.name === 'PortDisconnectedError') return;
    throw error;
  }
}

/**
 * Streaming Anthropic API call for chat/follow-up conversations.
 */
export async function fetchChatFromAnthropicStreaming(
  prompt,
  model,
  apiKey,
  sendChunk,
  settings = {},
  abortSignal = null
) {
  if (!apiKey) throw new Error("Anthropic API key is required");

  const requestBody = buildAnthropicRequestBody(prompt, model, {
    stream: true,
    temperature: 0.7,
    settings
  });
  const response = await fetch(ANTHROPIC_MESSAGES_ENDPOINT, {
    method: "POST",
    headers: getAnthropicHeaders(apiKey),
    body: JSON.stringify(requestBody),
    signal: abortSignal
  });

  if (!response.ok) {
    throw await parseAnthropicErrorResponse(response);
  }

  await readAnthropicSseStream(response, abortSignal, sendChunk);
}
