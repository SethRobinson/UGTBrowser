// options.js

document.addEventListener('DOMContentLoaded', initializeOptionsPage);

// --- DOM Element References ---
const providerSelect = document.getElementById('providerSelect');
const modelSelect = document.getElementById('modelSelect');
const customModelInput = document.getElementById('customModel');

const openAIApiKeyInput = document.getElementById('openaiApiKey');
const anthropicApiKeyInput = document.getElementById('anthropicApiKey');
const geminiApiKeyInput = document.getElementById('geminiApiKey');

const openaiKeyWrapper = document.getElementById('openaiKeyWrapper');
const anthropicKeyWrapper = document.getElementById('anthropicKeyWrapper');
const geminiKeyWrapper = document.getElementById('geminiKeyWrapper');

const openaiApiKeyHelp = document.getElementById('openaiApiKeyHelp');
const anthropicApiKeyHelp = document.getElementById('anthropicApiKeyHelp');
const geminiApiKeyHelp = document.getElementById('geminiApiKeyHelp');

const promptTemplateTextarea = document.getElementById('promptTemplate');
const statusDiv = document.getElementById('status');

// Language mode elements
const languageModeRadios = document.querySelectorAll('input[name="languageMode"]');
const standardLanguageSection = document.getElementById('standardLanguageSection');
const customLanguageSection = document.getElementById('customLanguageSection');
const languageSelect = document.getElementById('language'); // Used for standard language
const customLanguageInput = document.getElementById('customLanguage');

const toggleDebugBtn = document.getElementById('toggleDebugBtn');
const llmDebugContent = document.getElementById('llmDebugContent');
const refreshLLMDataBtn = document.getElementById('refreshLLMDataBtn');
const saveBtn = document.getElementById('saveBtn');
const resetPromptBtn = document.getElementById('resetPromptBtn');

// --- Configuration Data ---
const noTemperatureModels = [
  "o3", "o4-mini", "gemini-1.5-pro", "gemini-1.5-flash", 
  "gemini-2.0-flash", "gemini-2.5-pro", "gemini-2.5-flash",
  "gemini-2.5-pro-preview-05-06"
];

const providerModels = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3", "o4-mini"],
  anthropic: ["claude-3-7-sonnet-latest", "claude-3-5-sonnet-latest", "claude-3-5-haiku-latest"],
  gemini: ["gemini-2.0-flash", "gemini-2.5-pro-preview-05-06", "gemini-2.5-flash-preview-04-17", "gemini-1.5-pro", "gemini-1.5-flash"]
};

const defaultPrompts = {
  openai: (
    'Translate each of the following text segments to {{target}}.\\n' +
    'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\\n' +
    'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\\n' +
    'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\\n' +
    'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\\n' +
    'Output ONLY the tagged translations. No extra explanations, comments, or unrelated text.\\n\\n' +
    'Segments to translate:\\n' +
    '{{text}}'
  ),
  anthropic: ( // Assuming same default prompt structure for Anthropic
    'Translate each of the following text segments to {{target}}.\\n' +
    'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\\n' +
    'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\\n' +
    'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\\n' +
    'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\\n' +
    'Output ONLY the tagged translations. No extra explanations, comments, or unrelated text.\\n\\n' +
    'Segments to translate:\\n' +
    '{{text}}'
  ),
  gemini: ( // Assuming same default prompt structure for Gemini
    'Translate each of the following text segments to {{target}}.\\n' +
    'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\\n' +
    'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\\n' +
    'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\\n' +
    'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\\n' +
    'Output ONLY the tagged translations. No extra explanations, comments, or unrelated text.\\n\\n' +
    'Segments to translate:\\n' +
    '{{text}}'
  )
};

// --- Initialization ---
function initializeOptionsPage() {
  // Setup event listeners
  providerSelect.addEventListener('change', () => {
    updateProviderFields();
    updateModelOptions(); // Also update models when provider changes
  });
  modelSelect.addEventListener('change', updateCustomModelVisibility);
  saveBtn.addEventListener('click', saveOptions);
  resetPromptBtn.addEventListener('click', resetPromptToDefault);
  
  if (refreshLLMDataBtn) {
    refreshLLMDataBtn.addEventListener('click', fetchLastLLMData);
  }

  if (toggleDebugBtn && llmDebugContent) {
    toggleDebugBtn.addEventListener('click', () => {
      const isHidden = llmDebugContent.style.display === 'none' || !llmDebugContent.style.display;
      llmDebugContent.style.display = isHidden ? 'block' : 'none';
      toggleDebugBtn.textContent = isHidden ? 'Hide Debug Info' : 'Show Debug Info';
      if (isHidden && typeof fetchLastLLMData === 'function') fetchLastLLMData();
    });
  }

  languageModeRadios.forEach(radio => {
    radio.addEventListener('change', updateLanguageSectionState);
  });

  restoreOptions(); // Load saved settings
}

