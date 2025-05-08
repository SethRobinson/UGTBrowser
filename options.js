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
const creativeTaskTextarea = document.getElementById('creativeTaskTextarea');
const mainPromptHelpBtn = document.getElementById('mainPromptHelpBtn');
const creativeTaskHelpBtn = document.getElementById('creativeTaskHelpBtn');
const statusDiv = document.getElementById('status');

// Language mode elements
const languageModeRadios = document.querySelectorAll('input[name="languageMode"]');
const standardLanguageSection = document.getElementById('standardLanguageSection');
const customLanguageSection = document.getElementById('customLanguageSection');
const languageSelect = document.getElementById('language'); // Used for standard language
const customLanguageInput = document.getElementById('customLanguage');
const customHelpSpan = document.getElementById('customHelp'); // Added for modal

const toggleDebugBtn = document.getElementById('toggleDebugBtn');
const llmDebugContent = document.getElementById('llmDebugContent');
const refreshLLMDataBtn = document.getElementById('refreshLLMDataBtn');
const saveBtn = document.getElementById('saveBtn');
const resetPromptBtn = document.getElementById('resetPromptBtn');

// --- Modal Elements ---
const helpModal = document.getElementById('helpModal');
const helpModalTitle = document.getElementById('helpModalTitle');
const helpModalBody = document.getElementById('helpModalBody');
const modalCloseBtn = document.querySelector('.modal-close-btn');

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
    'You have two main tasks for the text segments that follow:\n\n' +
    '1.  **Primary Translation Task:** Translate each segment to {{target}}.\n' +
    '{{creative_task_placeholder}}' +
    '\n**General Instructions for Processing All Segments:**\n' +
    'The following text segments are part of a single document, presented in order. Use the context of preceding segments to inform the translation of subsequent ones.\n' +
    'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\n' +
    'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\n' +
    'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\n' +
    'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\n' +
    'For the translation of individual segments, output ONLY the tagged translations. After all segments are translated and their tagged translations are outputted, then proceed to output the result of the "Creative Addition Task" if one is specified in the initial tasks. Ensure no other extraneous text, preambles, or comments are included in the entire response beyond these two parts (tagged translations and the creative task result).\n\n' +
    'Segments to translate:\n' +
    '{{text}}'
  ),
  anthropic: ( 
    'You have two main tasks for the text segments that follow:\n\n' +
    '1.  **Primary Translation Task:** Translate each segment to {{target}}.\n' +
    '{{creative_task_placeholder}}' +
    '\n**General Instructions for Processing All Segments:**\n' +
    'The following text segments are part of a single document, presented in order. Use the context of preceding segments to inform the translation of subsequent ones.\n' +
    'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\n' +
    'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\n' +
    'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\n' +
    'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\n' +
    'For the translation of individual segments, output ONLY the tagged translations. After all segments are translated and their tagged translations are outputted, then proceed to output the result of the "Creative Addition Task" if one is specified in the initial tasks. Ensure no other extraneous text, preambles, or comments are included in the entire response beyond these two parts (tagged translations and the creative task result).\n\n' +
    'Segments to translate:\n' +
    '{{text}}'
  ),
  gemini: ( 
    'You have two main tasks for the text segments that follow:\n\n' +
    '1.  **Primary Translation Task:** Translate each segment to {{target}}.\n' +
    '{{creative_task_placeholder}}' +
    '\n**General Instructions for Processing All Segments:**\n' +
    'The following text segments are part of a single document, presented in order. Use the context of preceding segments to inform the translation of subsequent ones.\n' +
    'For each segment, use the provided ID and wrap your translation in tags like <ugt_ID>translation</ugt_ID>.\n' +
    'Stream the response, ensuring each tagged segment is complete or progressively built within its tags.\n' +
    'For example, if the input is "<ugt_abc123>Original Text Segment</ugt_abc123>", you should output: "<ugt_abc123>Translated Text Segment</ugt_abc123>"\n' +
    'Preserve all HTML tags, URLs, and code snippets within the translation if they appear in the original segment.\n' +
    'For the translation of individual segments, output ONLY the tagged translations. After all segments are translated and their tagged translations are outputted, then proceed to output the result of the "Creative Addition Task" if one is specified in the initial tasks. Ensure no other extraneous text, preambles, or comments are included in the entire response beyond these two parts (tagged translations and the creative task result).\n\n' +
    'Segments to translate:\n' +
    '{{text}}'
  )
};

