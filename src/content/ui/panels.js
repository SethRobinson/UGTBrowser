// src/content/ui/panels.js
// Unified panel creation for lesson, ask, and translation displays

import { PANEL_CONFIGS } from '../../shared/constants.js';
import { escapeHtml, truncateText, generateSessionId } from '../../shared/utils.js';
import { simpleMarkdownToHtml } from './markdown.js';
import { createChatInterface } from './chat.js';

/**
 * Create a unified panel for lesson, ask, or translation displays
 * @param {string} type - Panel type: 'lesson', 'ask', or 'translate'
 * @param {string} originalText - The original selected text
 * @param {string} sessionId - Session ID for this panel
 * @param {Object} options - Additional options
 * @returns {HTMLElement} The created panel container
 */
export function createPanel(type, originalText, sessionId, options = {}) {
  const config = PANEL_CONFIGS[type];
  if (!config) {
    throw new Error(`Unknown panel type: ${type}`);
  }
  
  const container = document.createElement('div');
  container.className = `ugt-${type}-container`;
  container.dataset[`${type}SessionId`] = sessionId;
  
  // Apply common styling with config-driven colors
  Object.assign(container.style, {
    marginLeft: '0',
    marginTop: '16px',
    marginBottom: '16px',
    padding: '18px 22px',
    borderLeft: `4px solid ${config.accentColor}`,
    backgroundColor: config.backgroundColor,
    borderRadius: '0 10px 10px 0',
    boxShadow: `0 3px 12px ${hexToRgba(config.accentColor, 0.15)}`,
    color: '#1f2937',
    fontSize: '14px',
    lineHeight: '1.6',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    maxWidth: '100%',
    boxSizing: 'border-box'
  });
  
  // Create header
  const header = createPanelHeader(type, config, sessionId, container, options);
  container.appendChild(header);
  
  // Create original text preview
  const originalPreview = createOriginalTextPreview(originalText, config);
  container.appendChild(originalPreview);
  
  // Create content wrapper for the main content (lesson/answer)
  const contentWrapper = document.createElement('div');
  contentWrapper.className = `ugt-${type}-content`;
  contentWrapper.innerHTML = `<span style="color: #9ca3af;">${getLoadingText(type)}</span>`;
  container.appendChild(contentWrapper);
  
  return container;
}

/**
 * Create panel header with title and buttons
 */
function createPanelHeader(type, config, sessionId, container, options) {
  const header = document.createElement('div');
  header.className = `ugt-${type}-header`;
  Object.assign(header.style, {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
    paddingBottom: '10px',
    borderBottom: `1px solid ${hexToRgba(config.accentColor, 0.3)}`
  });
  
  // Title with icon
  const title = document.createElement('div');
  title.className = `ugt-${type}-title`;
  title.innerHTML = `<strong style="color: ${config.accentColor}; font-size: 15px;">${config.icon} ${config.title}</strong>`;
  
  // Button container
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '8px';
  buttonContainer.style.alignItems = 'center';
  
  // Stop button (for types that support streaming cancellation)
  if (type === 'lesson' || options.showStopButton) {
    const stopButton = createStopButton(config, sessionId, container, options.onStop);
    buttonContainer.appendChild(stopButton);
  }
  
  // Close button
  const closeButton = createCloseButton(type, sessionId, container, options.onClose);
  buttonContainer.appendChild(closeButton);
  
  header.appendChild(title);
  header.appendChild(buttonContainer);
  
  return header;
}

/**
 * Create stop button for cancelling generation
 */
function createStopButton(config, sessionId, container, onStop) {
  const stopButton = document.createElement('button');
  stopButton.className = 'ugt-panel-stop-btn';
  stopButton.textContent = 'Stop';
  Object.assign(stopButton.style, {
    padding: '6px 14px',
    backgroundColor: '#ef4444',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '13px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'background-color 0.2s'
  });
  
  stopButton.addEventListener('mouseenter', () => {
    stopButton.style.backgroundColor = '#dc2626';
  });
  stopButton.addEventListener('mouseleave', () => {
    stopButton.style.backgroundColor = '#ef4444';
  });
  
  stopButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onStop) onStop(sessionId, container, stopButton);
  });
  stopButton.addEventListener('mousedown', (e) => e.stopPropagation());
  
  return stopButton;
}

