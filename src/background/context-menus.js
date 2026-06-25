// src/background/context-menus.js
// Context menu setup and management

import {
  CONTEXT_MENU_PARENT,
  CONTEXT_MENU_TRANSLATE,
  CONTEXT_MENU_TRANSLATE_SIMPLE,
  CONTEXT_MENU_TRANSLATE_IMAGE,
  CONTEXT_MENU_TRANSLATE_VIDEO_FRAME,
  CONTEXT_MENU_SPEAK,
  CONTEXT_MENU_LESSON,
  CONTEXT_MENU_ASK,
  CONTEXT_MENU_SETTINGS
} from '../shared/constants.js';

const TEXT_CONTEXT_MENU_IDS = [
  CONTEXT_MENU_TRANSLATE,
  CONTEXT_MENU_TRANSLATE_SIMPLE,
  CONTEXT_MENU_SPEAK,
  CONTEXT_MENU_LESSON,
  CONTEXT_MENU_ASK
];

let contextMenuVisibilityListenerRegistered = false;

/**
 * Build the translate menu title based on settings
 */
export function buildTranslateTitle(settings, simpleMode = false) {
  let langName = "English";
  let providerName = "OpenAI";

  if (settings) {
    providerName = (settings.provider || "openai").replace(/^./, (c) => c.toUpperCase());

    if (settings.languageMode === 'custom') {
      if (settings.customLanguage && settings.customLanguage.trim() !== "") {
        langName = settings.customLanguage.trim();
      } else {
        langName = "Custom";
      }
    } else if (settings.targetLanguage) {
      langName = settings.targetLanguage;
    }
  }

  // Truncate langName if it's too long for the context menu
  if (langName.length > 16) {
    langName = langName.substring(0, 16) + "...";
  }

  const baseTitle = `Translate to ${langName} with ${providerName}`;
  return simpleMode ? `${baseTitle} (Translate Only)` : baseTitle;
}

/**
 * Build the image translation menu title based on settings
 */
export function buildImageTranslateTitle(settings) {
  let langName = "English";

  if (settings) {
    if (settings.languageMode === 'custom') {
      langName = settings.customLanguage?.trim() || "Custom";
    } else if (settings.targetLanguage) {
      langName = settings.targetLanguage;
    }
  }

  if (langName.length > 18) {
    langName = langName.substring(0, 18) + "...";
  }

  return `Translate image to ${langName}`;
}

/**
 * Build the video frame translation menu title based on settings
 */
export function buildVideoFrameTranslateTitle(settings) {
  let langName = "English";

  if (settings) {
    if (settings.languageMode === 'custom') {
      langName = settings.customLanguage?.trim() || "Custom";
    } else if (settings.targetLanguage) {
      langName = settings.targetLanguage;
    }
  }

  if (langName.length > 18) {
    langName = langName.substring(0, 18) + "...";
  }

  return `Translate video frame to ${langName}`;
}

/**
 * Build the speak menu title based on TTS settings
 */
export function buildSpeakTitle(settings) {
  const ttsProvider = settings?.ttsProvider || 'elevenlabs';
  let voiceName = "Default";
  let providerLabel = "ElevenLabs";
  
  if (ttsProvider === 'google') {
    providerLabel = "Google TTS";
    if (settings && settings.googleTtsVoiceName) {
      // Extract just the voice type from the full name
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

/**
 * Create all context menu items
 */
export function createContextMenus(settings = {}) {
  chrome.contextMenus.removeAll(() => {
    // Create parent menu item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_PARENT,
      title: "UGTBrowser Language Tools",
      contexts: ["selection", "page", "link", "image", "video"]
    });
    
    // Create Translate child item (full version with creative task and follow-up chat)
    chrome.contextMenus.create({
      id: CONTEXT_MENU_TRANSLATE,
      parentId: CONTEXT_MENU_PARENT,
      title: buildTranslateTitle(settings),
      contexts: ["selection"]
    });
    
    // Create Translate Simple child item (translation only, no extras)
    chrome.contextMenus.create({
      id: CONTEXT_MENU_TRANSLATE_SIMPLE,
      parentId: CONTEXT_MENU_PARENT,
      title: buildTranslateTitle(settings, true),
      contexts: ["selection"]
    });

    // Create Image Translate child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_TRANSLATE_IMAGE,
      parentId: CONTEXT_MENU_PARENT,
      title: buildImageTranslateTitle(settings),
      contexts: ["image"]
    });

    // Create Video Frame Translate child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_TRANSLATE_VIDEO_FRAME,
      parentId: CONTEXT_MENU_PARENT,
      title: buildVideoFrameTranslateTitle(settings),
      contexts: ["video", "page"]
    });
    
    // Create Speak child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SPEAK,
      parentId: CONTEXT_MENU_PARENT,
      title: buildSpeakTitle(settings),
      contexts: ["selection"]
    });
    
    // Create Lesson child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_LESSON,
      parentId: CONTEXT_MENU_PARENT,
      title: "Create Lesson",
      contexts: ["selection"]
    });
    
    // Create Ask child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ASK,
      parentId: CONTEXT_MENU_PARENT,
      title: "Ask About Selection",
      contexts: ["selection"]
    });
    
    // Create a disabled hint item (only when NO selection)
    chrome.contextMenus.create({
      id: "ugtbrowser_hint",
      parentId: CONTEXT_MENU_PARENT,
      title: "(Highlight some text first!)",
      contexts: ["page"],
      enabled: false
    });
    
    // Create Settings child item
    chrome.contextMenus.create({
      id: CONTEXT_MENU_SETTINGS,
      parentId: CONTEXT_MENU_PARENT,
      title: "Settings",
      contexts: ["selection", "page", "link", "image", "video"]
    });
  });
}