// --- Core Functions ---
function restoreOptions() {
  chrome.storage.sync.get(
    { // Defaults
      selectedProvider: 'openai',
      openaiApiKey: '',
      anthropicApiKey: '',
      geminiApiKey: '',
      model: '', 
      customModel: '',
      // Provider-specific prompts will be handled by checking for `${provider}Prompt`
      languageMode: 'standard',
      targetLanguage: 'en', // This refers to the standard language dropdown value
      customLanguage: '',
      // LLM Debug defaults (though these are usually just read)
      lastRequestInfo: null,
      lastRequestPrompt: null,
      lastResponseInfo: null,
      lastResponseContent: null
    },
    (items) => {
      providerSelect.value = items.selectedProvider || 'openai';
      
      openAIApiKeyInput.value = items.openaiApiKey || '';
      anthropicApiKeyInput.value = items.anthropicApiKey || '';
      geminiApiKeyInput.value = items.geminiApiKey || '';
      
      customModelInput.value = items.customModel || '';

      // Restore language mode and values
      const currentLanguageMode = items.languageMode || 'standard';
      document.querySelector(`input[name="languageMode"][value="${currentLanguageMode}"]`).checked = true;
      languageSelect.value = items.targetLanguage || 'en'; // For standard mode
      customLanguageInput.value = items.customLanguage || ''; // For custom mode
      
      updateProviderFields(); // Updates API key visibility, model dropdowns
      updateModelOptions(items.model || providerModels[items.selectedProvider]?.[0], items.customModel); // Sets selected model
      updateLanguageSectionState(); // Sets initial state of language sections (enabled/disabled)

      // Load prompt for the current provider
      const promptKey = `${items.selectedProvider}Prompt`;
      promptTemplateTextarea.value = items[promptKey] || defaultPrompts[items.selectedProvider];
      
      fetchLastLLMData(); // Load last LLM debug data
    }
  );
}

function saveOptions() {
  const provider = providerSelect.value;
  const selectedModelValue = modelSelect.value;
  const customModelValue = customModelInput.value.trim();
  
  let finalModel = selectedModelValue;
  if (customModelValue && (selectedModelValue === '' || providerModels[provider].length === 0 || !providerModels[provider].includes(selectedModelValue))) {
    finalModel = customModelValue;
  }
  
  const openaiApiKey = openAIApiKeyInput.value.trim();
  const anthropicApiKey = anthropicApiKeyInput.value.trim();
  const geminiApiKey = geminiApiKeyInput.value.trim();
  
  const currentPromptTemplate = promptTemplateTextarea.value;
  const languageMode = document.querySelector('input[name="languageMode"]:checked').value;
  const standardLanguage = languageSelect.value;
  const customLangText = customLanguageInput.value.trim();

  const settingsToSave = {
    selectedProvider: provider,
    model: finalModel,
    customModel: customModelValue, // Always save what's in custom input for reference
    openaiApiKey: openaiApiKey,
    anthropicApiKey: anthropicApiKey,
    geminiApiKey: geminiApiKey,
    [`${provider}Prompt`]: currentPromptTemplate, // Provider-specific prompt
    supportsTemperature: supportsTemperature(finalModel),
    languageMode: languageMode,
    targetLanguage: standardLanguage, // Save standard language selection
    customLanguage: customLangText,  // Save custom language text
    // Old generic settings for potential backward compatibility or direct use by background script
    // These might be redundant if background script is updated to use new specific fields
    settings: { 
      provider: provider, 
      model: finalModel, 
      apiKey: provider === 'openai' ? openaiApiKey : (provider === 'anthropic' ? anthropicApiKey : geminiApiKey),
      promptTemplate: currentPromptTemplate, // Generic prompt for background
      targetLang: languageMode === 'custom' ? customLangText : standardLanguage, // Effective target language
      streaming: true 
    }
  };
  
  chrome.storage.sync.set(settingsToSave, () => {
    statusDiv.textContent = 'Settings saved.';
    statusDiv.style.color = 'green'; // Or use a class for styling
    statusDiv.classList.add('visible');
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.classList.remove('visible');
    }, 2000);
  });
}

// --- UI Update Functions ---
function updateProviderFields() {
  const provider = providerSelect.value;

  // Hide all API key sections and help texts first
  [openaiKeyWrapper, anthropicKeyWrapper, geminiKeyWrapper].forEach(w => w.style.display = 'none');
  [openaiApiKeyHelp, anthropicApiKeyHelp, geminiApiKeyHelp].forEach(h => h.style.display = 'none');

  // Show relevant API key section and help text
  if (provider === 'openai') {
    openaiKeyWrapper.style.display = 'block';
    if (openaiApiKeyHelp) openaiApiKeyHelp.style.display = 'block';
  } else if (provider === 'anthropic') {
    anthropicKeyWrapper.style.display = 'block';
    if (anthropicApiKeyHelp) anthropicApiKeyHelp.style.display = 'block';
  } else if (provider === 'gemini') {
    geminiKeyWrapper.style.display = 'block';
    if (geminiApiKeyHelp) geminiApiKeyHelp.style.display = 'block';
  }
  
  // Load the prompt template for this provider if not already set by restoreOptions
  chrome.storage.sync.get([`${provider}Prompt`], (data) => {
    promptTemplateTextarea.value = data[`${provider}Prompt`] || defaultPrompts[provider];
  });
}

