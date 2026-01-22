// background.js

// Context menu IDs - nested structure
const CONTEXT_MENU_PARENT = "ugtbrowser_parent";
const CONTEXT_MENU_TRANSLATE = "ugtbrowser_translate";
const CONTEXT_MENU_SPEAK = "ugtbrowser_speak";
const CONTEXT_MENU_SETTINGS = "ugtbrowser_settings";

// Models that don't support temperature settings
const noTemperatureModels = [
  "gpt-5-mini",
  "gpt-5-nano",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview"
];

// Default prompts for different providers
const unifiedDefaultPrompt = "You are a translation engine. The input text contains segments, each wrapped in XML-like tags with a unique ID, like `<ugt_some_id>Text to translate</ugt_some_id>`.\nTranslate the text content within each tag to {{target}}.\nYour output MUST consist ONLY of the translated segments, each wrapped in the EXACT SAME XML-like tags as the input.\nFor example, if the input is `<ugt_abc>Hello</ugt_abc>` and the target language is Spanish, the output must be `<ugt_abc>Hola</ugt_abc>`.\nIf there are multiple input segments, provide a corresponding translated segment for each, preserving their order and tags.\nDo not add any other text, explanations, or formatting outside of these tags.\n\nInput Text:\n{{text}}";

const defaultPrompts = {
  openai: unifiedDefaultPrompt,
  anthropic: unifiedDefaultPrompt,
  gemini: unifiedDefaultPrompt
};

// Track active streaming ports for heartbeat responses
const activeStreamingPorts = new Map();

// Add these variables to store the last request and response
let lastLLMRequest = null;
let lastLLMResponse = null;

// Set up an interval to check for stalled connections
setInterval(() => {
  const now = Date.now();
  
  // Check each active connection
  activeStreamingPorts.forEach((portInfo, portId) => {
    const { port, lastActivity } = portInfo;
    const inactiveTime = now - lastActivity;
    
    // If inactive for more than 60 seconds, send a status check
    if (inactiveTime > 60000) {
      console.log(`Port ${portId} inactive for ${inactiveTime/1000} seconds, sending status check`);
      
      try {
        // Send status check
        port.postMessage({ 
          type: "STATUS_CHECK", 
          message: "Checking connection status - please respond" 
        });
      } catch (e) {
        console.error(`Error sending status check to port ${portId}:`, e);
        // Remove from active ports if we can't communicate
        activeStreamingPorts.delete(portId);
      }
    }
    
    // If inactive for more than 5 minutes, consider it lost
    if (inactiveTime > 300000) {
      console.warn(`Port ${portId} inactive for 5+ minutes, considering connection lost`);
      
      try {
        // Send one last message before cleaning up
        port.postMessage({ 
          type: "STREAM_ERROR", 
          error: "Connection timed out after 5 minutes of inactivity" 
        });
        port.disconnect();
      } catch (e) {
        console.error(`Error disconnecting stalled port ${portId}:`, e);
      }
      
      // Remove from active ports
      activeStreamingPorts.delete(portId);
    }
  });
}, 30000); // Check every 30 seconds

// Function to check if a model supports temperature settings
function supportsTemperature(model) {
  return !noTemperatureModels.includes(model);
}

// Helper functions for GPT-5.x models
function isGPT5Model(model) {
  if (!model) return false;
  return model.startsWith('gpt-5');
}

function isGPT52Pro(model) {
  if (!model) return false;
  return model.toLowerCase() === 'gpt-5.2-pro';
}

function supportsNoneReasoningEffort(model) {
  // GPT-5.1 and GPT-5.2 (but NOT GPT-5.2 Pro) support 'none'
  // GPT-5.2 Pro only supports 'medium', 'high', 'xhigh'
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  if (lowerModel === 'gpt-5.2-pro') return false; // GPT-5.2 Pro doesn't support 'none'
  return lowerModel.startsWith('gpt-5.1') || lowerModel.startsWith('gpt-5.2');
}

function getReasoningEffort(model, thinkingEnabled) {
  if (!model) return null;
  const lowerModel = model.toLowerCase();
  
  if (!isGPT5Model(model)) {
    return null; // Not a GPT-5 model, doesn't support reasoning_effort
  }
  
  // GPT-5.2 Pro has different supported values: 'medium', 'high', 'xhigh' (no 'none' or 'low')
  if (lowerModel === 'gpt-5.2-pro') {
    if (thinkingEnabled) {
      return "high"; // Use 'high' when thinking is enabled
    } else {
      return "medium"; // Use 'medium' (lowest) when thinking is disabled
    }
  }
  
  if (thinkingEnabled) {
    return "medium";
  } else {
    // When disabled: 'none' for GPT-5.1/5.2 (non-Pro), 'low' for GPT-5/5-mini/5-nano
    // GPT-5 Nano and Mini need 'low' explicitly set to avoid default thinking behavior
    return supportsNoneReasoningEffort(model) ? "none" : "low";
  }
}

// Helper functions for Gemini models
function isGemini3Model(model) {
  if (!model) return false;
  return model.toLowerCase().startsWith('gemini-3');
}

function supportsGeminiThinking(model) {
  // Gemini 2.5 and 3.x models support thinking
  if (!model) return false;
  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith('gemini-2.5') || lowerModel.startsWith('gemini-3');
}

function buildTranslateTitle(settings) {
  let langName = "English"; // Fallback default
  let providerName = "OpenAI"; // Fallback default

  if (settings) {
    providerName = (settings.provider || "openai").replace(/^./, (c) => c.toUpperCase());

    if (settings.languageMode === 'custom') {
      if (settings.customLanguage && settings.customLanguage.trim() !== "") {
        langName = settings.customLanguage.trim();
      } else {
        langName = "Custom"; // Placeholder if custom mode is selected but no text is entered
      }
    } else if (settings.targetLanguage) { // Standard mode
      langName = settings.targetLanguage;
    }
    // If settings exist but don't specify languageMode or targetLanguage appropriately, langName remains "English".
  }

  // Truncate langName if it's too long for the context menu
  if (langName.length > 16) {
    langName = langName.substring(0, 16) + "...";
  }

  return `Translate to ${langName} with ${providerName}`;
}

