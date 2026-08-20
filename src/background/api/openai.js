// src/background/api/openai.js
// OpenAI API integration for translation and chat

import { supportsTemperature, usesOpenAIResponsesApi, getReasoningEffort } from '../../shared/utils.js';

const OPENAI_IMAGE_EDIT_ENDPOINT = "https://api.openai.com/v1/images/edits";
const OPENAI_CHAT_COMPLETIONS_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const DEFAULT_OPENAI_MODEL = "gpt-5.6-sol";

/**
 * Non-streaming OpenAI API call
 */
export async function fetchFromOpenAI(prompt, model, apiKey) {
  if (!apiKey) throw new Error("OpenAI API key is required");

  const modelToUse = model || DEFAULT_OPENAI_MODEL;
  const useResponsesApi = usesOpenAIResponsesApi(modelToUse);
  const endpoint = useResponsesApi ? OPENAI_RESPONSES_ENDPOINT : OPENAI_CHAT_COMPLETIONS_ENDPOINT;
  const requestBody = useResponsesApi
    ? buildOpenAIResponsesRequestBody(prompt, modelToUse, false, { stream: false })
    : buildOpenAIChatCompletionsRequestBody(prompt, modelToUse, false, 0.1);
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `OpenAI API error: ${response.status}`);
  }
  
  const data = await response.json();
  if (useResponsesApi) {
    return extractOpenAIResponsesText(data);
  }

  return data.choices[0].message.content;
}

/**
 * Direct OpenAI image edit call for in-image visual translation.
 */