function updateModelOptions(currentModel = null, currentCustomModel = null) {
  const provider = providerSelect.value;
  modelSelect.innerHTML = ''; // Clear existing options

  const models = providerModels[provider] || [];
  models.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelSelect.appendChild(opt);
  });

  if (currentModel && models.includes(currentModel)) {
    modelSelect.value = currentModel;
  } else if (currentCustomModel || (currentModel && !models.includes(currentModel))) {
     // If there was a custom model saved, or the saved model isn't in the list,
     // try to set customModelInput. The modelSelect might remain on its first option.
    customModelInput.value = currentCustomModel || currentModel || '';
  } else if (models.length > 0) {
    modelSelect.value = models[0]; // Default to first model in list if no specific selection
  }
  
  updateCustomModelVisibility();
}

function updateCustomModelVisibility() {
  const provider = providerSelect.value;
  // Show custom model input if no standard models for provider, or if modelSelect is somehow empty,
  // or to allow overriding if the user has typed something.
  // A common pattern is to show it if a "custom" option is selected in modelSelect,
  // but here we'll keep it simple: show if no models, or always allow for custom entry.
  const modelsAvailable = providerModels[provider] && providerModels[provider].length > 0;
  if (!modelsAvailable) {
    customModelInput.style.display = 'block';
    modelSelect.style.display = 'none';
  } else {
    customModelInput.style.display = 'block'; // Or 'none' if you only want it when no standard models
    modelSelect.style.display = 'block';
  }
}

function updateLanguageSectionState() {
  const selectedMode = document.querySelector('input[name="languageMode"]:checked').value;
  if (selectedMode === 'standard') {
    standardLanguageSection.classList.remove('disabled-section');
    languageSelect.disabled = false;
    customLanguageSection.classList.add('disabled-section');
    customLanguageInput.disabled = true;
  } else { // custom mode
    customLanguageSection.classList.remove('disabled-section');
    customLanguageInput.disabled = false;
    standardLanguageSection.classList.add('disabled-section');
    languageSelect.disabled = true;
  }
}

function resetPromptToDefault() {
  const provider = providerSelect.value;
  promptTemplateTextarea.value = defaultPrompts[provider];
}

function supportsTemperature(model) {
  return !noTemperatureModels.includes(model);
}

// --- LLM Debug Functions ---
function fetchLastLLMData() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: "GET_LAST_LLM_DATA" }, (data) => {
      if (chrome.runtime.lastError) {
        console.warn("Error fetching LLM data:", chrome.runtime.lastError.message);
        updateLLMDebugUI(null, null); // Clear or indicate error
        return;
      }
      if (data) {
        updateLLMDebugUI(data.lastRequest, data.lastResponse);
      } else {
        updateLLMDebugUI(null, null); // No data received
      }
    });
  } else {
    console.warn("chrome.runtime.sendMessage not available. LLM Debug data cannot be fetched.");
    updateLLMDebugUI(null, null); // Indicate unavailability
  }
}

function updateLLMDebugUI(lastRequest, lastResponse) {
  const requestInfoElement = document.getElementById('lastRequestInfo');
  const requestPromptElement = document.getElementById('lastRequestPrompt');
  const responseInfoElement = document.getElementById('lastResponseInfo');
  const responseContentElement = document.getElementById('lastResponseContent');

  if (requestInfoElement && requestPromptElement) {
    if (lastRequest) {
      const { timestamp, provider, model, streaming } = lastRequest;
      requestInfoElement.textContent = `${new Date(timestamp).toLocaleString()} | Provider: ${provider} | Model: ${model} | Streaming: ${streaming ? 'Yes' : 'No'}`;
      requestPromptElement.value = lastRequest.prompt || "No prompt data available";
    } else {
      requestInfoElement.textContent = "No request data available";
      requestPromptElement.value = "";
    }
  }

  if (responseInfoElement && responseContentElement) {
    if (lastResponse) {
      const { timestamp, provider, model, streaming, error } = lastResponse;
      if (error) {
        responseInfoElement.textContent = `${new Date(timestamp).toLocaleString()} | Provider: ${provider} | Model: ${model} | ERROR`;
        responseContentElement.value = error;
      } else {
        responseInfoElement.textContent = `${new Date(timestamp).toLocaleString()} | Provider: ${provider} | Model: ${model} | Streaming: ${streaming ? 'Yes' : 'No'}`;
        responseContentElement.value = lastResponse.response || "No response data available";
      }
    } else {
      responseInfoElement.textContent = "No response data available";
      responseContentElement.value = "";
    }
  }
} 