/**
 * Create close button to remove the panel
 */
function createCloseButton(type, sessionId, container, onClose) {
  const closeButton = document.createElement('button');
  closeButton.className = `ugt-${type}-close-btn`;
  closeButton.textContent = '✕';
  closeButton.title = 'Close';
  Object.assign(closeButton.style, {
    padding: '4px 8px',
    backgroundColor: 'transparent',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    fontSize: '14px',
    cursor: 'pointer',
    transition: 'all 0.2s'
  });
  
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.backgroundColor = '#fee2e2';
    closeButton.style.borderColor = '#fca5a5';
    closeButton.style.color = '#dc2626';
  });
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.backgroundColor = 'transparent';
    closeButton.style.borderColor = '#e5e7eb';
    closeButton.style.color = '#6b7280';
  });
  
  closeButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (onClose) onClose(sessionId);
    container.remove();
  });
  closeButton.addEventListener('mousedown', (e) => e.stopPropagation());
  
  return closeButton;
}

/**
 * Create original text preview section
 */
function createOriginalTextPreview(originalText, config) {
  const originalPreview = document.createElement('div');
  originalPreview.className = 'ugt-panel-original';
  Object.assign(originalPreview.style, {
    marginBottom: '14px',
    padding: '10px 14px',
    backgroundColor: hexToRgba(config.accentColor, 0.1),
    borderRadius: '6px',
    fontSize: '13px',
    color: '#374151'
  });
  
  const truncatedText = truncateText(originalText, 150);
  const label = config.title.includes('Lesson') ? 'Studying' : 'Selected';
  originalPreview.innerHTML = `<strong style="color: ${config.accentColor};">${label}:</strong> "${escapeHtml(truncatedText)}"`;
  
  return originalPreview;
}

/**
 * Update panel content during streaming
 */
export function updatePanelContent(container, content, type = 'lesson') {
  if (!container) return;
  const contentWrapper = container.querySelector(`.ugt-${type}-content`);
  if (contentWrapper) {
    contentWrapper.innerHTML = simpleMarkdownToHtml(content);
  }
}

/**
 * Create action buttons for AI messages (copy, open in new tab)
 */
export function createMessageActionButtons(rawContent, htmlContent) {
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'ugt-message-actions';
  Object.assign(actionsDiv.style, {
    display: 'flex',
    gap: '6px',
    marginTop: '8px',
    paddingTop: '8px',
    borderTop: '1px solid rgba(0,0,0,0.06)'
  });
  
  // Copy button
  const copyBtn = createActionButton('📋', 'Copy to clipboard', async () => {
    try {
      await navigator.clipboard.writeText(rawContent);
      copyBtn.innerHTML = '✓';
      copyBtn.style.color = '#10b981';
      setTimeout(() => {
        copyBtn.innerHTML = '📋';
        copyBtn.style.color = '';
      }, 1500);
    } catch (e) {
      console.error('Failed to copy:', e);
    }
  });
  actionsDiv.appendChild(copyBtn);
  
  // Open in new tab button
  const expandBtn = createActionButton('↗', 'Open in new tab', () => {
    openInNewTab(htmlContent);
  });
  actionsDiv.appendChild(expandBtn);
  
  return actionsDiv;
}

/**
 * Create an action button with consistent styling
 */