function buildSpeakTitle(settings) {
  const ttsProvider = settings?.ttsProvider || 'elevenlabs';
  let voiceName = "Default";
  let providerLabel = "ElevenLabs";
  
  if (ttsProvider === 'google') {
    providerLabel = "Google TTS";
    if (settings && settings.googleTtsVoiceName) {
      // Extract just the voice type from the full name (e.g., "English (US) - Studio O (female)" -> "Studio O")
      const match = settings.googleTtsVoiceName.match(/- ([^(]+)/);
      voiceName = match ? match[1].trim() : settings.googleTtsVoiceName;
    }
  } else {
    // ElevenLabs
    if (settings && settings.elevenlabsCustomVoiceId && settings.elevenlabsCustomVoiceId.length > 0) {
      voiceName = "Custom Voice";
    } else if (settings && settings.elevenlabsVoiceName) {
      voiceName = settings.elevenlabsVoiceName;
    }
  }
  
  // Truncate if too long
  if (voiceName.length > 20) {
    voiceName = voiceName.substring(0, 20) + "...";
  }
  
  return `Speak with ${providerLabel} (${voiceName})`;
}

function createContextMenus(settings = {}) {
  chrome.contextMenus.removeAll(() => {
    // Create parent menu item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_PARENT,
      title: "UGTBrowser",
      contexts: ["selection"]
    });
    
    // Create Translate child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_TRANSLATE,
      parentId: CONTEXT_MENU_PARENT,
      title: buildTranslateTitle(settings),
      contexts: ["selection"]
    });
    
    // Create Speak child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SPEAK,
      parentId: CONTEXT_MENU_PARENT,
      title: buildSpeakTitle(settings),
      contexts: ["selection"]
    });
    
    // Create Settings child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SETTINGS,
      parentId: CONTEXT_MENU_PARENT,
      title: "Settings",
      contexts: ["selection"]
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  // Fetch all relevant settings to build the initial context menu title correctly
  chrome.storage.local.get([
    'settings', 'languageMode', 'targetLanguage', 'customLanguage', 'selectedProvider',
    'ttsProvider', 'elevenlabsVoice', 'elevenlabsVoiceName', 'elevenlabsCustomVoiceId',
    'googleTtsVoice', 'googleTtsVoiceName'
  ], (fullSettings) => {
    const effectiveSettings = {
      provider: fullSettings.selectedProvider || fullSettings.settings?.provider || 'openai',
      languageMode: fullSettings.languageMode || fullSettings.settings?.languageMode || 'standard',
      targetLanguage: fullSettings.targetLanguage || fullSettings.settings?.targetLang || 'en',
      customLanguage: fullSettings.customLanguage || fullSettings.settings?.customLanguage || '',
      ttsProvider: fullSettings.ttsProvider || 'elevenlabs',
      elevenlabsVoiceName: fullSettings.elevenlabsVoiceName || 'Rachel',
      elevenlabsCustomVoiceId: fullSettings.elevenlabsCustomVoiceId || '',
      googleTtsVoiceName: fullSettings.googleTtsVoiceName || 'English (US) - Studio O (female)'
    };
    createContextMenus(effectiveSettings);
  });
});

// Update menu title when settings change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    // Check if any of the relevant settings changed
    const relevantChanges = ['settings', 'languageMode', 'targetLanguage', 'customLanguage', 'selectedProvider', 
      'ttsProvider', 'elevenlabsVoice', 'elevenlabsVoiceName', 'elevenlabsCustomVoiceId',
      'googleTtsVoice', 'googleTtsVoiceName'];
    let needsUpdate = false;
    for (const key of relevantChanges) {
      if (changes[key]) {
        needsUpdate = true;
        break;
      }
    }

    if (needsUpdate) {
      // Fetch all current settings to rebuild the title correctly
      chrome.storage.local.get([
        'settings', 'languageMode', 'targetLanguage', 'customLanguage', 'selectedProvider',
        'ttsProvider', 'elevenlabsVoice', 'elevenlabsVoiceName', 'elevenlabsCustomVoiceId',
        'googleTtsVoice', 'googleTtsVoiceName'
      ], (fullSettings) => {
        // The `settings` object from storage might be nested or flat depending on how it was saved.
        // We need to construct a comprehensive object for buildTranslateTitle.
        const effectiveSettings = {
          provider: fullSettings.selectedProvider || fullSettings.settings?.provider || 'openai',
          languageMode: fullSettings.languageMode || fullSettings.settings?.languageMode || 'standard',
          targetLanguage: fullSettings.targetLanguage || fullSettings.settings?.targetLang || 'en',
          customLanguage: fullSettings.customLanguage || fullSettings.settings?.customLanguage || '',
          ttsProvider: fullSettings.ttsProvider || 'elevenlabs',
          elevenlabsVoiceName: fullSettings.elevenlabsVoiceName || 'Rachel',
          elevenlabsCustomVoiceId: fullSettings.elevenlabsCustomVoiceId || '',
          googleTtsVoiceName: fullSettings.googleTtsVoiceName || 'English (US) - Studio O (female)'
        };
        createContextMenus(effectiveSettings);
      });
    }
  }
});

