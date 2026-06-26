// options.js
// Note: Constants like noTemperatureModels, providerModels, defaultLessonPrompt,
// and defaultImageTranslationPromptTemplate
// are also defined in src/shared/constants.js. Keep them synchronized.

document.addEventListener('DOMContentLoaded', initializeOptionsPage);

// --- Tab Navigation ---
const tabButtons = document.querySelectorAll('.tab-button');
const tabContents = document.querySelectorAll('.tab-content');

function initializeTabs() {
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.dataset.tab;
      
      // Update active states
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      button.classList.add('active');
      document.getElementById(`tab-${targetTab}`).classList.add('active');
      
      // Save active tab to storage
      chrome.storage.local.set({ activeTab: targetTab });
    });
  });
  
  // Restore last active tab
  chrome.storage.local.get(['activeTab'], (items) => {
    const savedTab = items.activeTab || 'translation';
    const targetButton = document.querySelector(`.tab-button[data-tab="${savedTab}"]`);
    if (targetButton) {
      targetButton.click();
    }
  });
}

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

const openaiThinkingWrapper = document.getElementById('openaiThinkingWrapper');
const geminiThinkingWrapper = document.getElementById('geminiThinkingWrapper');
const openaiThinkingCheckbox = document.getElementById('openaiThinkingCheckbox');
const geminiThinkingCheckbox = document.getElementById('geminiThinkingCheckbox');

const promptTemplateTextarea = document.getElementById('promptTemplate');
const creativeTaskTextarea = document.getElementById('creativeTaskTextarea');
const lessonPromptTextarea = document.getElementById('lessonPromptTextarea');
const imagePromptTemplateTextarea = document.getElementById('imagePromptTemplate');
const mainPromptHelpBtn = document.getElementById('mainPromptHelpBtn');
const creativeTaskHelpBtn = document.getElementById('creativeTaskHelpBtn');
const lessonPromptHelpBtn = document.getElementById('lessonPromptHelpBtn');
const imagePromptHelpBtn = document.getElementById('imagePromptHelpBtn');
const resetLessonPromptBtn = document.getElementById('resetLessonPromptBtn');
const resetImagePromptBtn = document.getElementById('resetImagePromptBtn');
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
const saveImagePromptBtn = document.getElementById('saveImagePromptBtn');
const resetPromptBtn = document.getElementById('resetPromptBtn');

// TTS Elements
const elevenlabsApiKeyInput = document.getElementById('elevenlabsApiKey');
const elevenlabsVoiceSelect = document.getElementById('elevenlabsVoice');
const elevenlabsCustomVoiceIdInput = document.getElementById('elevenlabsCustomVoiceId');
const elevenlabsModelSelect = document.getElementById('elevenlabsModel');
const ttsTestTextInput = document.getElementById('ttsTestText');
const testTTSBtn = document.getElementById('testTTSBtn');
const ttsTestStatus = document.getElementById('ttsTestStatus');

// TTS Provider Elements
const ttsProviderRadios = document.querySelectorAll('input[name="ttsProvider"]');
const elevenlabsSettingsSection = document.getElementById('elevenlabsSettingsSection');
const googleTtsSettingsSection = document.getElementById('googleTtsSettingsSection');

// Google TTS Elements
const googleTtsApiKeyInput = document.getElementById('googleTtsApiKey');
const googleTtsVoiceSelect = document.getElementById('googleTtsVoice');
const googleTtsSpeakingRateInput = document.getElementById('googleTtsSpeakingRate');
const googleTtsSpeakingRateValue = document.getElementById('googleTtsSpeakingRateValue');
const googleTtsPitchInput = document.getElementById('googleTtsPitch');
const googleTtsPitchValue = document.getElementById('googleTtsPitchValue');
const googleTtsPitchWrapper = document.getElementById('googleTtsPitchWrapper');
const googleTtsPitchNote = document.getElementById('googleTtsPitchNote');
const googleTtsTestTextInput = document.getElementById('googleTtsTestText');
const testGoogleTTSBtn = document.getElementById('testGoogleTTSBtn');
const googleTtsTestStatus = document.getElementById('googleTtsTestStatus');

// TTS Help Buttons
const elevenlabsHelpBtn = document.getElementById('elevenlabsHelpBtn');
const googleTtsHelpBtn = document.getElementById('googleTtsHelpBtn');

// --- Modal Elements ---
const helpModal = document.getElementById('helpModal');
const helpModalTitle = document.getElementById('helpModalTitle');
const helpModalBody = document.getElementById('helpModalBody');
const modalCloseBtn = document.querySelector('.modal-close-btn');

// --- Configuration Data ---
const noTemperatureModels = [
  "gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano",
  "gpt-5-mini", "gpt-5-nano",
  "claude-opus-4-8",
  "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite",
  "gemini-3-pro-preview", "gemini-3-flash-preview"
];

const providerModels = {
  openai: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.2-pro", "gpt-5.2", "gpt-5-mini", "gpt-5-nano"],
  anthropic: ["claude-sonnet-4-6", "claude-opus-4-8", "claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"],
  gemini: ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
};

// Default lesson prompt
const defaultLessonPrompt = `Create a comprehensive lesson to help me learn about this Japanese text and its translation: "{0}"

Please include:
1. A detailed breakdown table with columns for: Japanese text, Reading (furigana), Literal meaning, and Grammar notes
2. Key vocabulary with example sentences
3. Cultural or contextual notes if relevant
4. At the end, provide 5 helpful flashcards in a clear format for memorization`;

