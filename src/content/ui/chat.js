// src/content/ui/chat.js
// Unified chat interface components for lesson, ask, and translation follow-ups

import { PANEL_CONFIGS } from '../../shared/constants.js';
import { escapeHtml } from '../../shared/utils.js';
import { simpleMarkdownToHtml } from './markdown.js';
import { createMessageActionButtons } from './panels.js';

/**
 * Create a chat interface for follow-up questions
 * @param {HTMLElement} container - The parent container
 * @param {string} type - Type of chat: 'lesson', 'ask', 'chat', 'translate'
 * @param {string} sessionId - Session ID for this chat
 * @param {Object} sessionContext - Session context with chat history and state
 * @param {Object} options - Additional options
 * @returns {Object} References to created elements
 */
export function createChatInterface(container, type, sessionId, sessionContext, options = {}) {
  const config = PANEL_CONFIGS[type] || PANEL_CONFIGS.chat;
  
  // Check if chat interface already exists
  if (container.querySelector(`.ugt-${type}-chat-section`)) {
    return null;
  }
  
  // Create chat section wrapper
  const chatSection = document.createElement('div');
  chatSection.className = `ugt-${type}-chat-section`;
  Object.assign(chatSection.style, {
    marginTop: '18px',
    paddingTop: '14px',
    borderTop: `1px solid ${hexToRgba(config.accentColor, 0.3)}`
  });
  
  // Chat history area
  const chatHistory = document.createElement('div');
  chatHistory.className = `ugt-${type}-chat-history`;
  Object.assign(chatHistory.style, {
    display: 'none',
    maxHeight: '250px',
    overflowY: 'auto',
    marginBottom: '14px',
    padding: '10px',
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    borderRadius: '8px'
  });
  chatSection.appendChild(chatHistory);
  
  // Input row container
  const inputRow = document.createElement('div');
  inputRow.className = `ugt-${type}-chat-input-row`;
  Object.assign(inputRow.style, {
    display: 'flex',
    gap: '10px',
    alignItems: 'center'
  });
  
  // Text input
  const chatInput = createChatInput(type, config);
  
  // Send/Stop button
  const sendButton = createSendButton(type, config);
  
  // Set up event handlers
  setupChatEventHandlers({
    chatInput,
    sendButton,
    chatHistory,
    sessionId,
    sessionContext,
    type,
    config,
    options
  });
  
  inputRow.appendChild(chatInput);
  inputRow.appendChild(sendButton);
  chatSection.appendChild(inputRow);
  container.appendChild(chatSection);
  
  return { chatHistory, chatInput, sendButton };
}

/**
 * Create chat text input
 */
function createChatInput(type, config) {
  const chatInput = document.createElement('input');
  chatInput.type = 'text';
  chatInput.className = `ugt-${type}-chat-input`;
  chatInput.placeholder = getPlaceholder(type);
  Object.assign(chatInput.style, {
    flex: '1',
    padding: '12px 16px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    fontSize: '14px',
    fontFamily: 'inherit',
    outline: 'none',
    backgroundColor: '#ffffff',
    color: '#1f2937',
    transition: 'border-color 0.2s, box-shadow 0.2s'
  });
  
  chatInput.addEventListener('focus', () => {
    chatInput.style.borderColor = config.accentColor;
    chatInput.style.boxShadow = `0 0 0 3px ${hexToRgba(config.accentColor, 0.15)}`;
  });
  chatInput.addEventListener('blur', () => {
    chatInput.style.borderColor = '#d1d5db';
    chatInput.style.boxShadow = 'none';
  });
  chatInput.addEventListener('mousedown', (e) => e.stopPropagation());
  chatInput.addEventListener('click', (e) => e.stopPropagation());
  
  return chatInput;
}

/**
 * Create send/stop button
 */
function createSendButton(type, config) {
  const sendButton = document.createElement('button');
  sendButton.className = `ugt-${type}-chat-send`;
  sendButton.textContent = type === 'chat' ? 'Send' : 'Ask';
  Object.assign(sendButton.style, {
    padding: '12px 20px',
    backgroundColor: config.accentColor,
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
    whiteSpace: 'nowrap'
  });
  
  return sendButton;
}

/**
 * Set up event handlers for chat interface
 */