// Messaging between content script and background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_TRANSLATION") {
    const { textPayload, settings } = message.payload;
    
    let actualPromptText = "";
    const provider = settings.provider || "openai";
    const targetLang = settings.targetLang || "English";

    if (settings.promptTemplate && settings.promptTemplate.trim() !== "") {
      actualPromptText = settings.promptTemplate;
    } else {
      actualPromptText = defaultPrompts[provider] || defaultPrompts["openai"];
    }

    // Transform textPayload to the new <ugt_id>Text</ugt_id> format
    const transformedTextPayload = textPayload.split('\n').map(line => {
      const match = line.match(/^(ugt_[^:]+):(.*)$/);
      if (match) {
        const id = match[1];
        const text = match[2].trim(); // Trim whitespace from the captured text
        return `<${id}>${text}</${id}>`;
      }
      // If a line doesn't match, return it as is.
      // This case should ideally not be hit if contentScript.js always sends 'ugt_ID: Text' lines.
      return line; 
    }).join('\n');

    actualPromptText = actualPromptText.replace("{{text}}", transformedTextPayload);
    actualPromptText = actualPromptText.replace("{{target}}", targetLang);

    if (settings.streaming) {
      let port = chrome.tabs.connect(sender.tab.id, {name: "translation_stream", frameId: sender.frameId});
      if (chrome.runtime.lastError) {
        console.error("Failed to connect to tab:", chrome.runtime.lastError.message);
        // Potentially send an error response back to the original message sender
        // if the port couldn't be established, as streaming won't work.
        sendResponse({ success: false, error: "Failed to establish streaming connection: " + chrome.runtime.lastError.message });
        return true; // Important: still return true because sendResponse was called.
      }
      
      const portId = Date.now().toString();
      activeStreamingPorts.set(portId, { port: port, tabId: sender.tab.id, lastActivity: Date.now() });
      
      port.onDisconnect.addListener(() => {
        console.log(`Port ${portId} disconnected, removing from active ports map`);
        activeStreamingPorts.delete(portId);
      });
      
      port.onMessage.addListener((msg) => {
        const portInfo = activeStreamingPorts.get(portId);
        if (!portInfo) return;

        portInfo.lastActivity = Date.now();
        activeStreamingPorts.set(portId, portInfo);

        if (msg.type === "HEARTBEAT") {
          console.log("Heartbeat from content script:", msg.timestamp);
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
      
      fetchTranslationStreaming(actualPromptText, settings, port)
        .then(result => {
          console.log("fetchTranslationStreaming resolved. Sending STREAM_COMPLETE.");
          port.postMessage({ type: "STREAM_COMPLETE", success: true /* finalContent can be omitted */ });
        })
        .catch(error => {
          console.error("fetchTranslationStreaming error:", error);
          try {
            port.postMessage({ type: "STREAM_ERROR", error: error.message || String(error) });
          } catch (e) {
            console.error("Error sending STREAM_ERROR to port:", e);
          }
        })
        .finally(() => {
        });
      
      sendResponse({ status: "streaming_started" });
    } else {
      fetchTranslation(actualPromptText, settings)
        .then(result => {
          sendResponse({ success: true, result });
        })
        .catch(error => {
          console.error("Translation error:", error);
          sendResponse({ success: false, error: error.message || String(error) });
        });
    }
    return true;
  } else if (message.type === "OPEN_SETTINGS") {
    chrome.runtime.openOptionsPage();
    return false;
  } else if (message.type === "GET_LAST_LLM_DATA") {
    sendResponse({
      lastRequest: lastLLMRequest,
      lastResponse: lastLLMResponse
    });
    return true;
  } else if (message.type === "UGT_SHOW_OVERLAY_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_SHOW_OVERLAY", provider: message.provider });
    return;
  } else if (message.type === "UGT_HIDE_OVERLAY_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_HIDE_OVERLAY", force: message.force });
    return;
  } else if (message.type === "UGT_SHOW_ERROR_RELAY") {
    console.log("[background.js] Received UGT_SHOW_ERROR_RELAY, relaying to tab", sender.tab.id);
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_SHOW_ERROR", message: message.message, errorContext: message.errorContext });
    return;
  } else if (message.type === "UGT_UPDATE_OVERLAY_PREVIEW_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_UPDATE_OVERLAY_PREVIEW", text: message.text });
    return;
  } else if (message.type === "UGT_TRANSLATION_COMPLETE_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_TRANSLATION_COMPLETE", provider: message.provider });
    return;
  } else if (message.type === "UGT_OPEN_PREVIEW_RELAY") {
    chrome.tabs.sendMessage(sender.tab.id, { type: "UGT_OPEN_PREVIEW", text: message.text });
    return;
  } else if (message.type === "TEST_TTS") {
    // Handle TTS test from options page
    const { text, voiceId, apiKey, modelId } = message.payload;
    
    fetchFromElevenLabs(text, voiceId, apiKey, modelId)
      .then(base64Audio => {
        sendResponse({ success: true, audio: base64Audio, mimeType: "audio/mpeg" });
      })
      .catch(error => {
        console.error("TTS test error:", error);
        sendResponse({ success: false, error: error.message || String(error) });
      });
    return true; // Keep message channel open for async response
  } else if (message.type === "TEST_GOOGLE_TTS") {
    // Handle Google TTS test from options page
    const { text, voiceId, apiKey, speakingRate, pitch } = message.payload;
    
    fetchFromGoogleTTS(text, voiceId, apiKey, speakingRate, pitch)
      .then(base64Audio => {
        sendResponse({ success: true, audio: base64Audio, mimeType: "audio/mp3" });
      })
      .catch(error => {
        console.error("Google TTS test error:", error);
        sendResponse({ success: false, error: error.message || String(error) });
      });
    return true; // Keep message channel open for async response
  } else if (message.type === "CHAT_FOLLOWUP") {
    // Handle follow-up chat questions about cultural nuances
    const { question, originalText, culturalNuances, chatHistory } = message.payload;
    
    // Get current settings to use the same provider/model
    chrome.storage.local.get(['settings', 'selectedProvider', 'openaiApiKey', 'anthropicApiKey', 'geminiApiKey'], async (data) => {
      const settings = data.settings || {};
      const provider = data.selectedProvider || settings.provider || 'openai';
      const model = settings.model;
      
      // Get the appropriate API key
      let apiKey;
      if (provider === 'openai') {
        apiKey = data.openaiApiKey;
      } else if (provider === 'anthropic') {
        apiKey = data.anthropicApiKey;
      } else if (provider === 'gemini') {
        apiKey = data.geminiApiKey;
      }
      
      if (!apiKey) {
        chrome.tabs.sendMessage(sender.tab.id, { 
          type: "CHAT_STREAM_ERROR", 
          error: `No API key configured for ${provider}. Please check your settings.`
        }, { frameId: sender.frameId });
        return;
      }
      
      // Build the chat prompt with context
      const chatPrompt = buildChatPrompt(question, originalText, culturalNuances, chatHistory);
      
      try {
        // Use streaming for chat responses
        await fetchChatStreaming(chatPrompt, provider, model, apiKey, sender.tab.id, sender.frameId, settings);
        
        // Send completion message
        chrome.tabs.sendMessage(sender.tab.id, { 
          type: "CHAT_STREAM_COMPLETE"
        }, { frameId: sender.frameId });
        
      } catch (error) {
        console.error("Chat followup error:", error);
        chrome.tabs.sendMessage(sender.tab.id, { 
          type: "CHAT_STREAM_ERROR", 
          error: error.message || String(error)
        }, { frameId: sender.frameId });
      }
    });
    
    sendResponse({ status: "chat_started" });
    return true;
  }
});

// Build a prompt for follow-up chat questions
function buildChatPrompt(question, originalText, culturalNuances, chatHistory) {
  let prompt = `You are a helpful assistant that answers questions about translations and cultural context.

Here is the context:

**Original Text (before translation):**
${originalText}

**Cultural Nuances Explanation:**
${culturalNuances}

`;

  // Add chat history if any
  if (chatHistory && chatHistory.length > 0) {
    prompt += `**Previous Conversation:**\n`;
    for (const msg of chatHistory) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      prompt += `${role}: ${msg.content}\n`;
    }
    prompt += '\n';
  }

  prompt += `**Current Question:**
${question}

Please provide a helpful, concise answer. If the question relates to the translation or cultural aspects, use the context provided. Format your response clearly, using markdown for emphasis where appropriate.`;

  return prompt;
}

