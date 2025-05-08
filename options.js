// options.js

document.addEventListener("DOMContentLoaded", restoreOptions);
document.getElementById("providerSelect").addEventListener("change", updateProviderFields);
document.getElementById("saveBtn").addEventListener("click", saveOptions);
document.getElementById("resetPromptBtn").addEventListener("click", resetPromptToDefault);
document.getElementById("refreshLLMDataBtn").addEventListener("click", fetchLastLLMData);

// Event listener for the LLM Debug toggle button
const toggleDebugBtn = document.getElementById("toggleDebugBtn");
const llmDebugContent = document.getElementById("llmDebugContent");

if (toggleDebugBtn && llmDebugContent) {
  toggleDebugBtn.addEventListener("click", () => {
    if (llmDebugContent.style.display === "none") {
      llmDebugContent.style.display = "block";
      toggleDebugBtn.textContent = "Hide Debug Info";
      // Optionally, refresh data when shown:
      // if (typeof fetchLastLLMData === 'function') fetchLastLLMData();
    } else {
      llmDebugContent.style.display = "none";
      toggleDebugBtn.textContent = "Show Debug Info";
    }
  });
}

// Models that don't support temperature settings
const noTemperatureModels = [
  "o3",
  "o4-mini",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-2.0-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-pro-preview-05-06"
];

const providerModels = {
  openai: [
    "gpt-4o-mini",
    "gpt-4o",
    "gpt-4-turbo",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "o3",
    "o4-mini"
  ],
  anthropic: [
    "claude-3-7-sonnet-latest",
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
  ],
  gemini: [
    "gemini-2.0-flash",
    "gemini-2.5-pro-preview-05-06",
    "gemini-2.5-flash-preview-04-17",
    "gemini-1.5-pro",
    "gemini-1.5-flash"
  ]
};

// Default prompt templates for each provider
const defaultPrompts = {
  openai: (
    'Translate each of the following text segments to {{target}}.\n'
    + 'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\n'
    + 'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\n'
    + 'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\n'
    + 'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\n'
    + 'Output ONLY the tagged translations. No extra explanations, comments, or unrelated text.\n\n'
    + 'Segments to translate:\n'
    + '{{text}}'
  ),
  
  anthropic: (
    'Translate each of the following text segments to {{target}}.\n'
    + 'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\n'
    + 'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\n'
    + 'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\n'
    + 'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\n'
    + 'Output ONLY the tagged translations. No extra explanations, comments, or unrelated text.\n\n'
    + 'Segments to translate:\n'
    + '{{text}}'
  ),
  
  gemini: (
    'Translate each of the following text segments to {{target}}.\n'
    + 'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\n'
    + 'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\n'
    + 'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\n'
    + 'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\n'
    + 'Output ONLY the tagged translations. No extra explanations, comments, or unrelated text.\n\n'
    + 'Segments to translate:\n'
    + '{{text}}'
  )
};

function restoreOptions() {
  chrome.storage.sync.get(null, (data) => {
    // Get provider from settings
    const settings = data.settings || {};
    const currentProvider = settings.provider || "openai";
    document.getElementById("providerSelect").value = currentProvider;
    
    // Restore model selection
    updateProviderFields();
    if (settings.model) {
      if (providerModels[currentProvider]?.includes(settings.model)) {
        document.getElementById("modelSelect").value = settings.model;
      } else {
        document.getElementById("customModel").value = settings.model;
      }
    }
    
    // Restore API keys for all providers
    document.getElementById("openaiApiKey").value = data.openaiApiKey || "";
    document.getElementById("anthropicApiKey").value = data.anthropicApiKey || "";
    document.getElementById("geminiApiKey").value = data.geminiApiKey || "";
    
    // Restore prompt templates for the current provider
    const promptKey = `${currentProvider}Prompt`;
    document.getElementById("promptTemplate").value = data[promptKey] || defaultPrompts[currentProvider];
    
    // Restore target language
    document.getElementById("targetLang").value = settings.targetLang || "English";

    // Load last LLM data
    fetchLastLLMData();
  });
}