function setupChatEventHandlers({ chatInput, sendButton, chatHistory, sessionId, sessionContext, type, config, options }) {
  // Get session management functions from options
  const { getSession, onSendMessage, onCancelMessage, messageTypes } = options;
  
  // Hover effects for send button
  sendButton.addEventListener('mouseenter', () => {
    const session = getSession ? getSession(sessionId) : sessionContext;
    if (session?.isStreaming || session?.isChatStreaming) {
      sendButton.style.backgroundColor = '#dc2626';
    } else {
      sendButton.style.backgroundColor = darkenColor(config.accentColor, 0.1);
    }
  });
  
  sendButton.addEventListener('mouseleave', () => {
    const session = getSession ? getSession(sessionId) : sessionContext;
    if (session?.isStreaming || session?.isChatStreaming) {
      sendButton.style.backgroundColor = '#ef4444';
    } else {
      sendButton.style.backgroundColor = config.accentColor;
    }
  });
  
  // Cancel handler
  const cancelRequest = () => {
    const session = getSession ? getSession(sessionId) : sessionContext;
    if (!session || (!session.isStreaming && !session.isChatStreaming)) return;
    
    if (session.cancelRequested !== undefined) session.cancelRequested = true;
    if (session.chatCancelRequested !== undefined) session.chatCancelRequested = true;
    
    // Call cancel handler
    if (onCancelMessage) {
      onCancelMessage(sessionId, chatHistory, session);
    }
    
    // Find the streaming message and mark it as cancelled
    const streamingMsg = chatHistory.querySelector(`[data-streaming="true"][data-session-id="${sessionId}"]`);
    if (streamingMsg) {
      const currentContent = streamingMsg.dataset.content || session.currentContent || '';
      const cancelledContent = currentContent + (currentContent ? '\n\n' : '') + '_[Generation stopped by user]_';
      finishChatResponse(streamingMsg, cancelledContent, false, sessionId, type, config, getSession);
    }
    
    resetChatInputState(chatInput, sendButton, sessionId, type, config, getSession);
  };
  
  // Send handler
  const sendMessage = () => {
    const question = chatInput.value.trim();
    const session = getSession ? getSession(sessionId) : sessionContext;
    if (!question || !session || session.isStreaming || session.isChatStreaming) return;
    
    // Reset cancel flags
    if (session.cancelRequested !== undefined) session.cancelRequested = false;
    if (session.chatCancelRequested !== undefined) session.chatCancelRequested = false;
    
    // Initialize chat history if needed
    if (!session.chatHistory) session.chatHistory = [];
    
    // Add user message to history display
    addChatMessage(chatHistory, 'user', question, sessionId, type, config);
    session.chatHistory.push({ role: 'user', content: question });
    
    // Clear input
    chatInput.value = '';
    
    // Show loading state - transform to Stop button
    if (session.isChatStreaming !== undefined) {
      session.isChatStreaming = true;
    } else {
      session.isStreaming = true;
    }
    session.currentContent = '';
    
    sendButton.textContent = 'Stop';
    sendButton.style.backgroundColor = '#ef4444';
    sendButton.style.cursor = 'pointer';
    sendButton.title = 'Stop generation';
    chatInput.disabled = true;
    
    // Create placeholder for assistant response
    const assistantMsgDiv = addChatMessage(chatHistory, 'assistant', '', sessionId, type, config);
    assistantMsgDiv.dataset.streaming = 'true';
    assistantMsgDiv.dataset.sessionId = sessionId;
    
    // Call send handler
    if (onSendMessage) {
      onSendMessage(sessionId, question, session, assistantMsgDiv, () => {
        resetChatInputState(chatInput, sendButton, sessionId, type, config, getSession);
      });
    }
  };
  
  // Button click - send or stop
  sendButton.addEventListener('click', (e) => {
    e.stopPropagation();
    const session = getSession ? getSession(sessionId) : sessionContext;
    if (session && (session.isStreaming || session.isChatStreaming)) {
      cancelRequest();
    } else {
      sendMessage();
    }
  });
  sendButton.addEventListener('mousedown', (e) => e.stopPropagation());
  
  // Enter key to send
  chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      sendMessage();
    }
  });
}

/**
 * Add a message to the chat history
 */
export function addChatMessage(historyContainer, role, content, sessionId, type, config) {
  // Show history container if hidden
  historyContainer.style.display = 'block';
  
  const msgDiv = document.createElement('div');
  msgDiv.className = `ugt-${type}-chat-message ugt-${type}-chat-${role}`;
  Object.assign(msgDiv.style, {
    marginBottom: '12px',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '13px',
    lineHeight: '1.5'
  });
  
  if (role === 'user') {
    const userBgColor = getUserBackgroundColor(type);
    Object.assign(msgDiv.style, {
      backgroundColor: userBgColor,
      marginLeft: '24px',
      borderBottomRightRadius: '2px'
    });
    const userLabelColor = getUserLabelColor(type);
    msgDiv.innerHTML = `<strong style="color: ${userLabelColor};">You:</strong> ${escapeHtml(content)}`;
  } else {
    Object.assign(msgDiv.style, {
      backgroundColor: '#f3f4f6',
      marginRight: '24px',
      borderBottomLeftRadius: '2px'
    });
    if (content) {
      msgDiv.innerHTML = `<strong style="color: ${config.accentColor};">AI:</strong> ${simpleMarkdownToHtml(content)}`;
    } else {
      msgDiv.innerHTML = `<strong style="color: ${config.accentColor};">AI:</strong> <span style="color: #9ca3af;">Thinking...</span>`;
    }
  }
  
  historyContainer.appendChild(msgDiv);
  historyContainer.scrollTop = historyContainer.scrollHeight;
  
  return msgDiv;
}

