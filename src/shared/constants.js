// src/shared/constants.js
// Shared constants used across background, content, and options scripts

// Models that don't support temperature settings
export const noTemperatureModels = [
  "gpt-5-mini",
  "gpt-5-nano",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview"
];

// Provider model configurations
export const providerModels = {
  openai: ["gpt-5.2-pro", "gpt-5.2", "gpt-5-mini", "gpt-5-nano"],
  anthropic: ["claude-sonnet-4-5", "claude-haiku-4-5", "claude-opus-4-5"],
  gemini: ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"]
};

// Default lesson prompt template
export const defaultLessonPrompt = `Create a comprehensive lesson to help me learn about this Japanese text and its translation: "{0}"

Please include:
1. A detailed breakdown table with columns for: Japanese text, Reading (furigana), Literal meaning, and Grammar notes
2. Key vocabulary with example sentences
3. Cultural or contextual notes if relevant
4. At the end, provide 5 helpful flashcards in a clear format for memorization`;

// Unified default prompt for translation
export const unifiedDefaultPrompt = "You are a translation engine. The input text contains segments, each wrapped in XML-like tags with a unique ID, like `<ugt_some_id>Text to translate</ugt_some_id>`.\nTranslate the text content within each tag to {{target}}.\nYour output MUST consist ONLY of the translated segments, each wrapped in the EXACT SAME XML-like tags as the input.\nFor example, if the input is `<ugt_abc>Hello</ugt_abc>` and the target language is Spanish, the output must be `<ugt_abc>Hola</ugt_abc>`.\nIf there are multiple input segments, provide a corresponding translated segment for each, preserving their order and tags.\nDo not add any other text, explanations, or formatting outside of these tags.\n\nInput Text:\n{{text}}";

// Default prompts for different providers (all use the unified prompt now)
export const defaultPrompts = {
  openai: unifiedDefaultPrompt,
  anthropic: unifiedDefaultPrompt,
  gemini: unifiedDefaultPrompt
};

// Creative task default prompts (from options.js)
export const defaultCreativeTaskPrompts = {
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

// Context menu IDs
export const CONTEXT_MENU_PARENT = "ugtbrowser_parent";
export const CONTEXT_MENU_TRANSLATE = "ugtbrowser_translate";
export const CONTEXT_MENU_TRANSLATE_SIMPLE = "ugtbrowser_translate_simple";
export const CONTEXT_MENU_TRANSLATE_IMAGE = "ugtbrowser_translate_image";
export const CONTEXT_MENU_SPEAK = "ugtbrowser_speak";
export const CONTEXT_MENU_LESSON = "ugtbrowser_lesson";
export const CONTEXT_MENU_ASK = "ugtbrowser_ask";
export const CONTEXT_MENU_SETTINGS = "ugtbrowser_settings";

// TTS test phrases for different languages
export const ttsTestPhrases = {
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
  'hi': 'नमस्ते! यह टेक्स्ट टू स्पिच सिस्टम का परीक्षण है।',
  'hindi': 'नमस्ते! यह टेक्स्ट टू स्पिच सिस्टम का परीक्षण है।'
};

// Panel configurations for unified UI components
export const PANEL_CONFIGS = {
  lesson: {
    accentColor: '#10b981',
    backgroundColor: '#f0fdf4',
    icon: '📚',
    title: 'Language Lesson',
    sessionPrefix: 'lesson_'
  },
  ask: {
    accentColor: '#3b82f6',
    backgroundColor: '#eff6ff',
    icon: '💬',
    title: 'Ask About Selection',
    sessionPrefix: 'ask_'
  },
  chat: {
    accentColor: '#6b8afd',
    backgroundColor: '#f8f9ff',
    icon: '💭',
    title: 'Follow-up Chat',
    sessionPrefix: 'chat_'
  },
  translate: {
    accentColor: '#10b981',
    backgroundColor: '#ecfdf5',
    icon: '🌐',
    title: 'Translation',
    sessionPrefix: 'translate_'
  }
};