// Streaming chat function for follow-up questions
async function fetchChatStreaming(prompt, provider, model, apiKey, tabId, frameId, settings = {}) {
  console.log(`Starting chat streaming for provider: ${provider}`);
  
  const sendChunk = (chunk) => {
    chrome.tabs.sendMessage(tabId, { 
      type: "CHAT_STREAM_CHUNK", 
      chunk: chunk 
    }, { frameId: frameId });
  };
  
  switch (provider) {
    case "openai":
      await fetchChatFromOpenAIStreaming(prompt, model, apiKey, sendChunk, settings);
      break;
    case "anthropic":
      await fetchChatFromAnthropicStreaming(prompt, model, apiKey, sendChunk);
      break;
    case "gemini":
      await fetchChatFromGeminiStreaming(prompt, model, apiKey, sendChunk, settings);
      break;
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// OpenAI chat streaming
async function fetchChatFromOpenAIStreaming(prompt, model, apiKey, sendChunk, settings = {}) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  
  const modelToUse = model || "gpt-4o";
  const endpoint = "https://api.openai.com/v1/chat/completions";
  
  const requestBody = {
    model: modelToUse,
    messages: [{ role: "user", content: prompt }],
    stream: true
  };
  
  if (supportsTemperature(modelToUse)) {
    requestBody.temperature = 0.7; // Slightly higher for conversational responses
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
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  
  try {
    while (true) {
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

// Anthropic chat streaming
async function fetchChatFromAnthropicStreaming(prompt, model, apiKey, sendChunk) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  
  const modelToUse = model || "claude-sonnet-4-5";
  let maxTokens = 4096;
  
  if (modelToUse.includes("claude-sonnet-4-5") || modelToUse.includes("claude-opus-4-5") || modelToUse.includes("claude-haiku-4-5")) {
    maxTokens = 8192;
  }
  
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
    body: JSON.stringify(requestBody)
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

// Gemini chat streaming
async function fetchChatFromGeminiStreaming(prompt, model, apiKey, sendChunk, settings = {}) {
  if (!apiKey) throw new Error("Google Gemini API key is required");
  
  const modelId = model || "gemini-1.5-pro";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?key=${apiKey}`;
  
  const generationConfig = { maxOutputTokens: 8192 };
  if (supportsTemperature(modelId)) {
    generationConfig.temperature = 0.7;
  }
  
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
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let openBraces = 0;
  
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      
      // Parse JSON objects from buffer
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
          break; // Need more data
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Helper function to check if content script is loaded
async function checkIfContentScriptLoaded(tabId, frameId) {
  // console.log(`Pinging content script in tab ${tabId}, frame ${frameId}`);
  return new Promise((resolve) => { 
    chrome.tabs.sendMessage(
      tabId, 
      { type: "PING" }, 
      frameId !== undefined ? { frameId: frameId } : {}, 
      (response) => { 
        if (chrome.runtime.lastError) {
          // console.warn(`checkIfContentScriptLoaded: PING to tab ${tabId}, frame ${frameId} failed. Error: ${chrome.runtime.lastError.message}`);
          resolve(false); 
        } else {
          if (response && response.status === "ok") {
            // console.log(`checkIfContentScriptLoaded: PING successful for tab ${tabId}, frame ${frameId}`);
            resolve(true);
          } else {
            // console.warn(`checkIfContentScriptLoaded: PING to tab ${tabId}, frame ${frameId} received no/invalid response. Response:`, response);
            resolve(false); 
          }
        }
      }
    );
  });
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  // Handle Settings menu item
  if (info.menuItemId === CONTEXT_MENU_SETTINGS) {
    chrome.runtime.openOptionsPage();
    return;
  }
  
  // Handle Translate menu item
  if (info.menuItemId === CONTEXT_MENU_TRANSLATE && info.selectionText) {
    chrome.storage.local.get(null, async (data) => { 
      const settings = data.settings || {};
      const messagePayload = { 
        type: "TRANSLATE_SELECTION",
        text: info.selectionText,
        settings
      };
      
      try {
        chrome.tabs.sendMessage(tab.id, messagePayload, { frameId: info.frameId }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`Error sending TRANSLATE_SELECTION to tab ${tab.id}, frame ${info.frameId}: ${chrome.runtime.lastError.message}`);
          }
        });
      } catch (error) { 
        console.error("Synchronous error in context menu click handler:", error.message);
      }
    });
    return;
  }
  
  // Handle Speak (TTS) menu item
  if (info.menuItemId === CONTEXT_MENU_SPEAK && info.selectionText) {
    chrome.storage.local.get([
      'ttsProvider', 'elevenlabsApiKey', 'elevenlabsVoice', 'elevenlabsCustomVoiceId', 'elevenlabsModel',
      'googleTtsApiKey', 'googleTtsVoice', 'googleTtsSpeakingRate', 'googleTtsPitch'
    ], async (data) => {
      const ttsProvider = data.ttsProvider || 'elevenlabs';
      
      // Show TTS overlay
      chrome.tabs.sendMessage(tab.id, { 
        type: "UGT_SHOW_TTS_OVERLAY"
      }, { frameId: info.frameId });
      
      try {
        let base64Audio;
        let mimeType;
        
        if (ttsProvider === 'google') {
          // Google TTS
          const apiKey = data.googleTtsApiKey;
          const voiceId = data.googleTtsVoice || 'en-US-Studio-O';
          const speakingRate = data.googleTtsSpeakingRate || 1.0;
          const pitch = data.googleTtsPitch || 0;
          
          if (!apiKey) {
            chrome.tabs.sendMessage(tab.id, { 
              type: "UGT_SHOW_ERROR", 
              message: "Google Cloud TTS API key is not configured. Please add your API key in UGTBrowser Settings.",
              errorContext: "API_KEY_ISSUE"
            }, { frameId: info.frameId });
            chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" }, { frameId: info.frameId });
            return;
          }
          
          base64Audio = await fetchFromGoogleTTS(info.selectionText, voiceId, apiKey, speakingRate, pitch);
          mimeType = "audio/mp3";
          
        } else {
          // ElevenLabs TTS
          const apiKey = data.elevenlabsApiKey;
          const customVoiceId = data.elevenlabsCustomVoiceId || '';
          const selectedVoiceId = data.elevenlabsVoice || "21m00Tcm4TlvDq8ikWAM";
          const voiceId = customVoiceId.length > 0 ? customVoiceId : selectedVoiceId;
          const modelId = data.elevenlabsModel || "eleven_multilingual_v2";
          
          if (!apiKey) {
            chrome.tabs.sendMessage(tab.id, { 
              type: "UGT_SHOW_ERROR", 
              message: "ElevenLabs API key is not configured. Please add your API key in UGTBrowser Settings.",
              errorContext: "API_KEY_ISSUE"
            }, { frameId: info.frameId });
            chrome.tabs.sendMessage(tab.id, { type: "UGT_HIDE_TTS_OVERLAY" }, { frameId: info.frameId });
            return;
          }
          
          base64Audio = await fetchFromElevenLabs(info.selectionText, voiceId, apiKey, modelId);
          mimeType = "audio/mpeg";
        }
        
        // Send audio to content script for playback
        chrome.tabs.sendMessage(tab.id, { 
          type: "PLAY_TTS_AUDIO",
          audio: base64Audio,
          mimeType: mimeType
        }, { frameId: info.frameId }, (response) => {
          if (chrome.runtime.lastError) {
            console.error(`Error sending PLAY_TTS_AUDIO to tab ${tab.id}: ${chrome.runtime.lastError.message}`);
          }
        });
        
      } catch (error) {
        const providerName = ttsProvider === 'google' ? 'Google TTS' : 'ElevenLabs';
        console.error(`${providerName} TTS error:`, error);
        chrome.tabs.sendMessage(tab.id, { 
          type: "UGT_SHOW_ERROR", 
          message: `${providerName} TTS error: ${error.message}`,
          errorContext: "API_KEY_ISSUE"
        }, { frameId: info.frameId });
        
        // Hide overlay on error
        chrome.tabs.sendMessage(tab.id, { 
          type: "UGT_HIDE_TTS_OVERLAY"
        }, { frameId: info.frameId });
      }
    });
    return;
  }
});

// New streaming translation function
async function fetchTranslationStreaming(promptText, settings, port) {
  const { provider = "openai", model, apiKey, internalBatch } = settings;
  
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
        await fetchFromOpenAIStreaming(promptText, model, apiKey, port, streamUpdateCallbackForDebug, settings);
        break;
      case "anthropic":
        await fetchFromAnthropicStreaming(promptText, model, apiKey, port, streamUpdateCallbackForDebug);
        break;
      case "gemini":
        await fetchFromGeminiStreaming(promptText, model, apiKey, port, streamUpdateCallbackForDebug, settings);
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

// The actual translation fetching logic
async function fetchTranslation(promptText, settings) {
  const { provider = "openai", model, apiKey, internalBatch } = settings;
  
  // Store the last request
  lastLLMRequest = {
    timestamp: new Date().toISOString(),
    prompt: promptText,
    provider,
    model
  };
  
  // Just handle batch in format we want, since it's an internal API
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
      
      // Store the last response
      lastLLMResponse = {
        timestamp: new Date().toISOString(),
        response: result,
        provider,
        model
      };
      
      return result;
    } catch (e) {
      console.error(`${provider} API error:`, e);
      
      // Store the error response
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

async function fetchFromOpenAI(prompt, model, apiKey) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  
  const endpoint = "https://api.openai.com/v1/chat/completions";
  
  // Create the request body
  const requestBody = {
    model: model || "gpt-4o",
    messages: [{ role: "user", content: prompt }]
  };
  
  // Only add temperature if the model supports it
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

async function fetchFromOpenAIStreaming(prompt, model, apiKey, port, updateCallback, settings = {}) {
  if (!apiKey) throw new Error("OpenAI API key is required");
  
  const modelToUse = model || "gpt-4o";
  const thinkingEnabled = settings.openaiThinkingEnabled === true;
  const useResponsesApi = isGPT52Pro(modelToUse);
  const reasoningEffort = getReasoningEffort(modelToUse, thinkingEnabled);
  
  console.log(`Starting OpenAI streaming request: model=${modelToUse}, useResponsesApi=${useResponsesApi}, thinkingEnabled=${thinkingEnabled}, reasoningEffort=${reasoningEffort}`);
  
  let endpoint, requestBody;
  
  if (useResponsesApi) {
    // GPT-5.2 Pro uses the Responses API
    endpoint = "https://api.openai.com/v1/responses";
    
    const reasoningEffort = getReasoningEffort(modelToUse, thinkingEnabled);
    requestBody = {
      model: modelToUse,
      input: prompt,
      max_output_tokens: 16384
    };
    
    if (reasoningEffort) {
      requestBody.reasoning = { effort: reasoningEffort };
    }
  } else {
    // Standard Chat Completions API
    endpoint = "https://api.openai.com/v1/chat/completions";
    requestBody = {
      model: modelToUse,
      messages: [{ role: "user", content: prompt }],
      stream: true
    };
    
    if (supportsTemperature(modelToUse)) {
      requestBody.temperature = 0.1;
    }
    
    // Add reasoning_effort for GPT-5.x models (except GPT-5.2 Pro which uses Responses API)
    const reasoningEffort = getReasoningEffort(modelToUse, thinkingEnabled);
    if (reasoningEffort) {
      requestBody.reasoning_effort = reasoningEffort;
    }
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
  
  if (useResponsesApi) {
    // Responses API returns a complete response (non-streaming)
    console.log("OpenAI Responses API: parsing complete response");
    const data = await response.json();
    
    try {
      // Parse Responses API response format
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
      
      // Fallback: try direct output_text property
      if (!textContent && data.output_text) {
        textContent = data.output_text;
      }
      
      if (textContent) {
        // Send the complete content as chunks to maintain compatibility with streaming UI
        port.postMessage({ 
          type: "STREAM_CHUNK", 
          chunk: textContent,
        });
        if (updateCallback) updateCallback(textContent);
        console.log("OpenAI Responses API: sent complete response");
      } else {
        console.error("OpenAI Responses API: could not extract text from response", data);
        throw new Error("Could not extract text from Responses API response");
      }
    } catch (e) {
      console.error("Error parsing Responses API response:", e);
      throw new Error(`Error parsing Responses API response: ${e.message}`);
    }
  } else {
    // Standard Chat Completions API streaming
    console.log("OpenAI stream connected, reading data (tagged format)");
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let chunkCount = 0;
    
    try {
      while (true) {
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
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.choices && data.choices[0].delta && data.choices[0].delta.content) {
                const newContent = data.choices[0].delta.content;
                // Send raw delta content directly to content script
                port.postMessage({ 
                  type: "STREAM_CHUNK", 
                  chunk: newContent,
                });
                if (updateCallback) updateCallback(newContent);
                chunkCount++;
              }
            } catch (e) {
              console.error("Error parsing OpenAI stream line:", e, "Line:", line);
            }
          } else if (line === "data: [DONE]") {
            console.log("OpenAI stream [DONE] marker received");
          }
        }
      }
      
      console.log("OpenAI streaming finished from provider function, total chunks:", chunkCount);
    } finally {
      reader.releaseLock();
    }
  }
}

async function fetchFromAnthropic(prompt, model, apiKey) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  
  // Determine the appropriate max_tokens based on the model
  let maxTokens = 4096; // Default for most Claude models
  
  // For Claude 4.5 models, use higher limits
  if (model && (model.includes("claude-sonnet-4-5") || model.includes("claude-opus-4-5") || model.includes("claude-haiku-4-5"))) {
    maxTokens = 8192; // Claude 4.5 models support up to 8192 tokens
  } else if (model && model.includes("claude-3-7-sonnet")) {
    maxTokens = 64000;
  } else if (model && (model.includes("claude-3-5-sonnet") || model.includes("claude-3-5-haiku"))) {
    maxTokens = 8192;
  }
  
  // Make sure the model name matches one of the valid formats Anthropic accepts
  const modelToUse = model || "claude-sonnet-4-5";
  console.log("Using Anthropic model:", modelToUse);
  
  const endpoint = "https://api.anthropic.com/v1/messages";
  const requestBody = {
    model: modelToUse,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens
  };
  
  // Only add temperature if the model supports it
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

async function fetchFromAnthropicStreaming(prompt, model, apiKey, port, updateCallback) {
  if (!apiKey) throw new Error("Anthropic API key is required");
  
  console.log("Starting Anthropic streaming request with new tagged format handling");
  
  let maxTokens = 4096;
  // For Claude 4.5 models, use higher limits
  if (model && (model.includes("claude-sonnet-4-5") || model.includes("claude-opus-4-5") || model.includes("claude-haiku-4-5"))) {
    maxTokens = 8192;
  } else if (model && model.includes("claude-3-7-sonnet")) {
    maxTokens = 64000;
  } else if (model && (model.includes("claude-3-5-sonnet") || model.includes("claude-3-5-haiku"))) {
    maxTokens = 8192;
  }
  
  const modelToUse = model || "claude-sonnet-4-5"; // Ensure this is updated with Anthropic's latest recommendations
  console.log("Using Anthropic model:", modelToUse);
  
  const endpoint = "https://api.anthropic.com/v1/messages";
  const requestBody = {
    model: modelToUse,
    messages: [{ role: "user", content: prompt }],
    max_tokens: maxTokens,
    stream: true
  };
  if (supportsTemperature(model)) {
    requestBody.temperature = 0.1; // Or from settings
  }
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01", // Check for latest recommended version
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(requestBody)
    });
    
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
          if (line.trim() && line.startsWith("data:")) {
            try {
              const cleanedLine = line.substring(5).trim();
              if (cleanedLine) {
                const data = JSON.parse(cleanedLine);
                let newText = "";
                
                if (data.type === "content_block_delta" && data.delta && data.delta.text) {
                  newText = data.delta.text;
                } else if (data.type === "message_delta" && data.delta && data.delta.text) { // Newer format for some models
                  newText = data.delta.text;
                } else if (data.type === "content_block_start" && data.content_block && data.content_block.text) {
                  newText = data.content_block.text; // Older format
                }
                
                if (newText) {
                  // Send raw delta content directly
                  port.postMessage({ 
                    type: "STREAM_CHUNK", 
                    chunk: newText 
                  });
                  if (updateCallback) updateCallback(newText);
                  chunkCount++;
                }
              }
            } catch (e) {
              console.error("Error parsing Anthropic stream line:", e, "Line:", line);
            }
          }
        }
      }
      console.log("Anthropic streaming finished from provider function, total chunks:", chunkCount);
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    console.error("Anthropic API error with model:", modelToUse, error);
    throw new Error(`Anthropic API error: ${error.message}`);
  }
}

async function fetchFromGemini(prompt, model, apiKey) {
  if (!apiKey) throw new Error("Google Gemini API key is required");
  
  // Determine which model ID to use
  let modelId = model || "gemini-1.5-pro";
  
  // The API endpoint - fixed domain from generativeai to generativelanguage
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
  
  // Create the request body
  const requestBody = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {}
  };
  
  // Only add temperature if the model supports it
  if (supportsTemperature(model)) {
    requestBody.generationConfig.temperature = 0.1;
  }
  
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const error = await response.json().catch(() => null);
      throw new Error(error?.error?.message || `Gemini API error: ${response.status}`);
    }
    
    const data = await response.json();
    try {
      return data.candidates[0].content.parts[0].text;
    } catch (e) {
      console.error("Unexpected Gemini response format:", data);
      throw new Error("Unexpected Gemini response format");
    }
  } catch (error) {
    console.error(`Error with Gemini model ${modelId}:`, error);
    throw error;
  }
}

// Utility function to add a timeout to any async function
async function asyncWithTimeout(asyncFunction, timeoutMs) {
  return new Promise(async (resolve, reject) => {
    // Set up the timeout
    const timeoutId = setTimeout(() => {
      reject(new Error(`Operation timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    try {
      // Call the async function
      const result = await asyncFunction();
      clearTimeout(timeoutId);
      resolve(result);
    } catch (error) {
      clearTimeout(timeoutId);
      reject(error);
    }
  });
}

async function fetchFromGeminiStreaming(prompt, model, apiKey, port, updateCallback, settings = {}) {
  if (!apiKey) throw new Error("Google Gemini API key is required");
  
  console.log("Starting Gemini streaming request with new tagged format handling (revised parsing)");
  let modelId = model || "gemini-1.5-pro";
  const thinkingEnabled = settings.geminiThinkingEnabled === true;
  console.log(`Using Gemini model: ${modelId}, thinkingEnabled: ${thinkingEnabled}`);
  
  const heartbeatInterval = setInterval(() => {
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
    
    // Add temperature if supported
    if (supportsTemperature(modelId)) {
      generationConfig.temperature = 0.1;
    }
    
    // Add thinkingConfig for models that support it
    if (supportsGeminiThinking(modelId)) {
      const thinkingConfig = {};
      if (isGemini3Model(modelId)) {
        // Gemini 3.x uses thinkingLevel: "low" or "high"
        thinkingConfig.thinkingLevel = thinkingEnabled ? "high" : "low";
      } else {
        // Gemini 2.5 uses thinkingBudget: 0 (disabled) or -1 (dynamic/enabled)
        thinkingConfig.thinkingBudget = thinkingEnabled ? -1 : 0;
      }
      generationConfig.thinkingConfig = thinkingConfig;
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
    const fetchPromise = fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    
    const response = await Promise.race([fetchPromise, timeoutPromise]);
    console.log("Gemini: Response received, status:", response.status);

    if (!response.ok) {
      let errorText = `Gemini API error: ${response.status}`;
      try {
        const errorData = await response.text(); // Try to get raw text first
        console.error("Gemini API raw error response text:", errorData);
        try {
            const parsedError = JSON.parse(errorData); // Try to parse it as JSON
            if (parsedError && parsedError.error && parsedError.error.message) {
                errorText = parsedError.error.message;
            }
        } catch (jsonParseError) {
            // If not JSON, use a snippet of the raw text if available
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
        const { done, value } = await reader.read();
        if (done) {
          console.log("Gemini: Stream reader marked done.");
          if (buffer.trim().length > 0) {
             // The new parsing loop below should ideally consume everything.
             // If anything is left here, it's likely genuinely unparseable.
             console.warn("Gemini: Stream done, but non-empty buffer remains after main parsing loop:", buffer);
          }
          if (!streamContentReceived) { console.warn("Gemini: Stream ended but no content was ever pushed."); }
          break;
        }

        streamContentReceived = true;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // New robust JSON parsing loop
        while (buffer.length > 0) {
          // 1. Pre-processing: Trim whitespace and leading commas.
          let originalBufferBeforeTrim = buffer;
          buffer = buffer.trimStart();
          if (buffer.startsWith(',')) {
            buffer = buffer.substring(1).trimStart();
          }

          // If trimming removed the entire buffer or made it empty, break to get more data.
          if (buffer.length === 0) {
            if (originalBufferBeforeTrim.length > 0) continue; // Buffer had content, was trimmed to empty, get more.
            else break; // Buffer was already empty or became empty, need more data.
          }
          
          jsonStart = buffer.indexOf('{');

          if (jsonStart === -1) {
            break; // Need more data from reader to form a JSON.
          }

          // If there's content before the first '{', discard it.
          if (jsonStart > 0) {
            buffer = buffer.substring(jsonStart);
          }

          openBraces = 0;
          let jsonEnd = -1;

          for (let i = 0; i < buffer.length; i++) {
            if (buffer[i] === '{') {
              openBraces++;
            } else if (buffer[i] === '}') {
              openBraces--;
              if (openBraces === 0) {
                jsonEnd = i;
                break;
              }
            }
          }

          if (jsonEnd !== -1) { // Found a potential complete JSON object
            const potentialMultiObjStr = buffer.substring(0, jsonEnd + 1);
            let processedOrDiscarded = false;

            try {
              // First attempt: parse the whole segment identified by naive brace counting
              const data = JSON.parse(potentialMultiObjStr);
              
              // If successful, potentialMultiObjStr was a single valid JSON object
              if (updateCallback) updateCallback(potentialMultiObjStr); // Log raw JSON for debug
              if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
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
                                  port.postMessage({ type: "STREAM_CHUNK", chunk: finalChunk });
                                  chunkCount++;
                                  successfullyProcessedInnerJson = true;
                                }
                              }
                            }
                          }
                          if (successfullyProcessedInnerJson) {
                             lastChunkTime = Date.now();
                             // This part.text was fully processed as an inner array, skip literal sending for this part
                             continue; 
                          }
                        }
                      } catch (e_inner) {
                        // console.warn("Gemini: Failed to parse text part as inner JSON array, treating as literal:", textValue, e_inner.message);
                      }
                    }
                    port.postMessage({ type: "STREAM_CHUNK", chunk: textValue });
                    chunkCount++;
                    lastChunkTime = Date.now();
                  }
                }
              } else if (data.candidates && data.candidates[0] && data.candidates[0].finishReason) {
                let fm = `Stream ended by Gemini: ${data.candidates[0].finishReason}`;
                if (data.candidates[0].finishReason === "SAFETY") fm = "Content blocked: SAFETY";
                const statusChunk = `<ugt_status_gemini>[${fm}]</ugt_status_gemini>`;
                port.postMessage({ type: "STREAM_CHUNK", chunk: statusChunk });
                chunkCount++; lastChunkTime = Date.now();
              } else if (data.error) {
                console.error("Gemini explicit error in stream data object:", data.error);
                const errorChunk = `<ugt_status_gemini>[Error: ${data.error.message || 'Unknown Gemini error'}]</ugt_status_gemini>`;
                port.postMessage({ type: "STREAM_CHUNK", chunk: errorChunk });
                chunkCount++; lastChunkTime = Date.now();
              }

              buffer = buffer.substring(jsonEnd + 1); // Consume the whole segment
              processedOrDiscarded = true;

            } catch (e) {
              if (e.message && e.message.includes("Unexpected non-whitespace character after JSON at position")) {
                const match = e.message.match(/position (\d+)/);
                if (match && match[1]) {
                  const position = parseInt(match[1], 10);
                  const singleObjStr = potentialMultiObjStr.substring(0, position);
                  try {
                    const data = JSON.parse(singleObjStr);
                    // Successfully parsed the first object from the multi-object string
                    if (updateCallback) updateCallback(singleObjStr); // Log raw JSON for debug
                    if (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) {
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
                                        port.postMessage({ type: "STREAM_CHUNK", chunk: finalChunk });
                                        chunkCount++;
                                        successfullyProcessedInnerJson = true;
                                      }
                                    }
                                  }
                                }
                                if (successfullyProcessedInnerJson) {
                                   lastChunkTime = Date.now();
                                   continue; 
                                }
                              }
                            } catch (e_inner_recovery) {
                              // console.warn("Gemini (recovery): Failed to parse text part as inner JSON array:", textValue, e_inner_recovery.message);
                            }
                          }
                          port.postMessage({ type: "STREAM_CHUNK", chunk: textValue });
                          chunkCount++;
                          lastChunkTime = Date.now();
                        }
                      }
                    } else if (data.candidates && data.candidates[0] && data.candidates[0].finishReason) {
                      let fm = `Stream ended by Gemini: ${data.candidates[0].finishReason}`;
                      if (data.candidates[0].finishReason === "SAFETY") fm = "Content blocked: SAFETY";
                      const statusChunk = `<ugt_status_gemini>[${fm}]</ugt_status_gemini>`;
                      port.postMessage({ type: "STREAM_CHUNK", chunk: statusChunk });
                      chunkCount++; lastChunkTime = Date.now();
                    } else if (data.error) {
                      console.error("Gemini explicit error in stream data object (recovery):", data.error);
                      const errorChunk = `<ugt_status_gemini>[Error: ${data.error.message || 'Unknown Gemini error'}]</ugt_status_gemini>`;
                      port.postMessage({ type: "STREAM_CHUNK", chunk: errorChunk });
                      chunkCount++; lastChunkTime = Date.now();
                    }

                    buffer = buffer.substring(position); // Consume only the parsed single object
                    processedOrDiscarded = true;
                  } catch (e2) {
                    console.error("Gemini: Failed to parse even the substring after 'Unexpected char' error. Discarding segment:", singleObjStr, e2.message);
                    buffer = buffer.substring(jsonEnd + 1); // Discard the original problematic segment
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
                // This case should ideally not be reached if the logic above is exhaustive.
                // As a fallback to prevent infinite loops if jsonEnd was valid but no processing path was taken.
                console.warn("Gemini: Segment identified by jsonEnd was not processed or discarded. Fallback: Discarding.", buffer.substring(0, jsonEnd + 1));
                buffer = buffer.substring(jsonEnd + 1);
            }

            jsonStart = -1; 
            openBraces = 0; 
            // Continue the while(buffer.length > 0) loop to process rest of current buffer
          } else {
            // No complete JSON object found in current buffer, need more data from reader.
            break; 
          }
        } // end while (buffer.length > 0) - inner parsing loop for current buffer contents

        // Content heartbeat for long gaps between actual content chunks from Gemini
        const now = Date.now();
        if (now - lastChunkTime > 15000 && streamContentReceived) { 
            port.postMessage({ type: "HEARTBEAT_PROVIDER", provider: "Gemini", sub_type: "content_gap" });
            lastChunkTime = now;
        }

      } // end while(true) reader loop
      console.log("Gemini streaming finished from provider function, total chunks processed:", chunkCount);

    } finally {
      reader.releaseLock();
      console.log("Gemini: Reader lock released.");
    }
    
  } catch (error) {
    console.error(`Gemini Streaming Main Catch Block Error (${modelId}):`, error.message, error);
    throw error; // Re-throw for fetchTranslationStreaming to handle
  } finally {
    clearInterval(heartbeatInterval);
    console.log("Gemini: Heartbeat interval cleared.");
  }
}