// --- Initialization ---
function initializeOptionsPage() {
  // Setup event listeners
  providerSelect.addEventListener('change', () => {
    updateProviderFields();
    updateModelOptions();
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

  // --- Help Modal Logic ---
  const helpContentMap = {
    customHelp: {
      title: "Custom Language Prompt",
      body: "<p>Enter any custom language prompt for the translation target. This allows for creative and flexible translation requests.</p>" +
            "<p><strong>Examples:</strong></p>" +
            "<ul>" +
            "<li>'English, but everyone is talking like a pirate'</li>" +
            "<li>'Piglatin'</li>" +
            "<li>'Japanese, but with furigana on all the kanji'</li>" +
            "<li>'Translate to Spanish, and make it rhyme if possible.'</li>" +
            "</ul>" +
            "<p>Be creative! The LLM will do its best to follow your custom instructions for the target language.</p>"
    },
    creativeTaskHelpBtn: {
      title: "Optional Creative Task",
      body: "<p>Define an optional creative task for the LLM to perform <em>in addition</em> to the primary translation. This task will be incorporated into the main prompt sent to the LLM.</p>" +
            "<p><strong>Examples:</strong></p>" +
            "<ul>" +
            "<li>'Make the translation sound like a pirate.'</li>" +
            "<li>'Summarize the text in one sentence after translating.'</li>" +
            "<li>'Translate to English and also explain any cultural nuances found in the original text.'</li>" +
            "<li>'After translating, list any proper nouns found in the text.'</li>" +
            "</ul>" +
            "<p>If left blank, no additional creative task will be included.</p>"
    },
    mainPromptHelpBtn: {
      title: "Prompt Template Guide",
      body: "<p>The prompt template defines how UGTBrowser instructs the LLM to perform translations. Advanced users can customize this.</p>" +
            "<p><strong>Key Placeholders:</strong></p>" +
            "<ul>" +
            "<li><code>{{text}}</code>: This is where the actual text segments selected for translation will be inserted. The content script typically formats this as multiple lines, each with a unique ID (e.g., <code>&lt;ugt_abc123&gt;Original text line 1&lt;/ugt_abc123&gt;</code>, <code>&lt;ugt_def456&gt;Original text line 2&lt;/ugt_def456&gt;</code>).</li>" +
            "<li><code>{{target}}</code>: This placeholder will be replaced with the target language you've selected (e.g., 'Spanish', 'Japanese', or your custom language prompt).</li>" +
            "<li><code>{{creative_task_placeholder}}</code>: If you've defined an 'Optional Creative Task', it will be formatted and inserted here. If no creative task is set, this placeholder will be replaced with an empty string.</li>" +
            "</ul>" +
            "<p><strong>Crucial Output Format:</strong></p>" +
            "<p>Ensure your prompt clearly instructs the LLM to wrap <strong>each</strong> translated segment in <code>&lt;ugt_ID&gt;translation&lt;/ugt_ID&gt;</code> tags, where 'ID' matches the ID of the corresponding input segment. This is essential for the extension to correctly process and display the translations.</p>" +
            "<p><strong>Example Instruction for LLM:</strong></p>" +
            "<p>'For each segment, use the provided ID and wrap your translation in tags like &lt;ugt_ID&gt;translation&lt;/ugt_ID&gt;. For example, if the input is \"&lt;ugt_abc123&gt;Original Text Segment&lt;/ugt_abc123&gt;\", you should output: \"&lt;ugt_abc123&gt;Translated Text Segment&lt;/ugt_abc123&gt;\".'</p>" +
            "<p>You can also add instructions regarding tone, style, or specific formatting requirements. The default prompts provide good examples of how to structure these instructions.</p>"
    }
  };

  function openHelpModal(contentKey) {
    const content = helpContentMap[contentKey];
    if (content && helpModal && helpModalTitle && helpModalBody) {
      helpModalTitle.textContent = content.title;
      helpModalBody.innerHTML = content.body; // Use innerHTML as content includes HTML tags
      helpModal.style.display = 'block';
    }
  }

  function closeHelpModal() {
    if (helpModal) {
      helpModal.style.display = 'none';
    }
  }

  if (customHelpSpan) {
    customHelpSpan.addEventListener('click', () => openHelpModal('customHelp'));
  }
  if (mainPromptHelpBtn) {
    mainPromptHelpBtn.addEventListener('click', () => openHelpModal('mainPromptHelpBtn'));
  }
  if (creativeTaskHelpBtn) {
    creativeTaskHelpBtn.addEventListener('click', () => openHelpModal('creativeTaskHelpBtn'));
  }
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeHelpModal);
  }

  // Close modal if user clicks outside of the modal content
  window.addEventListener('click', (event) => {
    if (event.target === helpModal) {
      closeHelpModal();
    }
  });
  // --- End Help Modal Logic ---

  restoreOptions();
}

