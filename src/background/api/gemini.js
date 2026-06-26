// src/background/api/gemini.js
// Google Gemini API integration for translation and chat

import { supportsTemperature, isGemini3Model, supportsGeminiThinking } from '../../shared/utils.js';

const GEMINI_35_FLASH_MODEL_ID = "gemini-3.5-flash";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-medium";

const GEMINI_MODEL_VARIANTS = {
  "gemini-3.5-flash": { modelId: GEMINI_35_FLASH_MODEL_ID, thinkingLevel: "medium" },
  "gemini-3.5-flash-low": { modelId: GEMINI_35_FLASH_MODEL_ID, thinkingLevel: "low" },
  "gemini-3.5-flash-medium": { modelId: GEMINI_35_FLASH_MODEL_ID, thinkingLevel: "medium" },
  "gemini-3.5-flash-high": { modelId: GEMINI_35_FLASH_MODEL_ID, thinkingLevel: "high" }
};

function resolveGeminiModel(model) {
  const requestedModel = model || DEFAULT_GEMINI_MODEL;
  const lowerModel = requestedModel.toLowerCase();
  return {
    requestedModel,
    modelId: GEMINI_MODEL_VARIANTS[lowerModel]?.modelId || requestedModel,
    thinkingLevel: GEMINI_MODEL_VARIANTS[lowerModel]?.thinkingLevel || null
  };
}

function addThinkingConfig(generationConfig, modelId, thinkingLevel, thinkingEnabled, configureLegacyThinking = true) {
  if (thinkingLevel) {
    generationConfig.thinkingConfig = { thinkingLevel };
    return generationConfig.thinkingConfig;
  }

  if (!configureLegacyThinking || !supportsGeminiThinking(modelId)) {
    return null;
  }

  const thinkingConfig = {};
  if (isGemini3Model(modelId)) {
    thinkingConfig.thinkingLevel = thinkingEnabled ? "high" : "low";
  } else {
    thinkingConfig.thinkingBudget = thinkingEnabled ? -1 : 0;
  }
  generationConfig.thinkingConfig = thinkingConfig;
  return thinkingConfig;
}

/**
 * Non-streaming Gemini API call
 */