function createActionButton(icon, title, onClick) {
  const btn = document.createElement('button');
  btn.className = 'ugt-action-btn';
  btn.innerHTML = icon;
  btn.title = title;
  Object.assign(btn.style, {
    padding: '4px 8px',
    fontSize: '14px',
    backgroundColor: 'transparent',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'all 0.2s',
    lineHeight: '1'
  });
  
  btn.addEventListener('mouseenter', () => {
    btn.style.backgroundColor = '#f3f4f6';
    btn.style.borderColor = '#d1d5db';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.backgroundColor = 'transparent';
    btn.style.borderColor = '#e5e7eb';
  });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  
  return btn;
}

/**
 * Open content in a new browser tab
 */
function openInNewTab(htmlContent) {
  const newWindow = window.open('', '_blank');
  if (newWindow) {
    newWindow.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>UGTBrowser - AI Response</title>
        <meta charset="UTF-8">
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 24px 32px;
            line-height: 1.7;
            color: #374151;
            background: #ffffff;
            min-height: 100vh;
          }
          h1, h2, h3, h4, h5, h6 { color: #1f2937; margin-top: 1.2em; margin-bottom: 0.5em; }
          h1 { font-size: 1.8em; }
          h2 { font-size: 1.5em; }
          h3 { font-size: 1.25em; }
          p { margin: 0.8em 0; }
          pre { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; overflow-x: auto; margin: 1em 0; }
          code { font-family: 'Consolas', 'Monaco', monospace; }
          ul, ol { padding-left: 1.5em; margin: 0.8em 0; }
          li { margin: 0.4em 0; }
          strong { color: #1f2937; }
          a { color: #4f7cff; }
          blockquote { border-left: 4px solid #6b8afd; margin: 1em 0; padding: 0.5em 1em; background: #f8f9ff; }
          table { border-collapse: collapse; width: 100%; margin: 1em 0; }
          th, td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; }
          th { background: #f9fafb; }
          @media print { body { padding: 0; } }
        </style>
      </head>
      <body>${htmlContent}</body>
      </html>
    `);
    newWindow.document.close();
  }
}

/**
 * Get loading text based on panel type
 */
function getLoadingText(type) {
  switch (type) {
    case 'lesson': return 'Generating lesson...';
    case 'ask': return 'Thinking...';
    case 'translate': return 'Translating...';
    default: return 'Loading...';
  }
}

/**
 * Convert hex color to rgba
 */
function hexToRgba(hex, alpha) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return hex;
  return `rgba(${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}, ${alpha})`;
}

/**
 * Insert panel after the current selection
 */
export function insertPanelAfterSelection(container, savedRange) {
  let activeRange = savedRange;
  
  if (!activeRange) {
    const currentSelection = document.getSelection();
    if (currentSelection && currentSelection.rangeCount > 0) {
      activeRange = currentSelection.getRangeAt(0).cloneRange();
    }
  }
  
  if (activeRange) {
    // Find the end container of the selection
    let insertAfterElement = activeRange.endContainer;
    
    // If it's a text node, get its parent
    if (insertAfterElement.nodeType === Node.TEXT_NODE) {
      insertAfterElement = insertAfterElement.parentNode;
    }
    
    // Walk up the DOM tree to find if we're inside an anchor element
    let currentElement = insertAfterElement;
    while (currentElement && currentElement !== document.body) {
      if (currentElement.tagName === 'A') {
        insertAfterElement = currentElement;
        break;
      }
      currentElement = currentElement.parentNode;
    }
    
    // Insert the container after the element (outside any anchor)
    if (insertAfterElement && insertAfterElement.parentNode) {
      insertAfterElement.parentNode.insertBefore(container, insertAfterElement.nextSibling);
    } else {
      // Fallback: use range insertion
      const insertionRange = activeRange.cloneRange();
      insertionRange.collapse(false);
      insertionRange.insertNode(container);
    }
    
    // Clear the selection
    window.getSelection().removeAllRanges();
  } else {
    // Fallback: append to body if no range available
    console.warn('No selection range available, appending to body');
    document.body.appendChild(container);
  }
  
  // Scroll to the container
  container.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