const defaultImageTranslationPromptTemplate = [
  'Translate all visible source-language text in this image to {{target}} directly in the image.',
  'Preserve the original layout, borders, spacing, alignment, typography hierarchy, photos, graphics, and overall visual appearance.',
  'Favor literal translation over paraphrase. Preserve reading order, dates, names, brands, quoted titles, and unusual phrasing as much as possible.',
  'Preserve numeric values, prices, currency symbols, currency units, measurements, and product quantities exactly; translate unit words only when needed, but do not convert currencies or amounts.',
  'Resize translated text as needed to fit the original text regions.',
  'Keep translated text inside the original text area and do not overlap decorative rules, borders, icons, photos, hands, or other non-text graphics.',
  'Do not add subtitles, annotations, callouts, bounding boxes, JSON, coordinates, or side-by-side translations.',
  'Do not leave untranslated source-language text visible unless it is a proper noun, brand name, or intentionally untranslated title.'
].join(' ');

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
  // Initialize tabs
  initializeTabs();
  
  // Set version from manifest
  const versionBadge = document.getElementById('versionBadge');
  if (versionBadge) {
    versionBadge.textContent = 'v' + chrome.runtime.getManifest().version;
  }
  
  // Setup event listeners
  providerSelect.addEventListener('change', () => {
    // Restore the model for the newly selected provider
    const newProvider = providerSelect.value;
    chrome.storage.local.get([
      `${newProvider}Model`,
      `${newProvider}CustomModel`
    ], (items) => {
      const providerModelKey = `${newProvider}Model`;
      const providerCustomModelKey = `${newProvider}CustomModel`;
      
      // Use provider-specific model only (don't fallback to old 'model' key when switching providers
      // as that was for a different provider - migration happens on initial load)
      const savedModel = items[providerModelKey] || '';
      const savedCustomModel = items[providerCustomModelKey] || '';
      
      updateProviderFields();
      updateModelOptions(savedModel || providerModels[newProvider]?.[0], savedCustomModel);
      updateThinkingCheckboxVisibility();
    });
  });
  modelSelect.addEventListener('change', () => {
    updateCustomModelVisibility();
    updateThinkingCheckboxVisibility();
  });
  customModelInput.addEventListener('input', updateThinkingCheckboxVisibility);
  saveBtn.addEventListener('click', saveOptions);
  if (saveImagePromptBtn) {
    saveImagePromptBtn.addEventListener('click', saveOptions);
  }
  resetPromptBtn.addEventListener('click', resetPromptToDefault);
  if (resetImagePromptBtn) {
    resetImagePromptBtn.addEventListener('click', resetImagePromptToDefault);
  }
  
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

  // TTS test button
  if (testTTSBtn) {
    testTTSBtn.addEventListener('click', testTTSVoice);
  }

  // Google TTS test button
  if (testGoogleTTSBtn) {
    testGoogleTTSBtn.addEventListener('click', testGoogleTTSVoice);
  }

  // TTS Provider switching
  ttsProviderRadios.forEach(radio => {
    radio.addEventListener('change', updateTTSProviderSection);
  });

  // Google TTS range slider updates
  if (googleTtsSpeakingRateInput && googleTtsSpeakingRateValue) {
    googleTtsSpeakingRateInput.addEventListener('input', () => {
      googleTtsSpeakingRateValue.textContent = googleTtsSpeakingRateInput.value + 'x';
    });
  }
  
  if (googleTtsPitchInput && googleTtsPitchValue) {
    googleTtsPitchInput.addEventListener('input', () => {
      googleTtsPitchValue.textContent = googleTtsPitchInput.value;
    });
  }

  // Google TTS voice change handler - update pitch slider availability and test text
  if (googleTtsVoiceSelect) {
    googleTtsVoiceSelect.addEventListener('change', () => {
      updateGoogleTtsPitchAvailability();
      updateGoogleTtsTestText();
    });
  }

  // TTS Help buttons
  if (elevenlabsHelpBtn) {
    elevenlabsHelpBtn.addEventListener('click', () => openHelpModal('elevenlabsHelpBtn'));
  }
  if (googleTtsHelpBtn) {
    googleTtsHelpBtn.addEventListener('click', () => openHelpModal('googleTtsHelpBtn'));
  }

  // --- Help Modal Logic ---
  const helpContentMap = {
    customHelp: {
      title: "Custom Target Language",
      body: "<p>Enter any custom target language prompt. This allows for creative and flexible translation requests.</p>" +
            "<p><strong>Examples:</strong></p>" +
            "<ul>" +
            "<li>'English, but everyone is talking like a pirate'</li>" +
            "<li>'Piglatin'</li>" +
            "<li>'Japanese, but with furigana on all the kanji'</li>" +
            "<li>'Translate to Spanish, and make it rhyme if possible.'</li>" +
            "</ul>" +
            "<p>Be creative! The LLM will do its best to follow your custom instructions for the target language.</p>"
    },
    elevenlabsHelpBtn: {
      title: "How to Get an ElevenLabs API Key",
      body: "<p>ElevenLabs provides ultra-realistic AI voice synthesis. Follow these steps to get your API key:</p>" +
            "<ol>" +
            "<li><strong>Create an account:</strong> Go to <a href='https://elevenlabs.io/' target='_blank' rel='noopener'>elevenlabs.io</a> and sign up for a free account.</li>" +
            "<li><strong>Navigate to API Keys:</strong> After logging in, click your profile icon in the bottom-left corner, then select <strong>Profile + API key</strong>.</li>" +
            "<li><strong>Generate a key:</strong> Click <strong>Create API Key</strong> and give it a name (e.g., 'UGTBrowser').</li>" +
            "<li><strong>Copy the key:</strong> Copy your new API key and paste it into the field above.</li>" +
            "</ol>" +
            "<p><strong>Direct link:</strong> <a href='https://elevenlabs.io/app/settings/api-keys' target='_blank' rel='noopener'>elevenlabs.io/app/settings/api-keys</a></p>" +
            "<p><strong>Note:</strong> ElevenLabs offers a free tier with limited characters per month. Paid plans provide more quota and additional features.</p>"
    },
    googleTtsHelpBtn: {
      title: "How to Get a Google Cloud TTS API Key",
      body: "<p>Google Cloud Text-to-Speech provides high-quality voices including Studio and Neural2. Follow these steps:</p>" +
            "<ol>" +
            "<li><strong>Create a Google Cloud account:</strong> Go to <a href='https://console.cloud.google.com/' target='_blank' rel='noopener'>console.cloud.google.com</a> and sign in with your Google account.</li>" +
            "<li><strong>Create a new project:</strong> Click the project dropdown at the top, then <strong>New Project</strong>. Give it a name (e.g., 'UGTBrowser TTS').</li>" +
            "<li><strong>Enable the Text-to-Speech API:</strong> Go to <a href='https://console.cloud.google.com/apis/library/texttospeech.googleapis.com' target='_blank' rel='noopener'>APIs & Services > Library</a>, search for 'Text-to-Speech API', and click <strong>Enable</strong>.</li>" +
            "<li><strong>Create API credentials:</strong> Go to <a href='https://console.cloud.google.com/apis/credentials' target='_blank' rel='noopener'>APIs & Services > Credentials</a>, click <strong>Create Credentials</strong>, then select <strong>API Key</strong>.</li>" +
            "<li><strong>Copy the key:</strong> Copy your new API key and paste it into the field above.</li>" +
            "<li><strong>(Recommended) Restrict the key:</strong> Click on your API key and restrict it to only the Text-to-Speech API for security.</li>" +
            "</ol>" +
            "<p><strong>Direct link to enable API:</strong> <a href='https://console.cloud.google.com/apis/library/texttospeech.googleapis.com' target='_blank' rel='noopener'>Enable Text-to-Speech API</a></p>" +
            "<p><strong>Pricing:</strong> Google Cloud offers $300 free credits for new users. Standard usage costs apply after that. Studio voices are premium-priced.</p>"
    },
    creativeTaskHelpBtn: {
      title: "Optional Creative Task",
      body: "<p>Define an optional creative task for the LLM to perform <em>in addition</em> to the primary translation. This task will be incorporated into the main prompt sent to the LLM.</p>" +
            "<p><strong>Examples:</strong></p>" +
            "<ul>" +
            "<li>'Make the translation sound like a pirate.'</li>" +
            "<li>'Summarize the text in one sentence after translating.'</li>" +
            "<li>'After translating, explain any cultural nuances found in the original text.'</li>" +
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
    },
    imagePromptHelpBtn: {
      title: "Image Translation Prompt",
      body: "<p>This prompt is sent to OpenAI with the captured image when you right-click an image and choose <strong>Translate image</strong>.</p>" +
            "<p><strong>Placeholder:</strong></p>" +
            "<ul>" +
            "<li><code>{{target}}</code>: Replaced with the selected target language or your custom target language prompt.</li>" +
            "</ul>" +
            "<p>Keep instructions focused on in-image text replacement, layout preservation, and numeric/currency preservation. Customizations are stored in Chrome extension storage and are not written to project files.</p>"
    },
    lessonPromptHelpBtn: {
      title: "Lesson Prompt Template",
      body: "<p>This prompt is used when you highlight text on a webpage and select <strong>\"Create Lesson\"</strong> from the right-click context menu.</p>" +
            "<p><strong>How it works:</strong></p>" +
            "<ul>" +
            "<li>Select any text on a webpage (typically in a foreign language you're learning)</li>" +
            "<li>Right-click and choose <strong>UGTBrowser Language Tools → Create Lesson</strong></li>" +
            "<li>A detailed lesson will appear inline, similar to how translations are displayed</li>" +
            "<li>You can ask follow-up questions using the chat interface</li>" +
            "</ul>" +
            "<p><strong>Placeholder:</strong></p>" +
            "<ul>" +
            "<li><code>{0}</code>: This will be replaced with the selected text</li>" +
            "</ul>" +
            "<p><strong>Customization Tips:</strong></p>" +
            "<ul>" +
            "<li>Tailor the prompt for your target language (Japanese, Spanish, etc.)</li>" +
            "<li>Request specific content like grammar breakdowns, vocabulary lists, or cultural notes</li>" +
            "<li>Ask for practice exercises, flashcards, or mnemonics</li>" +
            "<li>Specify the format you prefer (tables, bullet points, etc.)</li>" +
            "</ul>" +
            "<p><strong>Example customizations:</strong></p>" +
            "<ul>" +
            "<li>\"Focus on JLPT N3 grammar patterns\"</li>" +
            "<li>\"Include pitch accent notation for Japanese\"</li>" +
            "<li>\"Provide Spanish conjugation tables\"</li>" +
            "<li>\"Add example sentences with audio transcription hints\"</li>" +
            "</ul>"
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
  if (lessonPromptHelpBtn) {
    lessonPromptHelpBtn.addEventListener('click', () => openHelpModal('lessonPromptHelpBtn'));
  }
  if (imagePromptHelpBtn) {
    imagePromptHelpBtn.addEventListener('click', () => openHelpModal('imagePromptHelpBtn'));
  }
  if (resetLessonPromptBtn) {
    resetLessonPromptBtn.addEventListener('click', resetLessonPromptToDefault);
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
  // Define all keys we might retrieve, including provider-specific prompt templates and models
  const keysToGet = {
    selectedProvider: 'openai',
    openaiApiKey: '',
    anthropicApiKey: '',
    geminiApiKey: '',
    // Provider-specific models (for backward compatibility, also check old 'model' key)
    openaiModel: '',
    anthropicModel: '',
    geminiModel: '',
    openaiCustomModel: '',
    anthropicCustomModel: '',
    geminiCustomModel: '',
    model: '', // Old key for backward compatibility
    customModel: '', // Old key for backward compatibility
    languageMode: 'standard',
    targetLanguage: 'en',
    customLanguage: '',
    globalCreativeTask: '', 
    openaiThinkingEnabled: false,
    geminiThinkingEnabled: false,
    lastRequestInfo: null,
    lastRequestPrompt: null,
    lastResponseInfo: null,
    lastResponseContent: null,
    // TTS settings
    ttsProvider: 'elevenlabs',
    elevenlabsApiKey: '',
    elevenlabsVoice: '21m00Tcm4TlvDq8ikWAM', // Default to Rachel
    elevenlabsCustomVoiceId: '',
    elevenlabsModel: 'eleven_multilingual_v2',
    // Google TTS settings
    googleTtsApiKey: '',
    googleTtsVoice: 'en-US-Studio-O',
    googleTtsSpeakingRate: 1.0,
    googleTtsPitch: 0,
    // Lesson settings
    lessonPrompt: defaultLessonPrompt,
    // Image translation settings
    imageTranslationPromptTemplate: defaultImageTranslationPromptTemplate
  };

  // Add provider prompt template keys to keysToGet
  Object.keys(providerModels).forEach(provider => {
    keysToGet[`${provider}Prompt`] = defaultPrompts[provider]; // Default to default if not found
  });

  chrome.storage.local.get(keysToGet, (items) => {
    providerSelect.value = items.selectedProvider;
    openAIApiKeyInput.value = items.openaiApiKey;
    anthropicApiKeyInput.value = items.anthropicApiKey;
    geminiApiKeyInput.value = items.geminiApiKey;
    // Restore provider-specific model (with backward compatibility for old 'model' key)
    const providerModelKey = `${items.selectedProvider}Model`;
    const providerCustomModelKey = `${items.selectedProvider}CustomModel`;
    
    // For backward compatibility: use old 'model' key if no provider-specific model exists
    // This handles upgrades from older versions - the old model was for the selected provider
    let savedModel = items[providerModelKey];
    let savedCustomModel = items[providerCustomModelKey];
    
    // Migrate old keys to provider-specific keys on first load after upgrade
    if (!savedModel && items.model) {
      savedModel = items.model;
      // Migrate to provider-specific key for future use
      const migrationData = {};
      migrationData[providerModelKey] = items.model;
      if (items.customModel) {
        migrationData[providerCustomModelKey] = items.customModel;
        savedCustomModel = items.customModel;
      }
      chrome.storage.local.set(migrationData);
    } else if (!savedCustomModel && items.customModel) {
      savedCustomModel = items.customModel;
      // Migrate custom model too
      const migrationData = {};
      migrationData[providerCustomModelKey] = items.customModel;
      chrome.storage.local.set(migrationData);
    }
    
    customModelInput.value = savedCustomModel || '';
    
    // Set default creative task if empty (for new installations)
    if (!items.globalCreativeTask || items.globalCreativeTask.trim() === '') {
      creativeTaskTextarea.value = 'After translating, explain any cultural nuances found in the original text.';
    } else {
      creativeTaskTextarea.value = items.globalCreativeTask;
    }
    
    // Restore thinking checkboxes
    if (openaiThinkingCheckbox) {
      openaiThinkingCheckbox.checked = items.openaiThinkingEnabled === true;
    }
    if (geminiThinkingCheckbox) {
      geminiThinkingCheckbox.checked = items.geminiThinkingEnabled === true;
    }

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
    updateModelOptions(savedModel || providerModels[items.selectedProvider]?.[0], savedCustomModel);
    updateLanguageSectionState();
    updateThinkingCheckboxVisibility();
    
    // Load the specific prompt template for the restored provider
    // updateProviderFields will handle loading the correct prompt template into promptTemplateTextarea
    // based on items.selectedProvider and its stored `${items.selectedProvider}Prompt`

    // Restore TTS settings
    // TTS Provider
    const ttsProvider = items.ttsProvider || 'elevenlabs';
    const ttsProviderRadio = document.querySelector(`input[name="ttsProvider"][value="${ttsProvider}"]`);
    if (ttsProviderRadio) {
      ttsProviderRadio.checked = true;
    }
    updateTTSProviderSection();

    // ElevenLabs settings
    if (elevenlabsApiKeyInput) {
      elevenlabsApiKeyInput.value = items.elevenlabsApiKey || '';
    }
    if (elevenlabsVoiceSelect) {
      elevenlabsVoiceSelect.value = items.elevenlabsVoice || '21m00Tcm4TlvDq8ikWAM';
    }
    if (elevenlabsCustomVoiceIdInput) {
      elevenlabsCustomVoiceIdInput.value = items.elevenlabsCustomVoiceId || '';
    }
    if (elevenlabsModelSelect) {
      elevenlabsModelSelect.value = items.elevenlabsModel || 'eleven_multilingual_v2';
    }

    // Google TTS settings
    if (googleTtsApiKeyInput) {
      googleTtsApiKeyInput.value = items.googleTtsApiKey || '';
    }
    if (googleTtsVoiceSelect) {
      googleTtsVoiceSelect.value = items.googleTtsVoice || 'en-US-Studio-O';
    }
    if (googleTtsSpeakingRateInput) {
      googleTtsSpeakingRateInput.value = items.googleTtsSpeakingRate || 1.0;
      if (googleTtsSpeakingRateValue) {
        googleTtsSpeakingRateValue.textContent = (items.googleTtsSpeakingRate || 1.0) + 'x';
      }
    }
    if (googleTtsPitchInput) {
      googleTtsPitchInput.value = items.googleTtsPitch || 0;
      if (googleTtsPitchValue) {
        googleTtsPitchValue.textContent = items.googleTtsPitch || 0;
      }
    }
    updateGoogleTtsPitchAvailability();
    updateGoogleTtsTestText();

    // Restore lesson prompt
    if (lessonPromptTextarea) {
      lessonPromptTextarea.value = items.lessonPrompt || defaultLessonPrompt;
    }

    if (imagePromptTemplateTextarea) {
      imagePromptTemplateTextarea.value = items.imageTranslationPromptTemplate || defaultImageTranslationPromptTemplate;
    }

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

  // Get TTS settings
  const ttsProvider = document.querySelector('input[name="ttsProvider"]:checked')?.value || 'elevenlabs';
  const elevenlabsApiKey = elevenlabsApiKeyInput ? elevenlabsApiKeyInput.value.trim() : '';
  const elevenlabsVoice = elevenlabsVoiceSelect ? elevenlabsVoiceSelect.value : '21m00Tcm4TlvDq8ikWAM';
  const elevenlabsVoiceName = elevenlabsVoiceSelect ? elevenlabsVoiceSelect.options[elevenlabsVoiceSelect.selectedIndex]?.text.split(' (')[0] : 'Rachel';
  const elevenlabsCustomVoiceId = elevenlabsCustomVoiceIdInput ? elevenlabsCustomVoiceIdInput.value.trim() : '';
  const elevenlabsModel = elevenlabsModelSelect ? elevenlabsModelSelect.value : 'eleven_multilingual_v2';
  
  // Google TTS settings
  const googleTtsApiKey = googleTtsApiKeyInput ? googleTtsApiKeyInput.value.trim() : '';
  const googleTtsVoice = googleTtsVoiceSelect ? googleTtsVoiceSelect.value : 'en-US-Studio-O';
  const googleTtsVoiceName = googleTtsVoiceSelect ? googleTtsVoiceSelect.options[googleTtsVoiceSelect.selectedIndex]?.text : 'English (US) - Studio O (female)';
  const googleTtsSpeakingRate = googleTtsSpeakingRateInput ? parseFloat(googleTtsSpeakingRateInput.value) : 1.0;
  const googleTtsPitch = googleTtsPitchInput ? parseFloat(googleTtsPitchInput.value) : 0;

  // Lesson settings
  const lessonPrompt = lessonPromptTextarea ? lessonPromptTextarea.value : defaultLessonPrompt;
  const imageTranslationPromptTemplate = imagePromptTemplateTextarea
    ? imagePromptTemplateTextarea.value
    : defaultImageTranslationPromptTemplate;

  const settingsToSave = {
    selectedProvider: provider,
    // Save provider-specific model
    [`${provider}Model`]: finalModel,
    [`${provider}CustomModel`]: customModelValue,
    // Keep old keys for backward compatibility
    model: finalModel,
    customModel: customModelValue,
    openaiApiKey: openaiApiKey,
    anthropicApiKey: anthropicApiKey,
    geminiApiKey: geminiApiKey,
    [`${provider}Prompt`]: promptTemplateFromUI, // Store the UNRESOLVED template for this provider
    globalCreativeTask: creativeTaskText, 
    openaiThinkingEnabled: openaiThinkingCheckbox ? openaiThinkingCheckbox.checked : false,
    geminiThinkingEnabled: geminiThinkingCheckbox ? geminiThinkingCheckbox.checked : false,
    supportsTemperature: supportsTemperature(finalModel),
    languageMode: languageMode,
    targetLanguage: standardLanguageText,
    customLanguage: customLangText,
    // TTS settings
    ttsProvider: ttsProvider,
    elevenlabsApiKey: elevenlabsApiKey,
    elevenlabsVoice: elevenlabsVoice,
    elevenlabsVoiceName: elevenlabsVoiceName,
    elevenlabsCustomVoiceId: elevenlabsCustomVoiceId,
    elevenlabsModel: elevenlabsModel,
    // Google TTS settings
    googleTtsApiKey: googleTtsApiKey,
    googleTtsVoice: googleTtsVoice,
    googleTtsVoiceName: googleTtsVoiceName,
    googleTtsSpeakingRate: googleTtsSpeakingRate,
    googleTtsPitch: googleTtsPitch,
    // Lesson settings
    lessonPrompt: lessonPrompt,
    // Image translation settings
    imageTranslationPromptTemplate: imageTranslationPromptTemplate,
    settings: { 
      provider: provider, 
      model: finalModel, 
      apiKey: provider === 'openai' ? openaiApiKey : (provider === 'anthropic' ? anthropicApiKey : geminiApiKey),
      promptTemplate: resolvedPromptForBackground, // Store the RESOLVED prompt for the background script
      targetLang: languageMode === 'custom' ? customLangText : (standardLanguageText || 'English'),
      streaming: true,
      openaiThinkingEnabled: openaiThinkingCheckbox ? openaiThinkingCheckbox.checked : false,
      geminiThinkingEnabled: geminiThinkingCheckbox ? geminiThinkingCheckbox.checked : false
    }
  };
  
  chrome.storage.local.set(settingsToSave, () => {
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
  chrome.storage.local.get([providerPromptKey], (items) => {
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

function updateTTSProviderSection() {
  const selectedProvider = document.querySelector('input[name="ttsProvider"]:checked')?.value || 'elevenlabs';
  
  if (elevenlabsSettingsSection) {
    elevenlabsSettingsSection.style.display = selectedProvider === 'elevenlabs' ? 'block' : 'none';
  }
  if (googleTtsSettingsSection) {
    googleTtsSettingsSection.style.display = selectedProvider === 'google' ? 'block' : 'none';
  }
}

// Check if Google TTS voice supports pitch adjustment
function googleTtsVoiceSupportsPitch(voiceId) {
  if (!voiceId) return true;
  const lowerVoice = voiceId.toLowerCase();
  // Studio and Journey voices don't support pitch
  return !lowerVoice.includes('studio') && !lowerVoice.includes('journey');
}

function updateGoogleTtsPitchAvailability() {
  const voiceId = googleTtsVoiceSelect ? googleTtsVoiceSelect.value : '';
  const supportsPitch = googleTtsVoiceSupportsPitch(voiceId);
  
  if (googleTtsPitchInput) {
    googleTtsPitchInput.disabled = !supportsPitch;
    googleTtsPitchInput.style.opacity = supportsPitch ? '1' : '0.5';
  }
  if (googleTtsPitchNote) {
    googleTtsPitchNote.style.display = supportsPitch ? 'none' : 'block';
  }
}

// Sample test phrases for different languages (shared between TTS providers)
const ttsTestPhrases = {
  'en': 'Hello! This is a test of the text to speech system.',
  'english': 'Hello! This is a test of the text to speech system.',
  'ja': 'こんにちは！これはテキスト読み上げシステムのテストです。',
  'japanese': 'こんにちは！これはテキスト読み上げシステムのテストです。',
  'ko': '안녕하세요! 이것은 텍스트 음성 변환 시스템 테스트입니다.',
  'korean': '안녕하세요! 이것은 텍스트 음성 변환 시스템 테스트입니다.',
  'cmn': '你好！这是文字转语音系统的测试。',
  'zh': '你好！这是文字转语音系统的测试。',
  'chinese': '你好！这是文字转语音系统的测试。',
  'de': 'Hallo! Dies ist ein Test des Text-zu-Sprache-Systems.',
  'german': 'Hallo! Dies ist ein Test des Text-zu-Sprache-Systems.',
  'fr': 'Bonjour! Ceci est un test du système de synthèse vocale.',
  'french': 'Bonjour! Ceci est un test du système de synthèse vocale.',
  'es': '¡Hola! Esta es una prueba del sistema de texto a voz.',
  'spanish': '¡Hola! Esta es una prueba del sistema de texto a voz.',
  'it': 'Ciao! Questo è un test del sistema di sintesi vocale.',
  'italian': 'Ciao! Questo è un test del sistema di sintesi vocale.',
  'pt': 'Olá! Este é um teste do sistema de conversão de texto em fala.',
  'portuguese': 'Olá! Este é um teste do sistema de conversão de texto em fala.',
  'ru': 'Привет! Это тест системы преобразования текста в речь.',
  'russian': 'Привет! Это тест системы преобразования текста в речь.',
  'nl': 'Hallo! Dit is een test van het tekst-naar-spraak systeem.',
  'dutch': 'Hallo! Dit is een test van het tekst-naar-spraak systeem.',
  'ar': 'مرحبا! هذا اختبار لنظام تحويل النص إلى كلام.',
  'arabic': 'مرحبا! هذا اختبار لنظام تحويل النص إلى كلام.',
  'hi': 'नमस्ते! यह टेक्स्ट टू स्पीच सिस्टम का परीक्षण है।',
  'hindi': 'नमस्ते! यह टेक्स्ट टू स्पीच सिस्टम का परीक्षण है।'
};

// Get test phrase for a language code or name
function getTestPhraseForLanguage(langKey) {
  if (!langKey) return ttsTestPhrases['en'];
  const key = langKey.toLowerCase().replace(/[^a-z]/g, '');
  return ttsTestPhrases[key] || ttsTestPhrases['en'];
}

// Extract language code from Google TTS voice ID (e.g., "ja" from "ja-JP-Neural2-B")
function getLanguageFromGoogleVoiceId(voiceId) {
  if (!voiceId) return 'en';
  return voiceId.split('-')[0].toLowerCase();
}

function updateGoogleTtsTestText() {
  if (!googleTtsVoiceSelect || !googleTtsTestTextInput) return;
  
  const langPrefix = getLanguageFromGoogleVoiceId(googleTtsVoiceSelect.value);
  googleTtsTestTextInput.value = getTestPhraseForLanguage(langPrefix);
}


function resetPromptToDefault() {
  const provider = providerSelect.value;
  promptTemplateTextarea.value = defaultPrompts[provider];
}

function resetLessonPromptToDefault() {
  if (lessonPromptTextarea) {
    lessonPromptTextarea.value = defaultLessonPrompt;
  }
}

function resetImagePromptToDefault() {
  if (imagePromptTemplateTextarea) {
    imagePromptTemplateTextarea.value = defaultImageTranslationPromptTemplate;
  }
}

function supportsTemperature(model) {
  if (!model) return true;
  return !noTemperatureModels.includes(model.toLowerCase());
}

// Helper functions to check if models support thinking
function isGPT5Model(model) {
  if (!model) return false;
  return model.toLowerCase().startsWith('gpt-5');
}

function isGemini25Or3Model(model) {
  if (!model) return false;
  return model.startsWith('gemini-2.5') || model.startsWith('gemini-3');
}

function updateThinkingCheckboxVisibility() {
  const provider = providerSelect.value;
  const selectedModelValue = modelSelect.value;
  const customModelValue = customModelInput.value.trim();
  
  // Determine the actual model being used
  let actualModel = selectedModelValue;
  if (customModelValue && (selectedModelValue === '' || !providerModels[provider] || providerModels[provider].length === 0 || !providerModels[provider].includes(selectedModelValue))) {
    actualModel = customModelValue;
  }
  
  // Show/hide OpenAI thinking checkbox
  if (openaiThinkingWrapper && openaiThinkingCheckbox) {
    if (provider === 'openai' && isGPT5Model(actualModel)) {
      openaiThinkingWrapper.style.display = 'block';
    } else {
      openaiThinkingWrapper.style.display = 'none';
    }
  }
  
  // Show/hide Gemini thinking checkbox
  if (geminiThinkingWrapper && geminiThinkingCheckbox) {
    if (provider === 'gemini' && isGemini25Or3Model(actualModel)) {
      geminiThinkingWrapper.style.display = 'block';
    } else {
      geminiThinkingWrapper.style.display = 'none';
    }
  }
}

// --- LLM Debug Functions ---
function fetchLastLLMData() {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage({ type: "GET_LAST_LLM_DATA" }, (data) => {
      if (chrome.runtime.lastError) {
        console.warn("Error fetching LLM data:", chrome.runtime.lastError.message);
        updateLLMDebugUI(null, null, null, null); // Clear or indicate error
        return;
      }
      if (data) {
        updateLLMDebugUI(data.lastRequest, data.lastResponse, data.lastImageRequest, data.lastImageResponse);
      } else {
        updateLLMDebugUI(null, null, null, null); // No data received
      }
    });
  } else {
    console.warn("chrome.runtime.sendMessage not available. LLM Debug data cannot be fetched.");
    updateLLMDebugUI(null, null, null, null); // Indicate unavailability
  }
}

function formatDebugObject(value, excludedKeys = []) {
  return Object.entries(value || {})
    .filter(([key]) => !excludedKeys.includes(key))
    .map(([key, item]) => `${key}: ${item}`)
    .join(' | ');
}

function updateLLMDebugUI(lastRequest, lastResponse, lastImageRequest, lastImageResponse) {
  const requestInfoElement = document.getElementById('lastRequestInfo');
  const requestPromptElement = document.getElementById('lastRequestPrompt');
  const responseInfoElement = document.getElementById('lastResponseInfo');
  const responseContentElement = document.getElementById('lastResponseContent');
  const imageRequestInfoElement = document.getElementById('lastImageRequestInfo');
  const imageRequestPromptElement = document.getElementById('lastImageRequestPrompt');
  const imageResponseInfoElement = document.getElementById('lastImageResponseInfo');

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

  if (imageRequestInfoElement) {
    imageRequestInfoElement.textContent = lastImageRequest
      ? formatDebugObject(lastImageRequest, ['prompt'])
      : "No image translation request data available";
  }

  if (imageRequestPromptElement) {
    imageRequestPromptElement.value = lastImageRequest?.prompt || "";
  }

  if (imageResponseInfoElement) {
    imageResponseInfoElement.textContent = lastImageResponse
      ? formatDebugObject(lastImageResponse)
      : "No image translation result data available";
  }
}

// --- TTS Test Functions ---
let ttsTestAudio = null;

function testTTSVoice() {
  const apiKey = elevenlabsApiKeyInput ? elevenlabsApiKeyInput.value.trim() : '';
  const customVoiceId = elevenlabsCustomVoiceIdInput ? elevenlabsCustomVoiceIdInput.value.trim() : '';
  const selectedVoiceId = elevenlabsVoiceSelect ? elevenlabsVoiceSelect.value : '21m00Tcm4TlvDq8ikWAM';
  
  // Use custom voice ID if provided, otherwise use dropdown selection
  const voiceId = customVoiceId.length > 0 ? customVoiceId : selectedVoiceId;
  
  const modelId = elevenlabsModelSelect ? elevenlabsModelSelect.value : 'eleven_multilingual_v2';
  const testText = ttsTestTextInput ? ttsTestTextInput.value.trim() : 'Hello! This is a test.';
  
  if (!apiKey) {
    showTTSTestStatus('Please enter your ElevenLabs API key first.', 'error');
    return;
  }
  
  if (!voiceId) {
    showTTSTestStatus('Please select a voice or enter a custom voice ID.', 'error');
    return;
  }
  
  if (!testText) {
    showTTSTestStatus('Please enter some text to test.', 'error');
    return;
  }
  
  // Stop any currently playing test audio
  if (ttsTestAudio) {
    ttsTestAudio.pause();
    ttsTestAudio = null;
  }
  
  // Update UI
  showTTSTestStatus('Generating speech...', 'loading');
  testTTSBtn.disabled = true;
  testTTSBtn.textContent = 'Testing...';
  
  // Send test request to background script
  chrome.runtime.sendMessage({
    type: 'TEST_TTS',
    payload: {
      text: testText,
      voiceId: voiceId,
      apiKey: apiKey,
      modelId: modelId
    }
  }, (response) => {
    testTTSBtn.disabled = false;
    testTTSBtn.textContent = 'Test Voice';
    
    if (chrome.runtime.lastError) {
      showTTSTestStatus('Error: ' + chrome.runtime.lastError.message, 'error');
      return;
    }
    
    if (response && response.success) {
      showTTSTestStatus('Playing...', 'success');
      playTestAudio(response.audio, response.mimeType);
    } else {
      showTTSTestStatus('Error: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
}

function playTestAudio(base64Audio, mimeType) {
  try {
    // Convert base64 to blob
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
    const audioUrl = URL.createObjectURL(blob);
    
    // Create and play audio
    ttsTestAudio = new Audio(audioUrl);
    
    ttsTestAudio.addEventListener('ended', () => {
      URL.revokeObjectURL(audioUrl);
      showTTSTestStatus('Test complete!', 'success');
      ttsTestAudio = null;
    });
    
    ttsTestAudio.addEventListener('error', (e) => {
      console.error('Audio playback error:', e);
      URL.revokeObjectURL(audioUrl);
      showTTSTestStatus('Playback error', 'error');
      ttsTestAudio = null;
    });
    
    ttsTestAudio.play().catch(err => {
      console.error('Error playing test audio:', err);
      showTTSTestStatus('Playback error: ' + err.message, 'error');
    });
    
  } catch (e) {
    console.error('Error creating audio from base64:', e);
    showTTSTestStatus('Error creating audio', 'error');
  }
}

function showTTSTestStatus(message, type) {
  if (!ttsTestStatus) return;
  
  ttsTestStatus.textContent = message;
  ttsTestStatus.className = 'tts-test-status';
  
  if (type === 'error') {
    ttsTestStatus.classList.add('tts-test-error');
  } else if (type === 'success') {
    ttsTestStatus.classList.add('tts-test-success');
  } else if (type === 'loading') {
    ttsTestStatus.classList.add('tts-test-loading');
  }
}

// --- Google TTS Test Functions ---
let googleTtsTestAudio = null;

function testGoogleTTSVoice() {
  const apiKey = googleTtsApiKeyInput ? googleTtsApiKeyInput.value.trim() : '';
  const voiceId = googleTtsVoiceSelect ? googleTtsVoiceSelect.value : 'en-US-Studio-O';
  const speakingRate = googleTtsSpeakingRateInput ? parseFloat(googleTtsSpeakingRateInput.value) : 1.0;
  const pitch = googleTtsPitchInput ? parseFloat(googleTtsPitchInput.value) : 0;
  const testText = googleTtsTestTextInput ? googleTtsTestTextInput.value.trim() : 'Hello! This is a test.';
  
  if (!apiKey) {
    showGoogleTTSTestStatus('Please enter your Google Cloud API key first.', 'error');
    return;
  }
  
  if (!testText) {
    showGoogleTTSTestStatus('Please enter some text to test.', 'error');
    return;
  }
  
  // Stop any currently playing test audio
  if (googleTtsTestAudio) {
    googleTtsTestAudio.pause();
    googleTtsTestAudio = null;
  }
  
  // Update UI
  showGoogleTTSTestStatus('Generating speech...', 'loading');
  testGoogleTTSBtn.disabled = true;
  testGoogleTTSBtn.textContent = 'Testing...';
  
  // Send test request to background script
  chrome.runtime.sendMessage({
    type: 'TEST_GOOGLE_TTS',
    payload: {
      text: testText,
      voiceId: voiceId,
      apiKey: apiKey,
      speakingRate: speakingRate,
      pitch: pitch
    }
  }, (response) => {
    testGoogleTTSBtn.disabled = false;
    testGoogleTTSBtn.textContent = 'Test Voice';
    
    if (chrome.runtime.lastError) {
      showGoogleTTSTestStatus('Error: ' + chrome.runtime.lastError.message, 'error');
      return;
    }
    
    if (response && response.success) {
      showGoogleTTSTestStatus('Playing...', 'success');
      playGoogleTTSTestAudio(response.audio, response.mimeType);
    } else {
      showGoogleTTSTestStatus('Error: ' + (response?.error || 'Unknown error'), 'error');
    }
  });
}

function playGoogleTTSTestAudio(base64Audio, mimeType) {
  try {
    // Convert base64 to blob
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType || 'audio/mp3' });
    const audioUrl = URL.createObjectURL(blob);
    
    // Create and play audio
    googleTtsTestAudio = new Audio(audioUrl);
    
    googleTtsTestAudio.addEventListener('ended', () => {
      URL.revokeObjectURL(audioUrl);
      showGoogleTTSTestStatus('Test complete!', 'success');
      googleTtsTestAudio = null;
    });
    
    googleTtsTestAudio.addEventListener('error', (e) => {
      console.error('Audio playback error:', e);
      URL.revokeObjectURL(audioUrl);
      showGoogleTTSTestStatus('Playback error', 'error');
      googleTtsTestAudio = null;
    });
    
    googleTtsTestAudio.play().catch(err => {
      console.error('Error playing test audio:', err);
      showGoogleTTSTestStatus('Playback error: ' + err.message, 'error');
    });
    
  } catch (e) {
    console.error('Error creating audio from base64:', e);
    showGoogleTTSTestStatus('Error creating audio', 'error');
  }
}

function showGoogleTTSTestStatus(message, type) {
  if (!googleTtsTestStatus) return;
  
  googleTtsTestStatus.textContent = message;
  googleTtsTestStatus.className = 'tts-test-status';
  
  if (type === 'error') {
    googleTtsTestStatus.classList.add('tts-test-error');
  } else if (type === 'success') {
    googleTtsTestStatus.classList.add('tts-test-success');
  } else if (type === 'loading') {
    googleTtsTestStatus.classList.add('tts-test-loading');
  }
}
