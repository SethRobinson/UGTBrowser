// src/background/api/openai.js
// OpenAI API integration for translation and chat

import { supportsTemperature, isGPT5Model, isGPT52Pro, getReasoningEffort } from '../../shared/utils.js';

/**
 * Non-streaming OpenAI API call
 */
export async function fetchFromOpenAI(prompt, model, apiKey) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  
  const endpoint = "https://api.openai.com/v1/chat/completions";
  
  const requestBody = {
    model: model || "gpt-4o",
    messages: [{ role: "user", content: prompt }]
  };
  
  if (supportsTemperature(model)) {
    requestBody.temperature = 0.1;
  }
  
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
  return data.choices[0].message.content;
}

/**
 * Streaming OpenAI API call for translations
 */
export async function fetchFromOpenAIStreaming(prompt, model, apiKey, port, updateCallback, settings = {}, abortSignal = null) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  
  const modelToUse = model || "gpt-4o";
  const thinkingEnabled = settings.openaiThinkingEnabled === true;
  const useResponsesApi = isGPT52Pro(modelToUse);
  const reasoningEffort = getReasoningEffort(modelToUse, thinkingEnabled);
  
  console.log(`Starting OpenAI streaming request: model=${modelToUse}, useResponsesApi=${useResponsesApi}, thinkingEnabled=${thinkingEnabled}, reasoningEffort=${reasoningEffort}`);
  
  let endpoint, requestBody;
  
  if (useResponsesApi) {
    endpoint = "https://api.openai.com/v1/responses";
    requestBody = {
      model: modelToUse,
      input: prompt,
      max_output_tokens: 16384
    };
    
    if (reasoningEffort) {
      requestBody.reasoning = { effort: reasoningEffort };
    }
  } else {
    endpoint = "https://api.openai.com/v1/chat/completions";
    requestBody = {
      model: modelToUse,
      messages: [{ role: "user", content: prompt }],
      stream: true
    };
    
    if (supportsTemperature(modelToUse)) {
      requestBody.temperature = 0.1;
    }
    
    const reasoningEffortForChat = getReasoningEffort(modelToUse, thinkingEnabled);
    if (reasoningEffortForChat) {
      requestBody.reasoning_effort = reasoningEffortForChat;
    }
  }
  
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
    
    if (useResponsesApi) {
      console.log("OpenAI Responses API: parsing complete response");
      const data = await response.json();
      
      let textContent = "";
      if (data.output && Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === "message" && item.content && Array.isArray(item.content)) {
            for (const contentItem of item.content) {
              if (contentItem.type === "output_text" && contentItem.text) {
                textContent += contentItem.text;
              }
            }
          }
        }
      }
      
      if (!textContent && data.output_text) {
        textContent = data.output_text;
      }
      
      if (textContent) {
        if (!abortSignal || !abortSignal.aborted) {
          try {
            port.postMessage({ type: "STREAM_CHUNK", chunk: textContent });
          } catch (e) {
            console.log("Port disconnected during OpenAI Responses API, stopping");
            return;
          }
        }
        if (updateCallback) updateCallback(textContent);
        console.log("OpenAI Responses API: sent complete response");
      } else {
        console.error("OpenAI Responses API: could not extract text from response", data);
        throw new Error("Could not extract text from Responses API response");
      }
    } else {
      console.log("OpenAI stream connected, reading data (tagged format)");
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let chunkCount = 0;
      
      try {
        while (true) {
          if (abortSignal && abortSignal.aborted) {
            console.log("OpenAI stream aborted by user");
            break;
          }
          
          const { done, value } = await reader.read();
          if (done) {
            console.log("OpenAI stream complete after", chunkCount, "chunks");
            break;
          }
          
          const chunk = decoder.decode(value);
          buffer += chunk;
          
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          
          for (const line of lines) {
            if (abortSignal && abortSignal.aborted) break;
            
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.substring(6));
                if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                  const newContent = data.choices[0].delta.content;
                  if (!abortSignal || !abortSignal.aborted) {
                    try {
                      port.postMessage({ type: "STREAM_CHUNK", chunk: newContent });
                    } catch (e) {
                      console.log("Port disconnected during OpenAI streaming, stopping");
                      return;
                    }
                  }
                  if (updateCallback) updateCallback(newContent);
                  chunkCount++;
                }
              } catch (e) {
                if (!abortSignal || !abortSignal.aborted) {
                  console.error("Error parsing OpenAI stream line:", e, "Line:", line);
                }
              }
            } else if (line === "data: [DONE]") {
              console.log("OpenAI stream [DONE] marker received");
            }
          }
        }
        
        if (!abortSignal || !abortSignal.aborted) {
          console.log("OpenAI streaming finished from provider function, total chunks:", chunkCount);
        }
      } finally {
        reader.releaseLock();
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("OpenAI streaming was cancelled");
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
  
  const modelToUse = model || "gpt-4o";
  const endpoint = "https://api.openai.com/v1/chat/completions";
  
  const requestBody = {
    model: modelToUse,
    messages: [{ role: "user", content: prompt }],
    stream: true
  };
  
  if (supportsTemperature(modelToUse)) {
    requestBody.temperature = 0.7;
  }
  
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
        if (line.startsWith("data: ") && line !== "data: [DONE]") {
          try {
            const data = JSON.parse(line.substring(6));
            if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
              sendChunk(data.choices[0].delta.content);
            }
          } catch (e) {
            // Ignore parse errors for incomplete JSON
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