/**
 * Update streaming message content
 */
export function updateChatStreamingMessage(msgDiv, content, config) {
  if (!msgDiv) return;
  msgDiv.innerHTML = `<strong style="color: ${config.accentColor};">AI:</strong> ${simpleMarkdownToHtml(content)}`;
  msgDiv.dataset.content = content;
  
  const historyContainer = msgDiv.parentElement;
  if (historyContainer) {
    const isNearBottom = historyContainer.scrollHeight - historyContainer.scrollTop - historyContainer.clientHeight < 100;
    if (isNearBottom) {
      historyContainer.scrollTop = historyContainer.scrollHeight;
    }
  }
}

/**
 * Finish chat response
 */
export function finishChatResponse(msgDiv, content, isError, sessionId, type, config, getSession) {
  if (!msgDiv) return;
  
  const htmlContent = simpleMarkdownToHtml(content);
  
  if (isError) {
    msgDiv.innerHTML = `<strong style="color: #ef4444;">Error:</strong> <span style="color: #ef4444;">${escapeHtml(content)}</span>`;
  } else {
    // Create content wrapper
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'ugt-message-content';
    contentWrapper.innerHTML = `<strong style="color: ${config.accentColor};">AI:</strong> ${htmlContent}`;
    
    // Clear and rebuild the message div
    msgDiv.innerHTML = '';
    msgDiv.appendChild(contentWrapper);
    
    // Add action buttons for non-error responses
    const actionButtons = createMessageActionButtons(content, htmlContent);
    msgDiv.appendChild(actionButtons);
  }
  
  // Remove streaming flags
  msgDiv.removeAttribute('data-streaming');
  msgDiv.removeAttribute('data-content');
  
  // Update session state
  const session = getSession ? getSession(sessionId) : null;
  if (session) {
    if (session.isChatStreaming !== undefined) {
      session.isChatStreaming = false;
    }
    if (session.isStreaming !== undefined) {
      session.isStreaming = false;
    }
  }
  
  const historyContainer = msgDiv.parentElement;
  if (historyContainer) {
    historyContainer.scrollTop = historyContainer.scrollHeight;
  }
}

/**
 * Reset chat input state after response
 */
export function resetChatInputState(chatInput, sendButton, sessionId, type, config, getSession) {
  const session = getSession ? getSession(sessionId) : null;
  if (session) {
    if (session.isChatStreaming !== undefined) session.isChatStreaming = false;
    if (session.isStreaming !== undefined) session.isStreaming = false;
    if (session.cancelRequested !== undefined) session.cancelRequested = false;
    if (session.chatCancelRequested !== undefined) session.chatCancelRequested = false;
  }
  
  chatInput.disabled = false;
  sendButton.textContent = type === 'chat' ? 'Send' : 'Ask';
  sendButton.style.backgroundColor = config.accentColor;
  sendButton.style.cursor = 'pointer';
  sendButton.title = '';
  chatInput.focus();
}

/**
 * Get placeholder text based on type
 */
function getPlaceholder(type) {
  switch (type) {
    case 'lesson': return 'Ask a follow-up question about this lesson...';
    case 'ask': return 'Ask a question about this text...';
    case 'translate': return 'Ask about this translation...';
    default: return 'Ask a follow-up question...';
  }
}

/**
 * Get user message background color based on type
 */
function getUserBackgroundColor(type) {
  switch (type) {
    case 'lesson': return '#d1fae5';
    case 'ask': return '#dbeafe';
    case 'translate': return '#d1fae5';
    default: return '#e8edff';
  }
}

/**
 * Get user label color based on type
 */
function getUserLabelColor(type) {
  switch (type) {
    case 'lesson': return '#047857';
    case 'ask': return '#1d4ed8';
    case 'translate': return '#047857';
    default: return '#4f5d95';
  }
}

/**
 * Darken a hex color by a percentage
 */
function darkenColor(hex, percent) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  
  const r = Math.max(0, parseInt(result[1], 16) - Math.round(255 * percent));
  const g = Math.max(0, parseInt(result[2], 16) - Math.round(255 * percent));
  const b = Math.max(0, parseInt(result[3], 16) - Math.round(255 * percent));
  
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Convert hex color to rgba
 */
function hexToRgba(hex, alpha) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
}