/**
 * Get effective settings from storage for context menu display
 */
export function getEffectiveSettings(fullSettings) {
  return {
    provider: fullSettings.selectedProvider || fullSettings.settings?.provider || 'openai',
    languageMode: fullSettings.languageMode || fullSettings.settings?.languageMode || 'standard',
    targetLanguage: fullSettings.targetLanguage || fullSettings.settings?.targetLang || 'en',
    customLanguage: fullSettings.customLanguage || fullSettings.settings?.customLanguage || '',
    ttsProvider: fullSettings.ttsProvider || 'elevenlabs',
    elevenlabsVoiceName: fullSettings.elevenlabsVoiceName || 'Rachel',
    elevenlabsCustomVoiceId: fullSettings.elevenlabsCustomVoiceId || '',
    googleTtsVoiceName: fullSettings.googleTtsVoiceName || 'English (US) - Studio O (female)'
  };
}

/**
 * Initialize context menus on extension install
 */
export function initializeContextMenus() {
  chrome.storage.local.get([
    'settings', 'languageMode', 'targetLanguage', 'customLanguage', 'selectedProvider',
    'ttsProvider', 'elevenlabsVoice', 'elevenlabsVoiceName', 'elevenlabsCustomVoiceId',
    'googleTtsVoice', 'googleTtsVoiceName'
  ], (fullSettings) => {
    createContextMenus(getEffectiveSettings(fullSettings));
  });
}

/**
 * Hide text actions when Chrome reports a combined media+link context.
 */
export function setupContextMenuVisibilityListener() {
  if (contextMenuVisibilityListenerRegistered || !chrome.contextMenus.onShown) return;
  contextMenuVisibilityListenerRegistered = true;

  chrome.contextMenus.onShown.addListener((info) => {
    const isImageContext = info.mediaType === 'image' || (Boolean(info.srcUrl) && info.mediaType !== 'video');
    const isVideoContext = info.mediaType === 'video';
    const isMediaContext = isImageContext || isVideoContext || Boolean(info.srcUrl);
    const textToolsVisible = !isMediaContext;
    let pendingUpdates = TEXT_CONTEXT_MENU_IDS.length + 2;
    const refreshWhenDone = () => {
      pendingUpdates -= 1;
      if (pendingUpdates === 0 && chrome.contextMenus.refresh) {
        chrome.contextMenus.refresh();
      }
    };

    TEXT_CONTEXT_MENU_IDS.forEach((id) => {
      chrome.contextMenus.update(id, { visible: textToolsVisible }, () => {
        chrome.runtime.lastError;
        refreshWhenDone();
      });
    });

    chrome.contextMenus.update(CONTEXT_MENU_TRANSLATE_IMAGE, { visible: true }, () => {
      chrome.runtime.lastError;
      refreshWhenDone();
    });

    chrome.contextMenus.update(CONTEXT_MENU_TRANSLATE_VIDEO_FRAME, { visible: !isImageContext }, () => {
      chrome.runtime.lastError;
      refreshWhenDone();
    });
  });
}

/**
 * Update context menus when settings change
 */
export function setupSettingsChangeListener() {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local") {
      const relevantChanges = [
        'settings', 'languageMode', 'targetLanguage', 'customLanguage', 'selectedProvider',
        'ttsProvider', 'elevenlabsVoice', 'elevenlabsVoiceName', 'elevenlabsCustomVoiceId',
        'googleTtsVoice', 'googleTtsVoiceName'
      ];
      
      let needsUpdate = relevantChanges.some(key => changes[key]);

      if (needsUpdate) {
        chrome.storage.local.get([
          'settings', 'languageMode', 'targetLanguage', 'customLanguage', 'selectedProvider',
          'ttsProvider', 'elevenlabsVoice', 'elevenlabsVoiceName', 'elevenlabsCustomVoiceId',
          'googleTtsVoice', 'googleTtsVoiceName'
        ], (fullSettings) => {
          createContextMenus(getEffectiveSettings(fullSettings));
        });
      }
    }
  });
}