function updateProviderFields() {
  const provider = document.getElementById("providerSelect").value;
  const modelSelect = document.getElementById("modelSelect");
  const customModel = document.getElementById("customModel");
  
  // Hide all API key fields and help texts
  document.getElementById("openaiKeyWrapper").style.display = "none";
  document.getElementById("anthropicKeyWrapper").style.display = "none";
  document.getElementById("geminiKeyWrapper").style.display = "none";
  
  document.getElementById("openaiApiKeyHelp").style.display = "none";
  document.getElementById("anthropicApiKeyHelp").style.display = "none";
  document.getElementById("geminiApiKeyHelp").style.display = "none";
  
  // Show only the relevant API key field and its help text
  document.getElementById(`${provider}KeyWrapper`).style.display = "block";
  const helpTextId = `${provider}ApiKeyHelp`;
  if (document.getElementById(helpTextId)) {
      document.getElementById(helpTextId).style.display = "block";
  }
  
  // Update model dropdown options
  modelSelect.innerHTML = "";
  providerModels[provider].forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    modelSelect.appendChild(opt);
  });

  // Show custom model input only if custom provider is selected or if there are no models
  customModel.style.display = (providerModels[provider].length === 0) ? "block" : "none";
  
  // Load the prompt template for this provider
  chrome.storage.sync.get([`${provider}Prompt`], (data) => {
    const promptKey = `${provider}Prompt`;
    document.getElementById("promptTemplate").value = data[promptKey] || defaultPrompts[provider];
  });
}

// Function to check if a model supports temperature settings
function supportsTemperature(model) {
  return !noTemperatureModels.includes(model);
}

function saveOptions() {
  const provider = document.getElementById("providerSelect").value;
  
  // Get selected model or custom model
  const model = 
    (providerModels[provider].length === 0 && document.getElementById("customModel").value.trim()) || 
    (document.getElementById("modelSelect").value);
  
  // Get API keys and endpoint
  const openaiApiKey = document.getElementById("openaiApiKey").value.trim();
  const anthropicApiKey = document.getElementById("anthropicApiKey").value.trim();
  const geminiApiKey = document.getElementById("geminiApiKey").value.trim();
  
  // Get prompt template and target language
  const promptTemplate = document.getElementById("promptTemplate").value;
  const targetLang = document.getElementById("targetLang").value;
  
  // Get API key for current provider
  const apiKeyMap = {
    openai: openaiApiKey,
    anthropic: anthropicApiKey,
    gemini: geminiApiKey
  };
  
  // Create settings object
  const settings = { 
    provider, 
    model, 
    apiKey: apiKeyMap[provider], // Use current provider's API key
    promptTemplate, // Still store the current template in settings for backward compatibility
    targetLang,
    streaming: true // Always set streaming to true
  };
  
  // Create save data object with all values
  const saveData = {
    settings,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    [`${provider}Prompt`]: promptTemplate, // Store provider-specific prompt
    supportsTemperature: supportsTemperature(model) // Flag to indicate if the model supports temperature
  };
  
  // Save all data
  chrome.storage.sync.set(saveData, () => {
    const status = document.getElementById("status");
    status.textContent = "Settings saved.";
    status.classList.add("visible");
    setTimeout(() => {
      status.classList.remove("visible");
    }, 2000);
  });
}

function resetPromptToDefault() {
  const provider = document.getElementById("providerSelect").value;
  document.getElementById("promptTemplate").value = defaultPrompts[provider];
}

// Function to fetch and display the last LLM request and response
function fetchLastLLMData() {
  chrome.runtime.sendMessage({ type: "GET_LAST_LLM_DATA" }, (data) => {
    const { lastRequest, lastResponse } = data;
    
    // Update request info
    const requestInfoElement = document.getElementById("lastRequestInfo");
    const requestPromptElement = document.getElementById("lastRequestPrompt");
    
    if (lastRequest) {
      const { timestamp, provider, model, streaming } = lastRequest;
      const formattedTime = new Date(timestamp).toLocaleString();
      requestInfoElement.textContent = `${formattedTime} | Provider: ${provider} | Model: ${model} | Streaming: ${streaming ? 'Yes' : 'No'}`;
      requestPromptElement.value = lastRequest.prompt || "No prompt data available";
    } else {
      requestInfoElement.textContent = "No request data available";
      requestPromptElement.value = "";
    }
    
    // Update response info
    const responseInfoElement = document.getElementById("lastResponseInfo");
    const responseContentElement = document.getElementById("lastResponseContent");
    
    if (lastResponse) {
      const { timestamp, provider, model, streaming, error } = lastResponse;
      const formattedTime = new Date(timestamp).toLocaleString();
      
      if (error) {
        responseInfoElement.textContent = `${formattedTime} | Provider: ${provider} | Model: ${model} | ERROR`;
        responseContentElement.value = error;
      } else {
        responseInfoElement.textContent = `${formattedTime} | Provider: ${provider} | Model: ${model} | Streaming: ${streaming ? 'Yes' : 'No'}`;
        responseContentElement.value = lastResponse.response || "No response data available";
      }
    } else {
      responseInfoElement.textContent = "No response data available";
      responseContentElement.value = "";
    }
  });
} 