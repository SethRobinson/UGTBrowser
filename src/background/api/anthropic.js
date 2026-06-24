// src/background/api/anthropic.js
// Anthropic (Claude) API integration for translation and chat

import { supportsTemperature } from '../../shared/utils.js';

/**
 * Determine max tokens based on model
 */
function getMaxTokensForModel(model) {
  if (!model) return 4096;
  
  if (model.includes("claude-opus-4-8") || model.includes("claude-sonnet-4-6") ||
      model.includes("claude-sonnet-4-5") || model.includes("claude-opus-4-5") ||
      model.includes("claude-haiku-4-5")) {
    return 8192;
  } else if (model.includes("claude-3-7-sonnet")) {
    return 64000;
  } else if (model.includes("claude-3-5-sonnet") || model.includes("claude-3-5-haiku")) {
    return 8192;
  }
  
  return 4096;
}

/**
 * Non-streaming Anthropic API call
 */
export async function fetchFromAnthropic(prompt, model, apiKey) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  
  const maxTokens = getMaxTokensForModel(model);
  const modelToUse = model || "claude-sonnet-4-6";
  
  console.log("Using Anthropic model:", modelToUse);
  
  const endpoint = "https://api.anthropic.com/v1/messages";
  const requestBody = {
    model: modelToUse,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens
  };
  
  if (supportsTemperature(model)) {
    requestBody.temperature = 0.1;
  }
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error?.message || `Anthropic API error: ${response.status}`);
    }
    
    const data = await response.json();
    return data.content[0].text;
  } catch (error) {
    console.error("Anthropic API error with model:", modelToUse, error);
    throw new Error(`Anthropic API error: ${error.message}`);
  }
}

/**
 * Streaming Anthropic API call for translations
 */
export async function fetchFromAnthropicStreaming(prompt, model, apiKey, port, updateCallback, abortSignal = null) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  
  console.log("Starting Anthropic streaming request with new tagged format handling");
  
  const maxTokens = getMaxTokensForModel(model);
  const modelToUse = model || "claude-sonnet-4-6";
  
  console.log("Using Anthropic model:", modelToUse);
  
  const endpoint = "https://api.anthropic.com/v1/messages";
  const requestBody = {
    model: modelToUse,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    stream: true
  };
  
  if (supportsTemperature(model)) {
    requestBody.temperature = 0.1;
  }
  
  try {
    const fetchOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(requestBody)
    };
    
    if (abortSignal) {
      fetchOptions.signal = abortSignal;
    }
    
    const response = await fetch(endpoint, fetchOptions);
    
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error?.message || `Anthropic API error: ${response.status}`);
    }
    
    console.log("Anthropic stream connected, reading data (tagged format)");
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let chunkCount = 0;
    
    try {
      while (true) {
        if (abortSignal && abortSignal.aborted) {
          console.log("Anthropic stream aborted by user");
          break;
        }
        
        const { done, value } = await reader.read();
        if (done) {
          console.log("Anthropic stream complete after", chunkCount, "chunks");
          break;
        }
        
        const chunk = decoder.decode(value);
        buffer += chunk;
        
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          if (abortSignal && abortSignal.aborted) break;
          
          if (line.trim() && line.startsWith("data:")) {
            try {
              const cleanedLine = line.substring(5).trim();
              if (cleanedLine) {
                const data = JSON.parse(cleanedLine);
                if (data.type === "content_block_delta" && data.delta && data.delta.text) {
                  const newContent = data.delta.text;
                  if (!abortSignal || !abortSignal.aborted) {
                    try {
                      port.postMessage({ type: "STREAM_CHUNK", chunk: newContent });
                    } catch (e) {
                      console.log("Port disconnected during Anthropic streaming, stopping");
                      return;
                    }
                  }
                  if (updateCallback) updateCallback(newContent);
                  chunkCount++;
                }
              }
            } catch (e) {
              // Ignore parse errors
            }
          }
        }
      }
      console.log("Anthropic streaming finished from provider function, total chunks:", chunkCount);
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("Anthropic streaming was cancelled");
      return;
    }
    throw error;
  }
}

/**
 * Streaming Anthropic API call for chat/followup conversations
 */
export async function fetchChatFromAnthropicStreaming(prompt, model, apiKey, sendChunk, abortSignal = null) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  
  const modelToUse = model || "claude-sonnet-4-6";
  const maxTokens = getMaxTokensForModel(model);
  
  const endpoint = "https://api.anthropic.com/v1/messages";
  const requestBody = {
    model: modelToUse,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    stream: true
  };
  
  if (supportsTemperature(modelToUse)) {
    requestBody.temperature = 0.7;
  }
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify(requestBody),
    signal: abortSignal
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Anthropic API error: ${response.status}`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  
  try {
    while (true) {
      if (abortSignal && abortSignal.aborted) break;
      
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      buffer += chunk;
      
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      
      for (const line of lines) {
        if (line.trim() && line.startsWith("data:")) {
          try {
            const cleanedLine = line.substring(5).trim();
            if (cleanedLine) {
              const data = JSON.parse(cleanedLine);
              if (data.type === "content_block_delta" && data.delta && data.delta.text) {
                sendChunk(data.delta.text);
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