export async function fetchFromGemini(prompt, model, apiKey) {
  if (!apiKey) throw new Error("Google Gemini API key is required");
  
  const { modelId, thinkingLevel } = resolveGeminiModel(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  
  const generationConfig = { maxOutputTokens: 8192 };
  if (supportsTemperature(modelId)) {
    generationConfig.temperature = 0.1;
  }
  addThinkingConfig(generationConfig, modelId, thinkingLevel, false, false);
  
  const requestBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: generationConfig
  };
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Gemini API error: ${response.status}`);
  }
  
  const data = await response.json();
  if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
    return data.candidates[0].content.parts[0].text;
  }
  
  throw new Error("No content in Gemini response");
}

/**
 * Streaming Gemini API call for translations
 */
export async function fetchFromGeminiStreaming(prompt, model, apiKey, port, updateCallback, settings = {}, abortSignal = null) {
  if (!apiKey) throw new Error("Google Gemini API key is required");
  
  console.log("Starting Gemini streaming request with new tagged format handling (revised parsing)");
  const { requestedModel, modelId, thinkingLevel } = resolveGeminiModel(model);
  const thinkingEnabled = settings.geminiThinkingEnabled === true;
  console.log(`Using Gemini model: ${requestedModel} (API model: ${modelId}), thinkingEnabled: ${thinkingEnabled}`);
  
  const heartbeatInterval = setInterval(() => {
    if (abortSignal && abortSignal.aborted) {
      clearInterval(heartbeatInterval);
      return;
    }
    try {
      port.postMessage({ type: "HEARTBEAT_PROVIDER", provider: "Gemini" });
    } catch (e) {
      console.error("Error sending Gemini heartbeat:", e);
      clearInterval(heartbeatInterval);
    }
  }, 30000);
  
  let lastChunkTime = Date.now();
  
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${apiKey}`;
    const generationConfig = { maxOutputTokens: 16384 };
    
    if (supportsTemperature(modelId)) {
      generationConfig.temperature = 0.1;
    }
    
    const thinkingConfig = addThinkingConfig(generationConfig, modelId, thinkingLevel, thinkingEnabled);
    if (thinkingConfig) {
      console.log(`Gemini thinking config: model=${modelId}, enabled=${thinkingEnabled}, config=`, thinkingConfig);
    }
    
    const requestBody = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: generationConfig,
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
      ]
    };
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Request to Gemini timed out after 20 minutes`)), 1200000);
    });
    
    console.log("Gemini: Fetching endpoint:", endpoint);
    const fetchOptions = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    };
    
    if (abortSignal) {
      fetchOptions.signal = abortSignal;
    }
    
    const fetchPromise = fetch(endpoint, fetchOptions);
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    console.log("Gemini: Response received, status:", response.status);
    
    if (!response.ok) {
      let errorText = `Gemini API error: ${response.status}`;
      try {
        const errorData = await response.text();
        console.error("Gemini API raw error response text:", errorData);
        try {
          const parsedError = JSON.parse(errorData);
          if (parsedError && parsedError.error && parsedError.error.message) {
            errorText = parsedError.error.message;
          }
        } catch (jsonParseError) {
          errorText = errorData.substring(0, 200) || errorText;
        }
      } catch (textError) {
        console.error("Gemini API: Could not get text from error response body.");
      }
      throw new Error(errorText);
    }
    
    console.log("Gemini: Stream connected, starting to read data (revised parsing).");
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let chunkCount = 0;
    let streamContentReceived = false;
    let openBraces = 0;
    let jsonStart = -1;
    
    try {
      while (true) {
        if (abortSignal && abortSignal.aborted) {
          console.log("Gemini stream aborted by user");
          break;
        }
        
        const { done, value } = await reader.read();
        if (done) {
          console.log("Gemini: Stream reader marked done.");
          if (buffer.trim().length > 0) {
            console.warn("Gemini: Stream done, but non-empty buffer remains after main parsing loop:", buffer);
          }
          if (!streamContentReceived) {
            console.warn("Gemini: Stream ended but no content was ever pushed.");
          }
          break;
        }
        
        streamContentReceived = true;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // Robust JSON parsing loop
        while (buffer.length > 0) {
          if (abortSignal && abortSignal.aborted) {
            console.log("Gemini: Parsing aborted by user");
            break;
          }
          
          let originalBufferBeforeTrim = buffer;
          buffer = buffer.trimStart();
          if (buffer.startsWith(',')) {
            buffer = buffer.substring(1).trimStart();
          }
          
          if (buffer.length === 0) {
            if (originalBufferBeforeTrim.length > 0) continue;
            else break;
          }
          
          jsonStart = buffer.indexOf('{');
          if (jsonStart === -1) break;
          
          if (jsonStart > 0) {
            buffer = buffer.substring(jsonStart);
          }
          
          openBraces = 0;
          let jsonEnd = -1;
          
          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === '{') openBraces++;
            else if (buffer[i] === '}') {
              openBraces--;
              if (openBraces === 0) {
                jsonEnd = i;
                break;
              }
            }
          }
          
          if (jsonEnd !== -1) {
            const potentialMultiObjStr = buffer.substring(0, jsonEnd + 1);
            let processedOrDiscarded = false;
            
            try {
              const data = JSON.parse(potentialMultiObjStr);
              if (updateCallback) updateCallback(potentialMultiObjStr);
              
              const result = processGeminiData(data, port, abortSignal);
              if (result.chunks > 0) {
                chunkCount += result.chunks;
                lastChunkTime = Date.now();
              }
              
              buffer = buffer.substring(jsonEnd + 1);
              processedOrDiscarded = true;
            } catch (e) {
              if (e.message && e.message.includes("Unexpected non-whitespace character after JSON at position")) {
                const match = e.message.match(/position (\d+)/);
                if (match && match[1]) {
                  const position = parseInt(match[1], 10);
                  const singleObjStr = potentialMultiObjStr.substring(0, position);
                  try {
                    const data = JSON.parse(singleObjStr);
                    if (updateCallback) updateCallback(singleObjStr);
                    
                    const result = processGeminiData(data, port, abortSignal);
                    if (result.chunks > 0) {
                      chunkCount += result.chunks;
                      lastChunkTime = Date.now();
                    }
                    
                    buffer = buffer.substring(position);
                    processedOrDiscarded = true;
                  } catch (e2) {
                    console.error("Gemini: Failed to parse even the substring after 'Unexpected char' error. Discarding segment:", singleObjStr, e2.message);
                    buffer = buffer.substring(jsonEnd + 1);
                    processedOrDiscarded = true;
                  }
                } else {
                  console.error("Gemini: 'Unexpected char' error but couldn't parse position. Discarding segment:", potentialMultiObjStr, e.message);
                  buffer = buffer.substring(jsonEnd + 1);
                  processedOrDiscarded = true;
                }
              } else {
                console.error("Gemini: Malformed JSON object (not 'Unexpected char' type). Discarding segment:", potentialMultiObjStr, e.message);
                buffer = buffer.substring(jsonEnd + 1);
                processedOrDiscarded = true;
              }
            }
            
            if (!processedOrDiscarded) {
              console.warn("Gemini: Segment identified by jsonEnd was not processed or discarded. Fallback: Discarding.", buffer.substring(0, jsonEnd + 1));
              buffer = buffer.substring(jsonEnd + 1);
            }
            
            jsonStart = -1;
            openBraces = 0;
          } else {
            break;
          }
        }
        
        const now = Date.now();
        if (now - lastChunkTime > 15000 && streamContentReceived && (!abortSignal || !abortSignal.aborted)) {
          try {
            port.postMessage({ type: "HEARTBEAT_PROVIDER", provider: "Gemini", sub_type: "content_gap" });
          } catch (e) {
            console.log("Port disconnected during Gemini content heartbeat, stopping");
            break;
          }
          lastChunkTime = now;
        }
      }
      console.log("Gemini streaming finished from provider function, total chunks processed:", chunkCount);
    } finally {
      reader.releaseLock();
      console.log("Gemini: Reader lock released.");
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("Gemini streaming was cancelled");
      return;
    }
    console.error(`Gemini Streaming Main Catch Block Error (${model}):`, error.message, error);
    throw error;
  } finally {
    clearInterval(heartbeatInterval);
    console.log("Gemini: Heartbeat interval cleared.");
  }
}

/**
 * Process Gemini response data and send chunks
 */
function processGeminiData(data, port, abortSignal) {
  let chunks = 0;
  
  if (data.candidates && data.candidates[0]?.content?.parts) {
    for (const part of data.candidates[0].content.parts) {
      if (part.text) {
        let textValue = part.text;
        const trimmedTextValue = textValue.trim();
        let potentialJsonPayload = trimmedTextValue;
        
        if (trimmedTextValue.startsWith("json")) {
          potentialJsonPayload = trimmedTextValue.substring(4).trimStart();
        }
        
        if (potentialJsonPayload.startsWith("[") && potentialJsonPayload.endsWith("]")) {
          try {
            const innerArray = JSON.parse(potentialJsonPayload);
            if (Array.isArray(innerArray)) {
              let successfullyProcessedInnerJson = false;
              for (const item of innerArray) {
                if (typeof item === 'object' && item !== null) {
                  for (const key in item) {
                    if (item.hasOwnProperty(key) && typeof item[key] === 'string') {
                      const finalChunk = item[key];
                      if (!abortSignal || !abortSignal.aborted) {
                        try {
                          port.postMessage({ type: "STREAM_CHUNK", chunk: finalChunk });
                        } catch (e) {
                          return { chunks };
                        }
                      }
                      chunks++;
                      successfullyProcessedInnerJson = true;
                    }
                  }
                }
              }
              if (successfullyProcessedInnerJson) continue;
            }
          } catch (e_inner) {
            // Not a valid inner JSON array
          }
        }
        
        if (!abortSignal || !abortSignal.aborted) {
          try {
            port.postMessage({ type: "STREAM_CHUNK", chunk: textValue });
          } catch (e) {
            return { chunks };
          }
        }
        chunks++;
      }
    }
  } else if (data.candidates && data.candidates[0]?.finishReason) {
    let fm = `Stream ended by Gemini: ${data.candidates[0].finishReason}`;
    if (data.candidates[0].finishReason === "SAFETY") fm = "Content blocked: SAFETY";
    const statusChunk = `<ugt_status_gemini>[${fm}]</ugt_status_gemini>`;
    if (!abortSignal || !abortSignal.aborted) {
      try {
        port.postMessage({ type: "STREAM_CHUNK", chunk: statusChunk });
      } catch (e) {
        return { chunks };
      }
    }
    chunks++;
  } else if (data.error) {
    console.error("Gemini explicit error in stream data object:", data.error);
    const errorChunk = `<ugt_status_gemini>[Error: ${data.error.message || 'Unknown Gemini error'}]</ugt_status_gemini>`;
    if (!abortSignal || !abortSignal.aborted) {
      try {
        port.postMessage({ type: "STREAM_CHUNK", chunk: errorChunk });
      } catch (e) {
        return { chunks };
      }
    }
    chunks++;
  }
  
  return { chunks };
}

/**
 * Streaming Gemini API call for chat/followup conversations
 */
export async function fetchChatFromGeminiStreaming(prompt, model, apiKey, sendChunk, settings = {}, abortSignal = null) {
  if (!apiKey) throw new Error("Google Gemini API key is required");
  
  const { modelId, thinkingLevel } = resolveGeminiModel(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${apiKey}`;
  
  const generationConfig = { maxOutputTokens: 8192 };
  if (supportsTemperature(modelId)) {
    generationConfig.temperature = 0.7;
  }
  addThinkingConfig(generationConfig, modelId, thinkingLevel, settings.geminiThinkingEnabled === true);
  
  const requestBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: generationConfig
  };
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: abortSignal
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(error?.error?.message || `Gemini API error: ${response.status}`);
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let openBraces = 0;
  
  try {
    while (true) {
      if (abortSignal && abortSignal.aborted) break;
      
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      while (buffer.length > 0) {
        buffer = buffer.trimStart();
        if (buffer.startsWith(',')) {
          buffer = buffer.substring(1).trimStart();
        }
        
        if (buffer.length === 0) break;
        
        const jsonStart = buffer.indexOf('{');
        if (jsonStart === -1) break;
        
        if (jsonStart > 0) {
          buffer = buffer.substring(jsonStart);
        }
        
        openBraces = 0;
        let jsonEnd = -1;
        
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === '{') openBraces++;
          else if (buffer[i] === '}') {
            openBraces--;
            if (openBraces === 0) {
              jsonEnd = i;
              break;
            }
          }
        }
        
        if (jsonEnd !== -1) {
          const jsonStr = buffer.substring(0, jsonEnd + 1);
          try {
            const data = JSON.parse(jsonStr);
            if (data.candidates && data.candidates[0]?.content?.parts) {
              for (const part of data.candidates[0].content.parts) {
                if (part.text) {
                  sendChunk(part.text);
                }
              }
            }
          } catch (e) {
            // Ignore parse errors
          }
          buffer = buffer.substring(jsonEnd + 1);
        } else {
          break;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
