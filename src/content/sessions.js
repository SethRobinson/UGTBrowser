// src/content/sessions.js
// Session management for chat, lesson, and ask features

import { generateSessionId } from '../shared/utils.js';

// ========================================
// SESSION STORAGE
// ========================================

// Active lesson sessions
const lessonSessions = new Map();

// Active ask sessions
const askSessions = new Map();

// Active chat (translation follow-up) sessions
const chatSessions = new Map();

// ========================================
// LESSON SESSIONS
// ========================================

/**
 * Create a new lesson session
 */
export function createLessonSession(selectedText, lessonPrompt) {
  const sessionId = generateSessionId('lesson');
  const session = {
    sessionId,
    selectedText,
    lessonPrompt,
    lessonContent: '',
    chatHistory: [],
    isStreaming: true,
    isChatStreaming: false,
    cancelRequested: false,
    chatCancelRequested: false,
    panelContainer: null,
    currentContent: '',
    savedRange: null
  };
  lessonSessions.set(sessionId, session);
  return session;
}

/**
 * Get a lesson session by ID
 */
export function getLessonSession(sessionId) {
  return lessonSessions.get(sessionId);
}

/**
 * Update lesson session content
 */
export function updateLessonContent(sessionId, content, append = true) {
  const session = lessonSessions.get(sessionId);
  if (session) {
    if (append) {
      session.lessonContent += content;
    } else {
      session.lessonContent = content;
    }
    session.currentContent = session.lessonContent;
  }
  return session;
}

/**
 * Remove a lesson session
 */
export function removeLessonSession(sessionId) {
  lessonSessions.delete(sessionId);
}

/**
 * Get all active lesson sessions
 */
export function getAllLessonSessions() {
  return lessonSessions;
}

// ========================================
// ASK SESSIONS
// ========================================

/**
 * Create a new ask session
 */
export function createAskSession(selectedText) {
  const sessionId = generateSessionId('ask');
  const session = {
    sessionId,
    selectedText,
    responseContent: '',
    chatHistory: [],
    isStreaming: true,
    cancelRequested: false,
    panelContainer: null,
    currentContent: '',
    savedRange: null
  };
  askSessions.set(sessionId, session);
  return session;
}

/**
 * Get an ask session by ID
 */
export function getAskSession(sessionId) {
  return askSessions.get(sessionId);
}

/**
 * Update ask session content
 */
export function updateAskContent(sessionId, content, append = true) {
  const session = askSessions.get(sessionId);
  if (session) {
    if (append) {
      session.responseContent += content;
    } else {
      session.responseContent = content;
    }
    session.currentContent = session.responseContent;
  }
  return session;
}

/**
 * Remove an ask session
 */
export function removeAskSession(sessionId) {
  askSessions.delete(sessionId);
}

/**
 * Get all active ask sessions
 */
export function getAllAskSessions() {
  return askSessions;
}

// ========================================
// CHAT (TRANSLATION FOLLOW-UP) SESSIONS
// ========================================

/**
 * Create a new chat session for translation follow-ups
 */
export function createChatSession(translationData) {
  const sessionId = generateSessionId('chat');
  const session = {
    sessionId,
    originalText: translationData.originalText || '',
    translatedText: translationData.translatedText || '',
    culturalNuances: translationData.culturalNuances || '',
    chatHistory: [],
    isStreaming: false,
    cancelRequested: false,
    panelContainer: null,
    currentContent: ''
  };
  chatSessions.set(sessionId, session);
  return session;
}

/**
 * Get a chat session by ID
 */
export function getChatSession(sessionId) {
  return chatSessions.get(sessionId);
}

/**
 * Update chat session with new message
 */
export function addChatMessage(sessionId, role, content) {
  const session = chatSessions.get(sessionId);
  if (session) {
    session.chatHistory.push({ role, content });
  }
  return session;
}

/**
 * Remove a chat session
 */
export function removeChatSession(sessionId) {
  chatSessions.delete(sessionId);
}

/**
 * Get all active chat sessions
 */
export function getAllChatSessions() {
  return chatSessions;
}

// ========================================
// GENERIC SESSION HELPERS
// ========================================

/**
 * Find session by panel container element
 */
export function findSessionByContainer(container) {
  // Check lesson sessions
  for (const [sessionId, session] of lessonSessions) {
    if (session.panelContainer === container) {
      return { type: 'lesson', session };
    }
  }
  
  // Check ask sessions
  for (const [sessionId, session] of askSessions) {
    if (session.panelContainer === container) {
      return { type: 'ask', session };
    }
  }
  
  // Check chat sessions
  for (const [sessionId, session] of chatSessions) {
    if (session.panelContainer === container) {
      return { type: 'chat', session };
    }
  }
  
  return null;
}

/**
 * Clean up orphaned sessions (panels no longer in DOM)
 */
export function cleanupOrphanedSessions() {
  // Clean up lesson sessions
  for (const [sessionId, session] of lessonSessions) {
    if (session.panelContainer && !document.contains(session.panelContainer)) {
      lessonSessions.delete(sessionId);
    }
  }
  
  // Clean up ask sessions
  for (const [sessionId, session] of askSessions) {
    if (session.panelContainer && !document.contains(session.panelContainer)) {
      askSessions.delete(sessionId);
    }
  }
  
  // Clean up chat sessions
  for (const [sessionId, session] of chatSessions) {
    if (session.panelContainer && !document.contains(session.panelContainer)) {
      chatSessions.delete(sessionId);
    }
  }
}

/**
 * Cancel all active streaming sessions
 */
export function cancelAllStreamingSessions() {
  for (const [sessionId, session] of lessonSessions) {
    if (session.isStreaming || session.isChatStreaming) {
      session.cancelRequested = true;
      session.chatCancelRequested = true;
    }
  }
  
  for (const [sessionId, session] of askSessions) {
    if (session.isStreaming) {
      session.cancelRequested = true;
    }
  }
  
  for (const [sessionId, session] of chatSessions) {
    if (session.isStreaming) {
      session.cancelRequested = true;
    }
  }
}