// --- Core Functions ---
function restoreOptions() {
  // Define all keys we might retrieve, including provider-specific prompt templates
  const keysToGet = {
    selectedProvider: 'openai',
    openaiApiKey: '',
    anthropicApiKey: '',
    geminiApiKey: '',
    model: '',
    customModel: '',
    languageMode: 'standard',
    targetLanguage: 'en',
    customLanguage: '',
    globalCreativeTask: '', 
    lastRequestInfo: null,
    lastRequestPrompt: null,
    lastResponseInfo: null,
    lastResponseContent: null
  };

  // Add provider prompt template keys to keysToGet
  Object.keys(providerModels).forEach(provider => {
    keysToGet[`${provider}Prompt`] = defaultPrompts[provider]; // Default to default if not found
  });

  chrome.storage.sync.get(keysToGet, (items) => {
    providerSelect.value = items.selectedProvider;
    openAIApiKeyInput.value = items.openaiApiKey;
    anthropicApiKeyInput.value = items.anthropicApiKey;
    geminiApiKeyInput.value = items.geminiApiKey;
    customModelInput.value = items.customModel;
    creativeTaskTextarea.value = items.globalCreativeTask;

    const currentLanguageMode = items.languageMode;
    document.querySelector(`input[name="languageMode"][value="${currentLanguageMode}"]`).checked = true;
    
    // Restore standard language selection based on display text
    if (items.targetLanguage) {
      let found = false;
      for (let i = 0; i < languageSelect.options.length; i++) {
        if (languageSelect.options[i].text === items.targetLanguage) {
          languageSelect.value = languageSelect.options[i].value;
          found = true;
          break;
        }
      }
      if (!found) {
        // Fallback if the saved text is not found (e.g. language list changed)
        // Set to default or leave as is (which might be the first option)
        if (languageSelect.options.length > 0) languageSelect.value = languageSelect.options[0].value;
      }
    } else if (languageSelect.options.length > 0) {
      // Default if nothing is stored for targetLanguage
      languageSelect.value = languageSelect.options[0].value; 
    }

    customLanguageInput.value = items.customLanguage;
    
    updateProviderFields(); // Updates API key visibility, model dropdowns, and loads the provider's prompt template
    updateModelOptions(items.model || providerModels[items.selectedProvider]?.[0], items.customModel);
    updateLanguageSectionState();
    
    // Load the specific prompt template for the restored provider
    // updateProviderFields will handle loading the correct prompt template into promptTemplateTextarea
    // based on items.selectedProvider and its stored `${items.selectedProvider}Prompt`

    fetchLastLLMData();
  });
}

function saveOptions() {
  const provider = providerSelect.value;
  const selectedModelValue = modelSelect.value;
  const customModelValue = customModelInput.value.trim();
  
  let finalModel = selectedModelValue;
  if (customModelValue && (selectedModelValue === '' || !providerModels[provider] || providerModels[provider].length === 0 || !providerModels[provider].includes(selectedModelValue))) {
    finalModel = customModelValue;
  }
  
  const openaiApiKey = openAIApiKeyInput.value.trim();
  const anthropicApiKey = anthropicApiKeyInput.value.trim();
  const geminiApiKey = geminiApiKeyInput.value.trim();
  
  const promptTemplateFromUI = promptTemplateTextarea.value; 
  const creativeTaskText = creativeTaskTextarea.value.trim();
  
  let resolvedPromptForBackground = promptTemplateFromUI;
  if (creativeTaskText) {
    const formattedCreativeTask = '2.  **Creative Addition Task:** ' + creativeTaskText + '\n';
    resolvedPromptForBackground = promptTemplateFromUI.replace('{{creative_task_placeholder}}', formattedCreativeTask);
  } else {
    resolvedPromptForBackground = promptTemplateFromUI.replace('{{creative_task_placeholder}}', '');
  }
  
  const languageMode = document.querySelector('input[name="languageMode"]:checked').value;
  const standardLanguageValue = languageSelect.value; // Keep the value for other uses if needed
  const standardLanguageText = languageSelect.options[languageSelect.selectedIndex]?.text || standardLanguageValue; // Get the display text
  const customLangText = customLanguageInput.value.trim();

  const settingsToSave = {
    selectedProvider: provider,
    model: finalModel,
    customModel: customModelValue, 
    openaiApiKey: openaiApiKey,
    anthropicApiKey: anthropicApiKey,
    geminiApiKey: geminiApiKey,
    [`${provider}Prompt`]: promptTemplateFromUI, // Store the UNRESOLVED template for this provider
    globalCreativeTask: creativeTaskText, 
    supportsTemperature: supportsTemperature(finalModel),
    languageMode: languageMode,
    targetLanguage: standardLanguageText,
    customLanguage: customLangText,  
    settings: { 
      provider: provider, 
      model: finalModel, 
      apiKey: provider === 'openai' ? openaiApiKey : (provider === 'anthropic' ? anthropicApiKey : geminiApiKey),
      promptTemplate: resolvedPromptForBackground, // Store the RESOLVED prompt for the background script
      targetLang: languageMode === 'custom' ? customLangText : (standardLanguageText || 'English'),
      streaming: true 
    }
  };
  
  chrome.storage.sync.set(settingsToSave, () => {
    statusDiv.textContent = 'Settings saved.';
    statusDiv.style.color = 'green'; 
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

  [openaiKeyWrapper, anthropicKeyWrapper, geminiKeyWrapper].forEach(w => w.style.display = 'none');
  [openaiApiKeyHelp, anthropicApiKeyHelp, geminiApiKeyHelp].forEach(h => h.style.display = 'none');

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
  
  // Load the UNRESOLVED prompt template for this provider into the textarea
  const providerPromptKey = `${provider}Prompt`;
  chrome.storage.sync.get([providerPromptKey], (items) => {
    promptTemplateTextarea.value = items[providerPromptKey] || defaultPrompts[provider];
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