// Helper function to use non-streaming API as fallback IS NO LONGER DIRECTLY CALLED HERE / TO BE REWORKED OR REMOVED
// async function fallbackToNonStreaming(prompt, modelId, apiKey, port) { ... }

// ElevenLabs TTS API function
async function fetchFromElevenLabs(text, voiceId, apiKey, modelId = "eleven_multilingual_v2") {
  if (!apiKey) throw new Error("ElevenLabs API key is required");
  if (!voiceId) throw new Error("Voice ID is required");
  
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;
  
  const requestBody = {
    text: text,
    model_id: modelId,
    voice_settings: {
      stability: 0.5,
      similarity_boost: 0.75
    }
  };
  
  console.log(`ElevenLabs TTS request: voice=${voiceId}, model=${modelId}, text length=${text.length}`);
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": apiKey
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    let errorMessage = `ElevenLabs API error: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.detail && errorData.detail.message) {
        errorMessage = errorData.detail.message;
      } else if (errorData.detail) {
        errorMessage = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
      }
    } catch (e) {
      // Couldn't parse error response
    }
    throw new Error(errorMessage);
  }
  
  // Get audio data as ArrayBuffer
  const audioBuffer = await response.arrayBuffer();
  
  // Convert to base64 for sending to content script
  const base64Audio = arrayBufferToBase64(audioBuffer);
  
  console.log(`ElevenLabs TTS response: audio size=${audioBuffer.byteLength} bytes`);
  
  return base64Audio;
}

// Helper function to convert ArrayBuffer to base64
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Google Cloud Text-to-Speech API function
async function fetchFromGoogleTTS(text, voiceId, apiKey, speakingRate = 1.0, pitch = 0) {
  if (!apiKey) throw new Error("Google Cloud API key is required");
  if (!voiceId) throw new Error("Voice ID is required");
  
  // Parse voice ID to get language code and voice name
  // Voice IDs are formatted like "en-US-Studio-O" or "en-US-Neural2-A"
  const parts = voiceId.split('-');
  let languageCode, voiceName;
  
  if (parts.length >= 3) {
    languageCode = parts.slice(0, 2).join('-'); // e.g., "en-US" or "cmn-CN"
    voiceName = voiceId; // Full voice ID is used as the voice name
  } else {
    throw new Error("Invalid voice ID format");
  }
  
  // Check if voice type supports pitch parameter
  // Studio and Journey voices do NOT support pitch
  const voiceType = voiceId.toLowerCase();
  const supportsPitch = !voiceType.includes('studio') && !voiceType.includes('journey');
  
  const endpoint = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`;
  
  const audioConfig = {
    audioEncoding: "MP3",
    speakingRate: speakingRate
  };
  
  // Only add pitch if the voice type supports it
  if (supportsPitch && pitch !== 0) {
    audioConfig.pitch = pitch;
  }
  
  const requestBody = {
    input: {
      text: text
    },
    voice: {
      languageCode: languageCode,
      name: voiceName
    },
    audioConfig: audioConfig
  };
  
  console.log(`Google TTS request: voice=${voiceName}, lang=${languageCode}, rate=${speakingRate}`);
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });
  
  if (!response.ok) {
    let errorMessage = `Google TTS API error: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.error && errorData.error.message) {
        errorMessage = errorData.error.message;
      }
    } catch (e) {
      // Couldn't parse error response
    }
    throw new Error(errorMessage);
  }
  
  const data = await response.json();
  
  // Google TTS returns audio content as base64-encoded string
  if (!data.audioContent) {
    throw new Error("No audio content in response");
  }
  
  console.log(`Google TTS response: received audio content`);
  
  return data.audioContent;
}

// Open options page when the browser action is clicked
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});