export async function editImageWithOpenAI({
  imageBlob,
  prompt,
  apiKey,
  model = "gpt-image-2",
  quality = "low",
  size = "auto",
  outputFormat = "png",
  signal = null,
  onUploadProgress = null,
  onUploadComplete = null
}) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  if (!imageBlob) throw new Error("Image data is required");
  if (!prompt) throw new Error("Image edit prompt is required");

  const formData = new FormData();
  formData.append("model", model);
  formData.append("image", imageBlob, "image.png");
  formData.append("prompt", prompt);
  formData.append("quality", quality);
  formData.append("size", size);
  formData.append("output_format", outputFormat);

  if ((onUploadProgress || onUploadComplete) && typeof XMLHttpRequest !== 'undefined') {
    return sendOpenAIImageEditWithXhr({
      formData,
      apiKey,
      outputFormat,
      signal,
      onUploadProgress,
      onUploadComplete
    });
  }

  const response = await fetch(OPENAI_IMAGE_EDIT_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`
    },
    body: formData,
    signal
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `OpenAI image edit error: ${response.status}`);
  }

  const data = await response.json();
  return parseOpenAIImageEditResponse(data, outputFormat);
}

function parseOpenAIImageEditResponse(data, outputFormat) {
  const base64Image = data?.data?.[0]?.b64_json;
  if (!base64Image) {
    throw new Error("OpenAI image edit response did not include image data");
  }

  return {
    dataUrl: `data:image/${outputFormat};base64,${base64Image}`,
    base64Image
  };
}

function sendOpenAIImageEditWithXhr({
  formData,
  apiKey,
  outputFormat,
  signal,
  onUploadProgress,
  onUploadComplete
}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let settled = false;

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      callback(value);
    };

    const abortHandler = () => {
      xhr.abort();
      settle(reject, new Error('OpenAI image edit request was aborted.'));
    };

    if (signal?.aborted) {
      reject(new Error('OpenAI image edit request was aborted.'));
      return;
    }

    xhr.open('POST', OPENAI_IMAGE_EDIT_ENDPOINT);
    xhr.setRequestHeader('Authorization', `Bearer ${apiKey}`);
    xhr.responseType = 'json';

    xhr.upload.onprogress = (event) => {
      if (onUploadProgress) {
        onUploadProgress({
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : null
        });
      }
    };

    xhr.upload.onload = () => {
      if (onUploadComplete) {
        onUploadComplete();
      }
    };

    xhr.onerror = () => settle(reject, new Error('Network error while sending OpenAI image edit request.'));
    xhr.onabort = () => settle(reject, new Error('OpenAI image edit request was aborted.'));
    xhr.onload = () => {
      const data = xhr.response || (() => {
        try {
          return JSON.parse(xhr.responseText);
        } catch {
          return null;
        }
      })();

      if (xhr.status < 200 || xhr.status >= 300) {
        settle(reject, new Error(data?.error?.message || `OpenAI image edit error: ${xhr.status}`));
        return;
      }

      try {
        settle(resolve, parseOpenAIImageEditResponse(data, outputFormat));
      } catch (error) {
        settle(reject, error);
      }
    };

    if (signal) {
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    xhr.send(formData);
  });
}

export function buildOpenAIResponsesRequestBody(prompt, model, thinkingEnabled, { stream = false, maxOutputTokens = 16384 } = {}) {
  const requestBody = {
    model,
    input: prompt,
    max_output_tokens: maxOutputTokens
  };

  if (stream) {
    requestBody.stream = true;
  }

  const reasoningEffort = getReasoningEffort(model, thinkingEnabled);
  if (reasoningEffort) {
    requestBody.reasoning = { effort: reasoningEffort };
  }

  return requestBody;
}

export function buildOpenAIChatCompletionsRequestBody(prompt, model, stream, temperature, thinkingEnabled = false) {
  const requestBody = {
    model,
    messages: [{ role: "user", content: prompt }]
  };

  if (stream) {
    requestBody.stream = true;
  }

  if (supportsTemperature(model)) {
    requestBody.temperature = temperature;
  }

  const reasoningEffort = getReasoningEffort(model, thinkingEnabled);
  if (reasoningEffort) {
    requestBody.reasoning_effort = reasoningEffort;
  }

  return requestBody;
}

function extractOpenAIResponsesText(data) {
  if (typeof data?.output_text === "string" && data.output_text) {
    return data.output_text;
  }

  let textContent = "";
  if (Array.isArray(data?.output)) {
    for (const item of data.output) {
      if (item?.type !== "message" || !Array.isArray(item.content)) continue;
      for (const contentItem of item.content) {
        if (contentItem?.type === "output_text" && typeof contentItem.text === "string") {
          textContent += contentItem.text;
        }
      }
    }
  }

  if (!textContent) {
    console.error("OpenAI Responses API: could not extract text from response", data);
    throw new Error("Could not extract text from Responses API response");
  }

  return textContent;
}

function extractOpenAIResponsesStreamDelta(data) {
  if (data?.type === "response.output_text.delta" && typeof data.delta === "string") {
    return data.delta;
  }
  return "";
}

function extractOpenAIChatCompletionsStreamDelta(data) {
  return data?.choices?.[0]?.delta?.content || "";
}

async function readOpenAISseStream(response, abortSignal, onData, { logParseErrors = false } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  const processLine = (rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    if (!line.startsWith("data: ")) return;

    const payload = line.substring(6);
    if (!payload || payload === "[DONE]") return;

    let data;
    try {
      data = JSON.parse(payload);
    } catch (error) {
      if (logParseErrors && (!abortSignal || !abortSignal.aborted)) {
        console.error("Error parsing OpenAI stream line:", error, "Line:", line);
      }
      return;
    }

    onData(data);
  };

  try {
    while (true) {
      if (abortSignal && abortSignal.aborted) break;

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (abortSignal && abortSignal.aborted) break;
        processLine(line);
      }
    }

    if (buffer.trim() && (!abortSignal || !abortSignal.aborted)) {
      processLine(buffer);
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Streaming OpenAI API call for translations
 */
export async function fetchFromOpenAIStreaming(prompt, model, apiKey, port, updateCallback, settings = {}, abortSignal = null) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  
  const modelToUse = model || DEFAULT_OPENAI_MODEL;
  const thinkingEnabled = settings.openaiThinkingEnabled === true;
  const useResponsesApi = usesOpenAIResponsesApi(modelToUse);
  const reasoningEffort = getReasoningEffort(modelToUse, thinkingEnabled);
  
  console.log(`Starting OpenAI streaming request: model=${modelToUse}, useResponsesApi=${useResponsesApi}, thinkingEnabled=${thinkingEnabled}, reasoningEffort=${reasoningEffort}`);
  
  const endpoint = useResponsesApi ? OPENAI_RESPONSES_ENDPOINT : OPENAI_CHAT_COMPLETIONS_ENDPOINT;
  const requestBody = useResponsesApi
    ? buildOpenAIResponsesRequestBody(prompt, modelToUse, thinkingEnabled, { stream: true })
    : buildOpenAIChatCompletionsRequestBody(prompt, modelToUse, true, 0.1, thinkingEnabled);
  
  const fetchOptions = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  };
  
  if (abortSignal) {
    fetchOptions.signal = abortSignal;
  }
  
  try {
    const response = await fetch(endpoint, fetchOptions);
    
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error?.message || `OpenAI API error: ${response.status}`);
    }

    console.log(`OpenAI ${useResponsesApi ? "Responses API" : "Chat Completions"} stream connected`);
    let chunkCount = 0;

    await readOpenAISseStream(response, abortSignal, (data) => {
      const newContent = useResponsesApi
        ? extractOpenAIResponsesStreamDelta(data)
        : extractOpenAIChatCompletionsStreamDelta(data);

      if (!newContent) return;

      if (!abortSignal || !abortSignal.aborted) {
        try {
          port.postMessage({ type: "STREAM_CHUNK", chunk: newContent });
        } catch (error) {
          console.log("Port disconnected during OpenAI streaming, stopping");
          throw new Error("Port disconnected during OpenAI streaming");
        }
      }

      if (updateCallback) updateCallback(newContent);
      chunkCount++;
    }, { logParseErrors: true });

    if (!abortSignal || !abortSignal.aborted) {
      console.log("OpenAI streaming finished from provider function, total chunks:", chunkCount);
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("OpenAI streaming was cancelled");
      return;
    }

    if (error.message === "Port disconnected during OpenAI streaming") {
      return;
    }

    throw error;
  }
}

/**
 * Streaming OpenAI API call for chat/followup conversations
 */
export async function fetchChatFromOpenAIStreaming(prompt, model, apiKey, sendChunk, settings = {}, abortSignal = null) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  
  const modelToUse = model || DEFAULT_OPENAI_MODEL;
  const thinkingEnabled = settings.openaiThinkingEnabled === true;
  const useResponsesApi = usesOpenAIResponsesApi(modelToUse);
  const endpoint = useResponsesApi ? OPENAI_RESPONSES_ENDPOINT : OPENAI_CHAT_COMPLETIONS_ENDPOINT;
  const requestBody = useResponsesApi
    ? buildOpenAIResponsesRequestBody(prompt, modelToUse, thinkingEnabled, { stream: true })
    : buildOpenAIChatCompletionsRequestBody(prompt, modelToUse, true, 0.7, thinkingEnabled);
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody),
    signal: abortSignal
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `OpenAI API error: ${response.status}`);
  }
  
  await readOpenAISseStream(response, abortSignal, (data) => {
    const newContent = useResponsesApi
      ? extractOpenAIResponsesStreamDelta(data)
      : extractOpenAIChatCompletionsStreamDelta(data);

    if (newContent) {
      sendChunk(newContent);
    }
  });
}
