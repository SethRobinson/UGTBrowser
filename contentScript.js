// UGTBrowser content script initialization

// Only initialize if not already initialized (to prevent duplicate variables)
if (typeof window.ugtBrowserInitialized === 'undefined') {
  window.ugtBrowserInitialized = true;
  
  let lastSelection = null;
  let savedRange = null;
  let overlayDiv = null;
  let overlayStart = 0;
  const ACTIVE_SPAN_CLASS = "ugtb-tgt";
  let animationInterval = null;
  let timerInterval = null;
  let streamingPort = null;
  let lastActivityTime = 0;
  let streamHeartbeatInterval = null;
  let currentStreamingText = "";
  let currentTranslationSettings = null; // Added to store current translation settings
  let streamingActiveFrags = null;
  let streamingRange = null;
  let lastProcessTime = 0;
  let initialInsertionHasOccurred = false; // Flag for initial DOM insertion
  let errorModalDiv = null; // For the custom error modal
  let lastTranslatedElement = null; // To track the last element where translation was inserted
  let currentTranslationBatchId = null; // Track current translation batch for toggle feature
  
  // TTS-specific variables
  let ttsOverlayDiv = null;
  let ttsAudioElement = null;

  // Chat context for follow-up questions - now stored per-session to support multiple concurrent chats
  const chatSessions = new Map(); // Map of sessionId -> { originalText, culturalNuances, chatHistory, container, isStreaming, providerName }
  
  // Generate a unique session ID for chat
  function generateChatSessionId() {
    return 'chat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
  }

  // NEW: Class name for our translation segments/placeholders
  const UGT_SEGMENT_CLASS = "ugt-translation-segment";

  // Helper function to convert markdown to HTML for cultural nuances and chat display
  function simpleMarkdownToHtml(text) {
    if (!text) return '';
    
    // Use Unicode markers for placeholders to avoid conflicts with markdown syntax
    // These characters are extremely unlikely to appear in normal text
    const PH_START = '\u2987'; // ⦇
    const PH_END = '\u2988';   // ⦈
    
    // First, extract and protect code blocks before any other processing
    const codeBlockPlaceholders = [];
    let protectedText = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
      const placeholder = `${PH_START}CODEBLOCK${codeBlockPlaceholders.length}${PH_END}`;
      codeBlockPlaceholders.push({ lang, code: code.trim() });
      return placeholder;
    });
    
    // Protect inline code
    const inlineCodePlaceholders = [];
    protectedText = protectedText.replace(/`([^`]+)`/g, (match, code) => {
      const placeholder = `${PH_START}INLINECODE${inlineCodePlaceholders.length}${PH_END}`;
      inlineCodePlaceholders.push(code);
      return placeholder;
    });
    
    // Extract and protect markdown links before escaping HTML
    const linkPlaceholders = [];
    protectedText = protectedText.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
      const placeholder = `${PH_START}LINK${linkPlaceholders.length}${PH_END}`;
      linkPlaceholders.push({ text: linkText, url: url });
      return placeholder;
    });
    
    // Also protect plain URLs (http/https) that aren't already in markdown links
    const urlPlaceholders = [];
    protectedText = protectedText.replace(/(?<![\[(])(https?:\/\/[^\s<>\[\]()]+)/g, (match, url) => {
      const placeholder = `${PH_START}URL${urlPlaceholders.length}${PH_END}`;
      urlPlaceholders.push(url);
      return placeholder;
    });
    
    // Escape HTML special characters (for safety)
    let html = protectedText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    
    // IMPORTANT: Apply inline formatting BEFORE restoring placeholders
    // Placeholders now use Unicode markers (⦇⦈) that won't conflict with markdown
    
    // Convert **bold** to <strong>
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Convert __bold__ to <strong>
    html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');
    
    // Convert _italic_ to <em>
    html = html.replace(/(?<![_\w])_([^_]+)_(?![_\w])/g, '<em>$1</em>');
    
    // Convert *italic* to <em> (but not at start of line to avoid bullet conflicts)
    html = html.replace(/(?<!^|\n|\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    
    // Convert ~~strikethrough~~ to <del>
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
    
    // NOW restore all placeholders after formatting is complete
    
    // Restore code blocks with styling
    codeBlockPlaceholders.forEach((block, index) => {
      const placeholder = `${PH_START}CODEBLOCK${index}${PH_END}`;
      const escapedCode = block.code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html = html.replace(placeholder, `<pre style="background: #1e1e1e; color: #d4d4d4; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: 'Consolas', 'Monaco', monospace; font-size: 13px; line-height: 1.4; margin: 8px 0;"><code>${escapedCode}</code></pre>`);
    });
    
    // Restore inline code with styling
    inlineCodePlaceholders.forEach((code, index) => {
      const placeholder = `${PH_START}INLINECODE${index}${PH_END}`;
      const escapedCode = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      html = html.replace(placeholder, `<code style="background: rgba(0,0,0,0.08); padding: 2px 6px; border-radius: 4px; font-family: 'Consolas', 'Monaco', monospace; font-size: 0.9em;">${escapedCode}</code>`);
    });
    
    // Restore markdown links as actual HTML links
    linkPlaceholders.forEach((link, index) => {
      const placeholder = `${PH_START}LINK${index}${PH_END}`;
      const safeUrl = link.url.replace(/&amp;/g, '&'); // Unescape & in URLs
      const safeText = link.text; // Text was already escaped
      html = html.replace(placeholder, `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #4f7cff; text-decoration: underline; cursor: pointer;">${safeText}</a>`);
    });
    
    // Restore plain URLs as clickable links
    urlPlaceholders.forEach((url, index) => {
      const placeholder = `${PH_START}URL${index}${PH_END}`;
      const safeUrl = url.replace(/&amp;/g, '&'); // Unescape & in URLs
      const displayUrl = url.length > 50 ? url.substring(0, 47) + '...' : url;
      html = html.replace(placeholder, `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color: #4f7cff; text-decoration: underline; cursor: pointer;">${displayUrl}</a>`);
    });
    
    // Split into lines for block-level processing
    const lines = html.split('\n');
    const processedLines = [];
    let inUnorderedList = false;
    let inOrderedList = false;
    let inBlockquote = false;
    
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim();
      
      // Check for headers (# ## ### #### ##### ######)
      const headerMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headerMatch) {
        if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
        if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
        if (inBlockquote) { processedLines.push('</blockquote>'); inBlockquote = false; }
        
        const level = headerMatch[1].length;
        const headerText = headerMatch[2];
        const sizes = { 1: '1.6em', 2: '1.4em', 3: '1.2em', 4: '1.1em', 5: '1em', 6: '0.95em' };
        const weights = { 1: '700', 2: '700', 3: '600', 4: '600', 5: '600', 6: '500' };
        processedLines.push(`<h${level} style="font-size: ${sizes[level]}; font-weight: ${weights[level]}; margin: 12px 0 8px 0; color: #1a1a2e;">${headerText}</h${level}>`);
        continue;
      }
      
      // Check for horizontal rule (---, ***, ___)
      if (/^([-*_]){3,}$/.test(line)) {
        if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
        if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
        if (inBlockquote) { processedLines.push('</blockquote>'); inBlockquote = false; }
        processedLines.push('<hr style="border: none; border-top: 1px solid #d1d5db; margin: 12px 0;">');
        continue;
      }
      
      // Check for blockquote (>)
      const blockquoteMatch = line.match(/^&gt;\s*(.*)$/);
      if (blockquoteMatch) {
        if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
        if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
        if (!inBlockquote) {
          processedLines.push('<blockquote style="border-left: 4px solid #6b8afd; margin: 8px 0; padding: 8px 16px; background: rgba(107, 138, 253, 0.05); color: #4a5568; font-style: italic;">');
          inBlockquote = true;
        }
        processedLines.push(`<p style="margin: 4px 0;">${blockquoteMatch[1] || '&nbsp;'}</p>`);
        continue;
      } else if (inBlockquote) {
        processedLines.push('</blockquote>');
        inBlockquote = false;
      }
      
      // Check for ordered list (1. 2. 3. etc)
      const orderedMatch = line.match(/^(\d+)\.\s+(.+)$/);
      if (orderedMatch) {
        if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
        if (!inOrderedList) {
          processedLines.push('<ol style="margin: 8px 0 8px 20px; padding-left: 0;">');
          inOrderedList = true;
        }
        processedLines.push(`<li style="margin: 4px 0;">${orderedMatch[2]}</li>`);
        continue;
      }
      
      // Check for unordered list / bullet points (*, -, •)
      const bulletMatch = line.match(/^[\*\-•]\s+(.+)$/);
      if (bulletMatch) {
        if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
        if (!inUnorderedList) {
          processedLines.push('<ul style="margin: 8px 0 8px 20px; padding-left: 0;">');
          inUnorderedList = true;
        }
        processedLines.push(`<li style="margin: 4px 0;">${bulletMatch[1]}</li>`);
        continue;
      }
      
      // Close any open lists for non-list content
      if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
      if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
      
      if (line === '') {
        // Empty line - add spacing
        processedLines.push('<div style="height: 8px;"></div>');
      } else {
        // Regular paragraph
        processedLines.push(`<p style="margin: 6px 0;">${line}</p>`);
      }
    }
    
    // Close any remaining open tags
    if (inUnorderedList) processedLines.push('</ul>');
    if (inOrderedList) processedLines.push('</ol>');
    if (inBlockquote) processedLines.push('</blockquote>');
    
    return processedLines.join('');
  }

  // Function to create the chat interface for follow-up questions
  function createChatInterface(container, culturalNuancesText) {
    // Generate a unique session ID for this chat interface
    const sessionId = generateChatSessionId();
    
    // Store session context
    const sessionContext = {
      originalText: '', // Will be set later when translation completes
      culturalNuances: culturalNuancesText,
      chatHistory: [],
      container: container,
      isStreaming: false,
      providerName: ''
    };
    chatSessions.set(sessionId, sessionContext);
    
    // Store session ID on the container for lookup
    container.dataset.chatSessionId = sessionId;
    
    // Create chat section wrapper
    const chatSection = document.createElement('div');
    chatSection.className = 'ugt-chat-section';
    Object.assign(chatSection.style, {
      marginTop: '16px',
      paddingTop: '12px',
      borderTop: '1px solid rgba(107, 138, 253, 0.3)'
    });
    
    // Chat history area (initially hidden, shows when there's history)
    const chatHistory = document.createElement('div');
    chatHistory.className = 'ugt-chat-history';
    Object.assign(chatHistory.style, {
      display: 'none',
      maxHeight: '200px',
      overflowY: 'auto',
      marginBottom: '12px',
      padding: '8px',
      backgroundColor: 'rgba(255, 255, 255, 0.5)',
      borderRadius: '6px'
    });
    chatSection.appendChild(chatHistory);
    
    // Input row container
    const inputRow = document.createElement('div');
    inputRow.className = 'ugt-chat-input-row';
    Object.assign(inputRow.style, {
      display: 'flex',
      gap: '8px',
      alignItems: 'center'
    });
    
    // Text input
    const chatInput = document.createElement('input');
    chatInput.type = 'text';
    chatInput.className = 'ugt-chat-input';
    chatInput.placeholder = 'Ask a follow-up question...';
    Object.assign(chatInput.style, {
      flex: '1',
      padding: '10px 14px',
      border: '1px solid #d1d5db',
      borderRadius: '8px',
      fontSize: '14px',
      fontFamily: 'inherit',
      outline: 'none',
      backgroundColor: '#ffffff',
      color: '#1f2937',
      transition: 'border-color 0.2s, box-shadow 0.2s'
    });
    
    // Focus styles
    chatInput.addEventListener('focus', () => {
      chatInput.style.borderColor = '#6b8afd';
      chatInput.style.boxShadow = '0 0 0 3px rgba(107, 138, 253, 0.15)';
    });
    chatInput.addEventListener('blur', () => {
      chatInput.style.borderColor = '#d1d5db';
      chatInput.style.boxShadow = 'none';
    });
    
    // Send button
    const sendButton = document.createElement('button');
    sendButton.className = 'ugt-chat-send';
    sendButton.textContent = 'Send';
    Object.assign(sendButton.style, {
      padding: '10px 18px',
      backgroundColor: '#6b8afd',
      color: '#ffffff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background-color 0.2s',
      whiteSpace: 'nowrap'
    });
    
    sendButton.addEventListener('mouseenter', () => {
      const currentSession = chatSessions.get(sessionId);
      if (!currentSession?.isStreaming) {
        sendButton.style.backgroundColor = '#5a7be0';
      }
    });
    sendButton.addEventListener('mouseleave', () => {
      const currentSession = chatSessions.get(sessionId);
      if (!currentSession?.isStreaming) {
        sendButton.style.backgroundColor = '#6b8afd';
      }
    });
    
    // Handle send action
    const sendMessage = () => {
      const question = chatInput.value.trim();
      
      // Get the session context for this chat interface
      const currentSession = chatSessions.get(sessionId);
      if (!question || !currentSession || currentSession.isStreaming) return;
      
      // Add user message to history
      addChatMessage(chatHistory, 'user', question, sessionId);
      currentSession.chatHistory.push({ role: 'user', content: question });
      
      // Clear input
      chatInput.value = '';
      
      // Show loading state
      currentSession.isStreaming = true;
      sendButton.textContent = '...';
      sendButton.style.backgroundColor = '#9ca3af';
      sendButton.style.cursor = 'not-allowed';
      chatInput.disabled = true;
      
      // Create placeholder for assistant response
      const assistantMsgDiv = addChatMessage(chatHistory, 'assistant', '', sessionId);
      assistantMsgDiv.dataset.streaming = 'true';
      assistantMsgDiv.dataset.sessionId = sessionId; // Tag with session ID for routing
      
      // Send to background script with session ID
      chrome.runtime.sendMessage({
        type: 'CHAT_FOLLOWUP',
        payload: {
          sessionId: sessionId, // Include session ID for response routing
          question: question,
          originalText: currentSession.originalText,
          culturalNuances: currentSession.culturalNuances,
          chatHistory: currentSession.chatHistory.slice(0, -1) // Exclude the question we just added
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Chat followup error:', chrome.runtime.lastError);
          finishChatResponse(assistantMsgDiv, 'Error: ' + chrome.runtime.lastError.message, true, sessionId);
          resetChatInputState(chatInput, sendButton, sessionId);
        }
      });
    };
    
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendMessage();
      }
    });
    
    inputRow.appendChild(chatInput);
    inputRow.appendChild(sendButton);
    chatSection.appendChild(inputRow);
    
    container.appendChild(chatSection);
    
    return { chatHistory, chatInput, sendButton };
  }
  
  // Add a message to the chat history
  function addChatMessage(historyContainer, role, content, sessionId = null) {
    // Show history container if hidden
    historyContainer.style.display = 'block';
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `ugt-chat-message ugt-chat-${role}`;
    Object.assign(msgDiv.style, {
      marginBottom: '10px',
      padding: '8px 12px',
      borderRadius: '8px',
      fontSize: '13px',
      lineHeight: '1.5'
    });
    
    if (role === 'user') {
      Object.assign(msgDiv.style, {
        backgroundColor: '#e8edff',
        marginLeft: '20px',
        borderBottomRightRadius: '2px'
      });
      msgDiv.innerHTML = `<strong style="color: #4f5d95;">You:</strong> ${escapeHtml(content)}`;
    } else {
      Object.assign(msgDiv.style, {
        backgroundColor: '#f3f4f6',
        marginRight: '20px',
        borderBottomLeftRadius: '2px'
      });
      if (content) {
        msgDiv.innerHTML = `<strong style="color: #6b8afd;">AI:</strong> ${simpleMarkdownToHtml(content)}`;
      } else {
        // Get provider name from session context if available
        const sessionContext = sessionId ? chatSessions.get(sessionId) : null;
        const providerDisplay = sessionContext?.providerName || 'AI';
        msgDiv.innerHTML = `<strong style="color: #6b8afd;">AI:</strong> <span class="ugt-chat-streaming" style="color: #9ca3af;">Waiting for ${providerDisplay} to respond...</span>`;
      }
    }
    
    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
    
    return msgDiv;
  }
  
  // Update streaming message content
  function updateChatStreamingMessage(msgDiv, content) {
    if (!msgDiv) return;
    msgDiv.innerHTML = `<strong style="color: #6b8afd;">AI:</strong> ${simpleMarkdownToHtml(content)}`;
    const historyContainer = msgDiv.parentElement;
    if (historyContainer) {
      historyContainer.scrollTop = historyContainer.scrollHeight;
    }
  }
  
  // Finish chat response (success or error)
  function finishChatResponse(msgDiv, content, isError = false, sessionId = null) {
    if (!msgDiv) return;
    
    if (isError) {
      msgDiv.innerHTML = `<strong style="color: #ef4444;">Error:</strong> <span style="color: #ef4444;">${escapeHtml(content)}</span>`;
    } else {
      msgDiv.innerHTML = `<strong style="color: #6b8afd;">AI:</strong> ${simpleMarkdownToHtml(content)}`;
    }
    
    delete msgDiv.dataset.streaming;
    delete msgDiv.dataset.sessionId;
    const historyContainer = msgDiv.parentElement;
    if (historyContainer) {
      historyContainer.scrollTop = historyContainer.scrollHeight;
    }
  }
  
  // Reset chat input state after response
  function resetChatInputState(chatInput, sendButton, sessionId = null) {
    // Reset streaming state in session context
    if (sessionId) {
      const sessionContext = chatSessions.get(sessionId);
      if (sessionContext) {
        sessionContext.isStreaming = false;
      }
    }
    sendButton.textContent = 'Send';
    sendButton.style.backgroundColor = '#6b8afd';
    sendButton.style.cursor = 'pointer';
    chatInput.disabled = false;
    chatInput.focus();
  }
  
  // Escape HTML for safe display
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Helper function to get the content of the innermost/last valid segment for a given ID
  function getInnermostTranslatedSegment(originalId, contentBlock, segmentRegex) {
    let lastMatchingContentForId = null;
    let match;
    
    // Create a temporary regex object if the passed one has global flag, 
    // to avoid state issues if this function is called in a loop that also uses the same global regex.
    // Or, ensure segmentRegex passed is always a new instance for this local search.
    // For now, assuming segmentRegex can be reused if lastIndex is managed.
    const localRegex = new RegExp(segmentRegex.source, segmentRegex.flags.replace('g', '') + 'g'); // Ensure it has 'g' for exec loop

    while ((match = localRegex.exec(contentBlock)) !== null) {
        if (match[1] === originalId) {
            lastMatchingContentForId = match[2]; // Keep track of the latest content for this originalId
        }
    }
    
    // If we found specific content for the originalId, return that. Otherwise, return the original block.
    return lastMatchingContentForId !== null ? lastMatchingContentForId : contentBlock;
  }

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
  }

  // Helper function to create the "Toggle All" button for switching between original and translated text
  function createToggleAllButton(batchId) {
    const btn = document.createElement('button');
    btn.className = 'ugt-toggle-all-btn';
    btn.textContent = '⇄ Show Original';
    btn.setAttribute('data-showing', 'translated');
    btn.setAttribute('data-batch-id', batchId);
    
    Object.assign(btn.style, {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      marginLeft: '10px',
      marginTop: '12px',
      marginBottom: '8px',
      padding: '6px 14px',
      fontSize: '13px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '500',
      color: '#6b8afd',
      backgroundColor: 'rgba(107, 138, 253, 0.08)',
      border: '1px solid rgba(107, 138, 253, 0.25)',
      borderRadius: '16px',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      lineHeight: '1.4'
    });
    
    // Hover effects
    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = 'rgba(107, 138, 253, 0.15)';
      btn.style.borderColor = 'rgba(107, 138, 253, 0.4)';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = 'rgba(107, 138, 253, 0.08)';
      btn.style.borderColor = 'rgba(107, 138, 253, 0.25)';
    });
    
    // Click handler for toggling all segments
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleAllTranslations(batchId, btn);
    });
    
    return btn;
  }

  // Toggle all translations in a batch between original and translated text
  function toggleAllTranslations(batchId, btn) {
    const segments = document.querySelectorAll(`span.${UGT_SEGMENT_CLASS}[data-ugt-batch="${batchId}"]`);
    const currentlyShowing = btn.getAttribute('data-showing');
    
    segments.forEach(span => {
      const originalText = span.getAttribute('data-original-text');
      const translatedText = span.getAttribute('data-translated-text');
      
      // Skip segments that didn't actually change
      if (!translatedText || originalText.trim() === translatedText.trim()) return;
      
      if (currentlyShowing === 'translated') {
        // Switch to showing original
        span.textContent = originalText;
      } else {
        // Switch to showing translated
        span.textContent = translatedText;
      }
    });
    
    // Update button state
    if (currentlyShowing === 'translated') {
      btn.textContent = '⇄ Show Translation';
      btn.setAttribute('data-showing', 'original');
    } else {
      btn.textContent = '⇄ Show Original';
      btn.setAttribute('data-showing', 'translated');
    }
  }

  // Check if any segments in a batch actually changed and need a toggle
  function batchHasChangedSegments(batchId) {
    const segments = document.querySelectorAll(`span.${UGT_SEGMENT_CLASS}[data-ugt-batch="${batchId}"]`);
    for (const span of segments) {
      const originalText = span.getAttribute('data-original-text');
      const translatedText = span.getAttribute('data-translated-text');
      if (translatedText && originalText.trim() !== translatedText.trim()) {
        return true;
      }
    }
    return false;
  }

  // NEW: Helper function to check for Asian languages that don't use spaces
  function TargetLanguageIsAnAsianLanguageThatDoesntUseSpaces(targetLang) {
    if (!targetLang) return false; // Default to space-using if lang is unknown or not provided
    const lang = targetLang.toLowerCase();
    // List of common language codes/names for CJKT languages + Vietnamese
    const asianLanguagesWithoutSpaces = [
      'ja', 'japanese', // Japanese
      'zh', 'chinese', // Chinese (covers various dialects like Mandarin, Cantonese)
      'ko', 'korean',  // Korean
      'th', 'thai',    // Thai
      'vi', 'vietnamese' // Vietnamese
    ];
    return asianLanguagesWithoutSpaces.some(l => lang.includes(l));
  }

  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "TRANSLATE_SELECTION") {
      handleTranslate(msg.text, msg.settings);
      sendResponse();
      return true;
    } else if (msg.type === "PING") {
      sendResponse({ status: "ok" });
      return true;
    } else if (msg.type === "UGT_SHOW_OVERLAY" && window.self === window.top) {
      //console.log("[contentScript.js] Top frame received UGT_SHOW_OVERLAY, provider:", msg.provider);
      showOverlay(msg.provider);
    } else if (msg.type === "UGT_HIDE_OVERLAY" && window.self === window.top) {
      hideOverlay(msg.force);
    } else if (msg.type === "UGT_SHOW_ERROR" && window.self === window.top) {
      showCustomError(msg.message, msg.errorContext);
    } else if (msg.type === "UGT_UPDATE_OVERLAY_PREVIEW" && window.self === window.top) {
      //console.log("[contentScript.js] Top frame received UGT_UPDATE_OVERLAY_PREVIEW, text length:", msg.text.length);
      if (overlayDiv) {
        const previewArea = overlayDiv.querySelector('.translation-preview');
        if (previewArea) {
          previewArea.textContent = msg.text;
          previewArea.scrollTop = previewArea.scrollHeight;
        }
      }
    } else if (msg.type === "UGT_TRANSLATION_COMPLETE" && window.self === window.top) {
      console.log("[contentScript.js] Top frame received UGT_TRANSLATION_COMPLETE");
      if (overlayDiv) {
        const textSpan = overlayDiv.querySelector('.overlay-text');
        if (textSpan && textSpan.textContent.includes("Streaming")) {
          const provider = msg.provider || textSpan.textContent.split(" ").pop();
          textSpan.textContent = `Translation from ${provider} complete`;
        }
        
        // Stop spinner/timer
        if (animationInterval) {
          clearInterval(animationInterval);
          animationInterval = null;
        }
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        
        // Only hide if preview isn't showing
        const previewArea = overlayDiv.querySelector('.translation-preview');
        if (!previewArea || previewArea.style.display === "none") {
          hideOverlay();
        }
      }
    } else if (msg.type === "UGT_UPDATE_OVERLAY_PREVIEW_RELAY" && window.self === window.top) {
      //console.log("[contentScript.js] Top frame received UGT_UPDATE_OVERLAY_PREVIEW_RELAY, text length:", msg.text.length);
      if (overlayDiv) {
        const previewArea = overlayDiv.querySelector('.translation-preview');
        if (previewArea) {
          previewArea.textContent = msg.text;
          previewArea.scrollTop = previewArea.scrollHeight;
        }
      }
    } else if (msg.type === "UGT_TRANSLATION_COMPLETE_RELAY" && window.self === window.top) {
      console.log("[contentScript.js] Top frame received UGT_TRANSLATION_COMPLETE_RELAY, provider:", msg.provider);
      if (overlayDiv) {
        const textSpan = overlayDiv.querySelector('.overlay-text');
        if (textSpan && textSpan.textContent.includes("Streaming")) {
          const provider = msg.provider || textSpan.textContent.split(" ").pop();
          textSpan.textContent = `Translation from ${provider} complete`;
        }
        
        // Stop spinner/timer
        if (animationInterval) {
          clearInterval(animationInterval);
          animationInterval = null;
        }
        if (timerInterval) {
          clearInterval(timerInterval);
          timerInterval = null;
        }
        
        // Only hide if preview isn't showing
        const previewArea = overlayDiv.querySelector('.translation-preview');
        if (!previewArea || previewArea.style.display === "none") {
          hideOverlay();
        }
      }
    } else if (msg.type === "UGT_OPEN_PREVIEW" && window.self === window.top) {
      //console.log("[contentScript.js] Top frame received UGT_OPEN_PREVIEW");
      if (overlayDiv) {
        const previewArea = overlayDiv.querySelector('.translation-preview');
        const toggleBtn = overlayDiv.querySelector('.toggle-btn');
        if (previewArea && previewArea.style.display === "none" && toggleBtn) {
          previewArea.style.display = "block";
          toggleBtn.innerHTML = "▲"; // Pointing up when open
          // Update preview content
          if (msg.text) {
            previewArea.textContent = msg.text;
          } else {
            previewArea.textContent = currentStreamingText || "No translation data yet...";
          }
          previewArea.scrollTop = previewArea.scrollHeight;
        }
      }
    } else if (msg.type === "CHAT_STREAM_CHUNK") {
      // Handle chat streaming chunks - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('CHAT_STREAM_CHUNK received without sessionId');
        return;
      }
      
      const sessionContext = chatSessions.get(sessionId);
      if (sessionContext && sessionContext.isStreaming && sessionContext.container) {
        // Find the streaming message element by both streaming status AND session ID
        const streamingMsg = sessionContext.container.querySelector(`.ugt-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        if (streamingMsg) {
          // Get existing content or empty string
          const currentContent = streamingMsg.dataset.content || '';
          const newContent = currentContent + msg.chunk;
          streamingMsg.dataset.content = newContent;
          updateChatStreamingMessage(streamingMsg, newContent);
        }
      }
    } else if (msg.type === "CHAT_STREAM_COMPLETE") {
      // Handle chat stream completion - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('CHAT_STREAM_COMPLETE received without sessionId');
        return;
      }
      
      const sessionContext = chatSessions.get(sessionId);
      if (sessionContext && sessionContext.container) {
        const streamingMsg = sessionContext.container.querySelector(`.ugt-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        const chatInput = sessionContext.container.querySelector('.ugt-chat-input');
        const sendButton = sessionContext.container.querySelector('.ugt-chat-send');
        
        if (streamingMsg) {
          const finalContent = streamingMsg.dataset.content || msg.content || '';
          finishChatResponse(streamingMsg, finalContent, false, sessionId);
          
          // Add to chat history in session context
          sessionContext.chatHistory.push({ role: 'assistant', content: finalContent });
        }
        
        if (chatInput && sendButton) {
          resetChatInputState(chatInput, sendButton, sessionId);
        }
      }
    } else if (msg.type === "CHAT_STREAM_ERROR") {
      // Handle chat stream error - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('CHAT_STREAM_ERROR received without sessionId');
        return;
      }
      
      const sessionContext = chatSessions.get(sessionId);
      if (sessionContext && sessionContext.container) {
        const streamingMsg = sessionContext.container.querySelector(`.ugt-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        const chatInput = sessionContext.container.querySelector('.ugt-chat-input');
        const sendButton = sessionContext.container.querySelector('.ugt-chat-send');
        
        if (streamingMsg) {
          finishChatResponse(streamingMsg, msg.error || 'An error occurred', true, sessionId);
        }
        
        if (chatInput && sendButton) {
          resetChatInputState(chatInput, sendButton, sessionId);
        }
      }
    } else if (msg.type === "UGT_SHOW_TTS_OVERLAY" && window.self === window.top) {
      showTTSOverlay();
    } else if (msg.type === "UGT_HIDE_TTS_OVERLAY" && window.self === window.top) {
      hideTTSOverlay();
    } else if (msg.type === "PLAY_TTS_AUDIO") {
      playTTSAudio(msg.audio, msg.mimeType);
      sendResponse({ status: "playing" });
      return true;
    }
    return msg.type === "PING";
  });

  // Set up connection listener for streaming
  chrome.runtime.onConnect.addListener(port => {
    if (port.name === "translation_stream") {
      streamingPort = port;
      console.log("Streaming connection established");
      
      lastActivityTime = Date.now();
      streamHeartbeatSetup(); // Keep heartbeat setup

      // Buffer for incoming stream data
      let streamBuffer = "";
      
      port.onMessage.addListener(msg => {
        lastActivityTime = Date.now(); // Update activity time on any message
        
        if (msg.type === "STREAM_CHUNK") {
          if (typeof msg.chunk === 'string') {
            streamBuffer += msg.chunk;
            // console.log("Chunk received, buffer length:", streamBuffer.length);
          }

          // Process buffer to find and apply complete tagged translations
          // Regex to find <ugt_ID>content</ugt_ID>
          // It captures the ID (alphanumeric + underscore) and the content (non-greedy).
          const tagRegex = /<ugt_([^>]+)>([\s\S]*?)<\/ugt_\1>/g;
          let match;
          let lastIndex = 0;

          while ((match = tagRegex.exec(streamBuffer)) !== null) {
            const ugtId = match[1];
            let translatedContent = match[2];
            
            // Refine translatedContent to get the innermost/last segment for this ugtId
            translatedContent = getInnermostTranslatedSegment(ugtId, translatedContent, tagRegex);
            
            // console.log(`Found tagged translation: ID=${ugtId}, Content Length=${translatedContent.length}`);
            
            const targetSpan = document.querySelector(`span.${UGT_SEGMENT_CLASS}[data-ugt-id='${ugtId}']`);
            if (targetSpan) {
              let finalTranslatedContent = translatedContent;
              if (currentTranslationSettings && typeof currentTranslationSettings.targetLang === 'string' &&
                  !TargetLanguageIsAnAsianLanguageThatDoesntUseSpaces(currentTranslationSettings.targetLang)) {
                
                let textOfPrevElement = "";
                if (lastTranslatedElement && lastTranslatedElement !== targetSpan) {
                  textOfPrevElement = lastTranslatedElement.textContent || "";
                }
                
                // ---- DIAGNOSTIC LOGGING START ----
                //console.log("[UGT Space Debug] For targetSpan:", targetSpan);
                //console.log("[UGT Space Debug] lastTranslatedElement:", lastTranslatedElement);
                if (lastTranslatedElement && lastTranslatedElement !== targetSpan) {
                  //console.log("[UGT Space Debug] lastTranslatedElement.textContent:", lastTranslatedElement.textContent);
                }
                //console.log("[UGT Space Debug] textOfPrevElement:", textOfPrevElement);
                //console.log("[UGT Space Debug] finalTranslatedContent (before space logic for current span):", finalTranslatedContent);
                // ---- DIAGNOSTIC LOGGING END ----

                if (textOfPrevElement.length > 0 && finalTranslatedContent.length > 0) {
                    const lastCharOfPrev = textOfPrevElement.slice(-1);
                    const firstCharOfCurrent = finalTranslatedContent.charAt(0);

                    if (lastCharOfPrev !== ' ' && firstCharOfCurrent !== ' ') {
                        const noSpaceBeforeThese = ['.', ',', ';', ':', '?', '!', ')', ']', '}', '"', '\u2019', '"', '\'', '%', '>'];
                        const noSpaceAfterThese = ['(', '[', '{', '"', '\u2018', '"', '\'', '<'];
                        
                        let shouldAddSpace = true;
                        if (noSpaceBeforeThese.includes(firstCharOfCurrent)) {
                            shouldAddSpace = false;
                        } else if (noSpaceAfterThese.includes(lastCharOfPrev)) {
                            shouldAddSpace = false;
                        }

                        if (shouldAddSpace) {
                            finalTranslatedContent = " " + finalTranslatedContent;
                            //console.log("[UGT Space Debug] Space ADDED. New finalTranslatedContent:", finalTranslatedContent);
                        }
                    }
                }
              }
              targetSpan.textContent = finalTranslatedContent;
              targetSpan.setAttribute('data-translated-text', finalTranslatedContent); // Store for toggle feature
              lastTranslatedElement = targetSpan; // Update last translated element
            } else {
              console.warn(`No placeholder span found for ugt_id: ${ugtId}`);
            }
            lastIndex = tagRegex.lastIndex; // Update lastIndex to continue search from end of this match
          }

          // Remove processed part from buffer
          if (lastIndex > 0) {
            streamBuffer = streamBuffer.substring(lastIndex);
          }
          
          currentStreamingText = streamBuffer; // Update currentStreamingText for live preview
          
          // Relay preview to top frame if in iframe
          if (window.self !== window.top) {
            chrome.runtime.sendMessage({ type: "UGT_UPDATE_OVERLAY_PREVIEW_RELAY", text: currentStreamingText });
            
            // Check if overlay preview should be automatically displayed (like when clicking chevron)
            if (overlayDiv) {
              const previewArea = overlayDiv.querySelector('.translation-preview');
              if (previewArea && previewArea.style.display === "block") {
                // If preview is open in iframe, request the top frame to open it too
                chrome.runtime.sendMessage({ type: "UGT_OPEN_PREVIEW_RELAY" });
              }
            }
          }

          // Update preview area if visible
          if (overlayDiv) {
            const previewArea = overlayDiv.querySelector('.translation-preview');
            if (previewArea && previewArea.style.display === "block") {
              previewArea.textContent = currentStreamingText; 
              previewArea.scrollTop = previewArea.scrollHeight;
            }
          }

        } else if (msg.type === "STREAM_COMPLETE") {
          console.log("Stream complete received from background.js");
          
          let fullyAssembledTranslation = ""; // To store the complete translation for final preview
          const tagRegex = /<ugt_([^>]+)>([\s\S]*?)<\/ugt_\1>/g;
          let match;
          let lastIndex = 0;
          while ((match = tagRegex.exec(streamBuffer)) !== null) {
            const ugtId = match[1];
            let translatedContent = match[2];
            
            // Refine translatedContent
            translatedContent = getInnermostTranslatedSegment(ugtId, translatedContent, tagRegex);
            
            // Append to our assembled string, assuming segments are plain text or simple HTML
            // If segments can be complex HTML that shouldn't be joined by newlines, adjust accordingly.
            fullyAssembledTranslation += translatedContent + "\n"; 

            const targetSpan = document.querySelector(`span.${UGT_SEGMENT_CLASS}[data-ugt-id='${ugtId}']`);
            if (targetSpan) {
              let finalTranslatedContent = translatedContent;
              if (currentTranslationSettings && typeof currentTranslationSettings.targetLang === 'string' &&
                  !TargetLanguageIsAnAsianLanguageThatDoesntUseSpaces(currentTranslationSettings.targetLang)) {
                
                let textOfPrevElement = "";
                if (lastTranslatedElement && lastTranslatedElement !== targetSpan) {
                  textOfPrevElement = lastTranslatedElement.textContent || "";
                }
                
                // ---- DIAGNOSTIC LOGGING START ----
                //console.log("[UGT Space Debug] For targetSpan:", targetSpan);
                //console.log("[UGT Space Debug] lastTranslatedElement:", lastTranslatedElement);
                if (lastTranslatedElement && lastTranslatedElement !== targetSpan) {
                  //console.log("[UGT Space Debug] lastTranslatedElement.textContent:", lastTranslatedElement.textContent);
                }
                //console.log("[UGT Space Debug] textOfPrevElement:", textOfPrevElement);
                //console.log("[UGT Space Debug] finalTranslatedContent (before space logic for current span):", finalTranslatedContent);
                // ---- DIAGNOSTIC LOGGING END ----

                if (textOfPrevElement.length > 0 && finalTranslatedContent.length > 0) {
                    const lastCharOfPrev = textOfPrevElement.slice(-1);
                    const firstCharOfCurrent = finalTranslatedContent.charAt(0);

                    if (lastCharOfPrev !== ' ' && firstCharOfCurrent !== ' ') {
                        const noSpaceBeforeThese = ['.', ',', ';', ':', '?', '!', ')', ']', '}', '"', '\u2019', '"', '\'', '%', '>'];
                        const noSpaceAfterThese = ['(', '[', '{', '"', '\u2018', '"', '\'', '<'];
                        
                        let shouldAddSpace = true;
                        if (noSpaceBeforeThese.includes(firstCharOfCurrent)) {
                            shouldAddSpace = false;
                        } else if (noSpaceAfterThese.includes(lastCharOfPrev)) {
                            shouldAddSpace = false;
                        }

                        if (shouldAddSpace) {
                            finalTranslatedContent = " " + finalTranslatedContent;
                            //console.log("[UGT Space Debug] Space ADDED. New finalTranslatedContent:", finalTranslatedContent);
                        }
                    }
                }
              }
              targetSpan.textContent = finalTranslatedContent;
              targetSpan.setAttribute('data-translated-text', finalTranslatedContent); // Store for toggle feature
              lastTranslatedElement = targetSpan; // Update last translated element
            } else {
              console.warn(`(Complete) No placeholder span for ugt_id: ${ugtId}`);
            }
            lastIndex = tagRegex.lastIndex;
          }
          streamBuffer = streamBuffer.substring(lastIndex); // Remove processed parts
          
          // Add "Toggle All" button if there are segments that changed
          if (lastTranslatedElement && currentTranslationBatchId && batchHasChangedSegments(currentTranslationBatchId)) {
            const toggleAllBtn = createToggleAllButton(currentTranslationBatchId);
            
            // Find insertion point - outside any anchor elements
            let toggleInsertionParent = lastTranslatedElement.parentNode;
            let toggleInsertAfter = lastTranslatedElement;
            
            let currentEl = lastTranslatedElement;
            while (currentEl && currentEl !== document.body) {
              if (currentEl.tagName === 'A') {
                toggleInsertionParent = currentEl.parentNode;
                toggleInsertAfter = currentEl;
                break;
              }
              currentEl = currentEl.parentNode;
            }
            
            if (toggleInsertionParent) {
              toggleInsertionParent.insertBefore(toggleAllBtn, toggleInsertAfter.nextSibling);
            }
          }
          
          if (streamBuffer.length > 0 && lastTranslatedElement) {
            const extraText = streamBuffer.trim();
            if (extraText) {
              //console.log("Appending extra text after last translation:", extraText);
              const extraTextContainer = document.createElement('div');
              extraTextContainer.className = 'ugt-cultural-nuances';
              
              // Create a content wrapper for the cultural nuances text
              const contentWrapper = document.createElement('div');
              contentWrapper.className = 'ugt-cultural-nuances-content';
              contentWrapper.innerHTML = simpleMarkdownToHtml(extraText);
              extraTextContainer.appendChild(contentWrapper);
              
              // Enhanced styling for cultural nuances container
              Object.assign(extraTextContainer.style, {
                marginLeft: '0',
                marginTop: '12px',
                marginBottom: '8px',
                padding: '14px 18px',
                borderLeft: '4px solid #6b8afd',
                backgroundColor: '#f8f9ff',
                borderRadius: '0 8px 8px 0',
                boxShadow: '0 2px 8px rgba(107, 138, 253, 0.12)',
                color: '#2d3748',
                fontSize: '14px',
                lineHeight: '1.6',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                maxWidth: '100%',
                boxSizing: 'border-box'
              });
              
              // Find the appropriate insertion point - must be OUTSIDE any anchor elements
              // to prevent link activation when clicking on the cultural nuances area
              let insertionParent = lastTranslatedElement.parentNode;
              let insertAfter = lastTranslatedElement;
              
              // Walk up the DOM tree to find if we're inside an anchor element
              let currentElement = lastTranslatedElement;
              while (currentElement && currentElement !== document.body) {
                if (currentElement.tagName === 'A') {
                  // Found an anchor - insert after it instead of inside it
                  insertionParent = currentElement.parentNode;
                  insertAfter = currentElement;
                  break;
                }
                currentElement = currentElement.parentNode;
              }
              
              // Skip past the "Toggle All" button if it was added
              let insertBeforeRef = insertAfter.nextSibling;
              if (insertBeforeRef && insertBeforeRef.classList && insertBeforeRef.classList.contains('ugt-toggle-all-btn')) {
                insertBeforeRef = insertBeforeRef.nextSibling;
              }
              
              if (insertionParent) {
                insertionParent.insertBefore(extraTextContainer, insertBeforeRef);
              } else {
                // Fallback: append to body if somehow lost its parent
                document.body.appendChild(extraTextContainer);
                console.warn("Last translated element had no parent, appended extra text to body.");
              }
              
              // Create chat interface (session context is created inside)
              const chatElements = createChatInterface(extraTextContainer, extraText);
              
              // Update the session context with translation info
              const chatSessionId = extraTextContainer.dataset.chatSessionId;
              if (chatSessionId) {
                const sessionContext = chatSessions.get(chatSessionId);
                if (sessionContext) {
                  sessionContext.originalText = fullyAssembledTranslation.trim();
                  // Get provider name from settings (capitalize first letter)
                  const provider = currentTranslationSettings?.provider || 'AI';
                  sessionContext.providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
                }
              }
            }
          } else if (streamBuffer.length > 0) {
            // This case means there's extra text, but no translation happened (lastTranslatedElement is null)
            // or the logic for setting lastTranslatedElement failed.
            console.warn("Stream complete, buffer has remaining unparsed content, but no last translated element to append to:", streamBuffer);
          }
          streamBuffer = ""; // Clear buffer
          
          currentStreamingText = fullyAssembledTranslation.trim(); // Update with the final text for preview
          
          // Relay final preview to top frame if in iframe
          if (window.self !== window.top) {
            chrome.runtime.sendMessage({ type: "UGT_UPDATE_OVERLAY_PREVIEW_RELAY", text: currentStreamingText });
            // Also relay translation completion status
            chrome.runtime.sendMessage({ 
              type: "UGT_TRANSLATION_COMPLETE_RELAY", 
              provider: overlayDiv?.querySelector('.overlay-text')?.textContent.split(" ").pop() || "?"
            });
          }
          
          if (overlayDiv) {
            const textSpan = overlayDiv.querySelector('.overlay-text');
            if (textSpan && textSpan.textContent.includes("Streaming")) {
              const provider = textSpan.textContent.split(" ").pop();
              textSpan.textContent = `Translation from ${provider} complete`;
            }
            
            const previewArea = overlayDiv.querySelector('.translation-preview');
            if (previewArea && previewArea.style.display === "block") { // Preview is open
                previewArea.textContent = currentStreamingText; // Update content
                previewArea.scrollTop = previewArea.scrollHeight;
                // Stop spinner/timer
                if (animationInterval) clearInterval(animationInterval); animationInterval = null;
                if (timerInterval) clearInterval(timerInterval); timerInterval = null;
                if (streamHeartbeatInterval) { // Clear heartbeat interval
                    clearInterval(streamHeartbeatInterval);
                    streamHeartbeatInterval = null;
                }
            } else { // Preview not open or doesn't exist
                // Still stop animation/timer if they were running
                if (animationInterval) clearInterval(animationInterval); animationInterval = null;
                if (timerInterval) clearInterval(timerInterval); timerInterval = null;
                if (streamHeartbeatInterval) { // Clear heartbeat interval
                    clearInterval(streamHeartbeatInterval);
                    streamHeartbeatInterval = null;
                }
                hideOverlay(); // Hide if preview isn't showing or if there's no preview area
            }
          }

          // Disconnect THIS port (using closure variable, not global streamingPort)
          // This prevents disconnecting a different translation's port if multiple are running
          try {
            console.log("Translation complete, disconnecting this port from content script.");
            port.disconnect();
          } catch (e) {
            console.warn("Error disconnecting port on stream complete:", e);
          }
          // Only clear global streamingPort if it's still pointing to this port
          if (streamingPort === port) {
            streamingPort = null;
          }

        } else if (msg.type === "STREAM_ERROR") {
          console.error("Streaming error from background.js:", msg.error);
          showCustomError(msg.error, "API_KEY_ISSUE");
          if (overlayDiv) {
             const previewArea = overlayDiv.querySelector('.translation-preview');
             if (previewArea) {
                previewArea.style.display = "block";
                previewArea.innerHTML = `<div style="color:red; font-weight:bold;">Error: ${msg.error}</div>`;
             }
             const textSpan = overlayDiv.querySelector('.overlay-text');
             if (textSpan) textSpan.textContent = "Error during translation";
          }
          // Consider reverting placeholders to original text if possible/stored
          streamBuffer = "";
          hideOverlay(); // Or only hide parts of it, leaving error message
          // Disconnect THIS port (using closure variable, not global streamingPort)
          try { port.disconnect(); } catch (e) {}
          if (streamingPort === port) {
            streamingPort = null;
          }

        } else if (msg.type === "HEARTBEAT_CONTENT" || msg.type === "HEARTBEAT_RESPONSE" || msg.type === "STATUS_CHECK") {
          // Handle other message types as before or log them
          console.log("Received message:", msg.type, msg);
          if (msg.type === "STATUS_CHECK") {
            try {
              // Use the closure's port, not the global streamingPort
              port.postMessage({ type: "STATUS_RESPONSE", status: "active", timestamp: Date.now() });
            } catch (e) { console.error("Error responding to STATUS_CHECK:", e); }
          }
        }
      });
      
      port.onDisconnect.addListener(() => {
        console.log("Streaming port disconnected.");
        if (streamHeartbeatInterval) {
          clearInterval(streamHeartbeatInterval);
          streamHeartbeatInterval = null;
        }
        // If there was an error or premature disconnect, process any remaining buffer
        if (streamBuffer.length > 0) {
            console.warn("Port disconnected with remaining buffer content, attempting final parse:", streamBuffer);
            // (Same parsing logic as in STREAM_COMPLETE)
            const tagRegex = /<ugt_([^>]+)>([\s\S]*?)<\/ugt_\1>/g;
            let match;
            let lastIndex = 0;
            while ((match = tagRegex.exec(streamBuffer)) !== null) {
                const ugtId = match[1];
                let translatedContent = match[2];
                // Refine translatedContent
                translatedContent = getInnermostTranslatedSegment(ugtId, translatedContent, tagRegex);
                const targetSpan = document.querySelector(`span.${UGT_SEGMENT_CLASS}[data-ugt-id='${ugtId}']`);
                if (targetSpan) targetSpan.textContent = translatedContent;
                lastIndex = tagRegex.lastIndex;
            }
            streamBuffer = "";
        }

        // Cleanup UI unless preview is explicitly open
        if (overlayDiv) {
            const previewArea = overlayDiv.querySelector('.translation-preview');
            if (!previewArea || previewArea.style.display === "none") {
                hideOverlay();
            }
        }
        streamingPort = null;
        // streamingRange = null; // Keep for potential future use (e.g. copy original)
        // currentStreamingText is now streamBuffer, effectively cleared or processed.
      });
    }
  });

  async function handleTranslate(selectedText, settings) {
    // selectedText is info.selectionText, so it *should* be valid if we got this far.
    if (!selectedText || !selectedText.trim()) {
      console.warn("UGTBrowser: handleTranslate called without selectedText. This shouldn't happen if background script validated selection.");
      // Use a more specific error message or handle as appropriate
      showCustomError("UGTBrowser: No text was provided for translation by the extension."); 
      return;
    }

    let activeRange = savedRange; // Prioritize the range captured by selectionchange

    if (!activeRange) {
      // If savedRange is not set (likely on first run after script injection,
      // or if selectionchange didn't fire for some reason),
      // try to get the current selection directly.
      // The presence of selectedText (from info.selectionText) strongly implies a selection was intended.
      const currentSelection = document.getSelection();
      if (currentSelection && currentSelection.rangeCount > 0) {
        activeRange = currentSelection.getRangeAt(0).cloneRange();
        // console.log("UGTBrowser: Using freshly fetched selection as savedRange was not set.");
      } else {
        // This means selectedText (from background) was present, but getSelection() is now empty on the page.
        // This could happen if the selection was programmatically cleared by the page
        // or due to focus changes between the context menu click and this execution.
        console.warn("UGTBrowser: selectedText was present, but document.getSelection() is now empty.");
        showCustomError("UGTBrowser: Selection was lost or could not be retrieved from the page.");
        return;
      }
    }

    initialInsertionHasOccurred = false;

    const range = activeRange.cloneRange(); // Use the determined activeRange
    const originalFragmentClone = range.cloneContents(); // This is what we will process and insert

    const segmentsToTranslate = [];
    let segmentCounter = 0;
    
    // Generate a unique batch ID for this translation request (for toggle feature)
    currentTranslationBatchId = generateId();

    // Use a TreeWalker to find all text nodes within the cloned fragment
    const walker = document.createTreeWalker(originalFragmentClone, NodeFilter.SHOW_TEXT, null, false);
    const textNodesToReplace = [];
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeValue.trim() !== "") {
        textNodesToReplace.push(node);
      }
    }

    // Replace text nodes with our placeholder spans (pre-filled with original text)
    for (const textNode of textNodesToReplace) {
      const originalText = textNode.nodeValue;
      const uniqueIdCore = `${generateId()}_${segmentCounter++}`;
      const idForLLMPrompt = `ugt_${uniqueIdCore}`; // This is the ugt_id prefix for the prompt

      segmentsToTranslate.push(`${idForLLMPrompt}: ${originalText.trim()}`);

      const span = document.createElement('span');
      span.setAttribute('data-ugt-id', uniqueIdCore); // The span data-id does not have "ugt_" prefix
      span.setAttribute('data-original-text', originalText); // Store original for toggle feature
      span.setAttribute('data-ugt-batch', currentTranslationBatchId); // Batch ID for toggle all feature
      span.className = UGT_SEGMENT_CLASS;
      span.textContent = originalText; // Pre-fill with original text

      // Replace the text node with the new span in its parent
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(span, textNode);
      } else {
        // This case should ideally not happen if textNode came from walker on a fragment
        console.warn("Text node had no parent during replacement:", textNode);
      }
    }

    if (segmentsToTranslate.length === 0) {
      console.log("No translatable text segments found.");
      hideOverlay(true);
      return;
    }

    const textPayload = segmentsToTranslate.join("\n");
    showOverlay(settings.provider || "?");

    // Now, originalFragmentClone contains the structure with spans replacing text nodes
    range.deleteContents();
    range.insertNode(originalFragmentClone);
    initialInsertionHasOccurred = true;

    streamingRange = range; 
    currentStreamingText = ""; // Initialize for the new translation stream
    currentTranslationSettings = { ...settings }; // Store settings for current translation

    //console.log("Sending text payload for translation construction in background.js:", textPayload);

    try {
      chrome.runtime.sendMessage(
        {
          type: "FETCH_TRANSLATION",
          payload: { 
            textPayload: textPayload, // NEW: sending raw payload for background.js to build prompt
            settings: { 
              ...settings, 
              streaming: true,
              targetLang: settings.targetLang || "English" // Ensure targetLang is passed
            }
          }
        },
        (resp) => {
            if (chrome.runtime.lastError) {
                console.error("Error sending FETCH_TRANSLATION:", chrome.runtime.lastError.message);
                showCustomError("Error initiating translation: " + chrome.runtime.lastError.message, "API_KEY_ISSUE");
                hideOverlay();
                return;
            }
            //console.log("FETCH_TRANSLATION sent, background responded:", resp);
        }
      );
    } catch (e) {
      console.error("Error constructing or sending translation request:", e);
      hideOverlay();
      showCustomError(e.message || String(e), "API_KEY_ISSUE");
    }
  }

  // Function to create a new animation frame for the spinner
  function updateAnimation() {
    if (!overlayDiv) return;
    
    const dots = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    const elapsed = Date.now() - overlayStart;
    const frame = Math.floor(elapsed / 100) % dots.length;
    
    const textSpan = overlayDiv.querySelector('.overlay-text');
    if (textSpan) {
      const spinnerSpan = overlayDiv.querySelector('.spinner');
      if (spinnerSpan) {
        spinnerSpan.textContent = dots[frame];
      }
    }
  }
  
  // Function to update the timer
  function updateTimer() {
    if (!overlayDiv) return;
    
    const timerSpan = overlayDiv.querySelector('.timer');
    if (timerSpan) {
      const elapsed = Math.floor((Date.now() - overlayStart) / 1000);
      const seconds = elapsed % 60;
      const minutes = Math.floor(elapsed / 60);
      timerSpan.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }

  function showOverlay(provider) {
    if (window.self !== window.top) {
      console.log("[contentScript.js] iframe sending UGT_SHOW_OVERLAY_RELAY, provider:", provider);
      chrome.runtime.sendMessage({ type: "UGT_SHOW_OVERLAY_RELAY", provider });
      return;
    }
    if (overlayDiv) hideOverlay(true);
    overlayStart = Date.now();
    overlayDiv = document.createElement("div");
    Object.assign(overlayDiv.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      padding: "8px 12px",
      background: "rgba(0,0,0,0.7)",
      color: "#fff",
      borderRadius: "4px",
      zIndex: "2147483647",
      fontSize: "14px",
      fontFamily: "Arial, sans-serif",
      display: "flex",
      flexDirection: "column",
      gap: "8px"
    });
    
    // Top row with controls
    const topRow = document.createElement("div");
    topRow.style.display = "flex";
    topRow.style.alignItems = "center";
    topRow.style.gap = "8px";
    overlayDiv.appendChild(topRow);
    
    // Create text span for the message
    const textSpan = document.createElement("span");
    textSpan.className = "overlay-text";
    textSpan.textContent = `Streaming from ${provider}`;
    topRow.appendChild(textSpan);
    
    // Create timer span
    const timerSpan = document.createElement("span");
    timerSpan.className = "timer";
    timerSpan.textContent = "0:00";
    timerSpan.style.marginLeft = "5px";
    topRow.appendChild(timerSpan);
    
    // Create spinner span
    const spinnerSpan = document.createElement("span");
    spinnerSpan.className = "spinner";
    spinnerSpan.textContent = "⠋";
    spinnerSpan.style.display = "inline-block";
    spinnerSpan.style.width = "1em";
    topRow.appendChild(spinnerSpan);
    
    // Create toggle button to show/hide translation
    const toggleBtn = document.createElement("span");
    toggleBtn.className = "toggle-btn";
    toggleBtn.innerHTML = "▼"; // Default to hidden
    toggleBtn.style.cursor = "pointer";
    toggleBtn.style.marginLeft = "8px";
    toggleBtn.title = "Show/hide current translation";
    topRow.appendChild(toggleBtn);
    
    // Create settings button
    const settingsBtn = document.createElement("span");
    settingsBtn.className = "settings-btn";
    settingsBtn.innerHTML = "⚙️";
    settingsBtn.style.cursor = "pointer";
    settingsBtn.style.marginLeft = "auto"; // Push to the right
    settingsBtn.title = "Open Settings";
    settingsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "OPEN_SETTINGS" });
    });
    topRow.appendChild(settingsBtn);

    // Create Close button (X)
    const closeBtn = document.createElement("span");
    closeBtn.className = "close-btn";
    closeBtn.innerHTML = "✖"; // Unicode X character
    closeBtn.style.cursor = "pointer";
    closeBtn.style.marginLeft = "8px";
    closeBtn.style.color = "#ff6b6b"; 
    closeBtn.style.fontWeight = "bold";
    closeBtn.title = "Close and Stop Translation";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (streamHeartbeatInterval) { // Clear heartbeat interval before disconnecting
        clearInterval(streamHeartbeatInterval);
        streamHeartbeatInterval = null;
      }
      if (streamingPort) {
        try {
          streamingPort.disconnect();
        } catch (err) {
          console.warn("Error disconnecting port on close:", err);
        }
        streamingPort = null;
      }
      streamingActiveFrags = null;
      streamingRange = null;
      currentStreamingText = ""; // Clear current text
      hideOverlay(true); // Force hide
    });
    topRow.appendChild(closeBtn);
    
    // Create translation preview area (hidden by default)
    const previewArea = document.createElement("div");
    previewArea.className = "translation-preview";
    previewArea.style.display = "none"; 
    previewArea.style.maxHeight = "400px"; 
    previewArea.style.overflowY = "auto";
    previewArea.style.marginTop = "8px";
    previewArea.style.padding = "12px"; 
    previewArea.style.background = "rgba(0,0,0,0.8)"; 
    previewArea.style.borderRadius = "4px";
    previewArea.style.whiteSpace = "pre-wrap";
    previewArea.style.fontSize = "13px"; 
    previewArea.style.fontFamily = "monospace, 'Courier New', Courier";
    previewArea.style.maxWidth = "800px";
    previewArea.style.wordBreak = "break-word";
    previewArea.style.width = "450px"; 
    previewArea.style.color = "#ffffff"; 
    previewArea.style.lineHeight = "1.5"; 
    previewArea.style.border = "1px solid rgba(255,255,255,0.2)"; 
    overlayDiv.appendChild(previewArea);
    
    // Toggle preview area and update content when clicked
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (previewArea.style.display === "none") {
        previewArea.style.display = "block";
        toggleBtn.innerHTML = "▲"; // Pointing up when open
        // Update preview content with current translation immediately when opened
        previewArea.textContent = currentStreamingText || "No translation data yet...";
        previewArea.scrollTop = previewArea.scrollHeight; // Scroll to bottom
      } else {
        previewArea.style.display = "none";
        toggleBtn.innerHTML = "▼"; // Pointing down when closed
      }
    });
    
    document.body.appendChild(overlayDiv);
    
    // Start animation
    if (animationInterval) clearInterval(animationInterval);
    animationInterval = setInterval(updateAnimation, 100);
    
    // Start timer
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(updateTimer, 1000);
    
    // Set up an interval to update the preview if it's visible
    const previewUpdateInterval = setInterval(() => {
      if (overlayDiv && previewArea.style.display === "block" && currentStreamingText) {
        // Just update text and scroll
        previewArea.textContent = currentStreamingText;
        
        // Scroll to the bottom if content is being updated
        previewArea.scrollTop = previewArea.scrollHeight;
      }
      
      // Clear the interval when the overlay is gone
      if (!overlayDiv) {
        clearInterval(previewUpdateInterval);
      }
    }, 300); // Update more frequently
  }

  function hideOverlay(force = false) {
    if (window.self !== window.top) {
      chrome.runtime.sendMessage({ type: "UGT_HIDE_OVERLAY_RELAY", force });
      return;
    }
    if (!overlayDiv) return;
    const elapsed = Date.now() - overlayStart;
    const minShow = 200;
    
    if (!force && elapsed < minShow) {
      setTimeout(() => hideOverlay(true), minShow - elapsed);
      return;
    }
    
    if (animationInterval) {
      clearInterval(animationInterval);
      animationInterval = null;
    }
    
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    
    overlayDiv.remove();
    overlayDiv = null;
  }

  function showCustomError(message, errorContext = null) {
    if (window.self !== window.top) {
      chrome.runtime.sendMessage({ type: "UGT_SHOW_ERROR_RELAY", message, errorContext });
      return;
    }
    if (errorModalDiv) { // Remove existing error modal if any
      errorModalDiv.remove();
      errorModalDiv = null;
    }

    errorModalDiv = document.createElement("div");
    Object.assign(errorModalDiv.style, {
      position: "fixed",
      top: "30px", // Adjusted top position
      left: "50%",
      transform: "translateX(-50%)",
      padding: "18px 25px",
      background: "rgba(200, 0, 0, 0.92)", // Darker red for error
      color: "#fff",
      borderRadius: "6px",
      zIndex: "2147483647",
      fontSize: "14px",
      fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
      boxShadow: "0 5px 15px rgba(0,0,0,0.35)",
      minWidth: "320px",
      maxWidth: "550px",
      textAlign: "left", // Align text to left for better readability
      lineHeight: "1.6"
    });

    const titleElement = document.createElement("div");
    titleElement.textContent = "UGTBrowser Alert";
    Object.assign(titleElement.style, {
      fontWeight: "bold",
      fontSize: "17px",
      marginBottom: "12px",
      paddingBottom: "10px",
      borderBottom: "1px solid rgba(255,255,255,0.25)",
      color: "#ffffff"
    });
    errorModalDiv.appendChild(titleElement);

    const messageElement = document.createElement("p");
    messageElement.textContent = message;
    Object.assign(messageElement.style, {
      marginBottom: "20px",
      whiteSpace: "pre-wrap",
      fontSize: "14px"
    });
    errorModalDiv.appendChild(messageElement);

    const buttonContainer = document.createElement("div");
    buttonContainer.style.textAlign = "right"; // Align buttons to the right

    // Button styling
    const modalButtonSharedStyle = {
      padding: '9px 18px',
      border: 'none',
      borderRadius: '4px',
      cursor: 'pointer',
      fontWeight: '600', // Slightly bolder
      fontSize: '13px',
      margin: '0 0 0 10px', // Margin on the left of each button
      transition: 'background-color 0.2s ease'
    };
    const closeButtonStyle = { ...modalButtonSharedStyle, background: '#f0f0f0', color: '#333' };
    const openSettingsButtonStyle = { ...modalButtonSharedStyle, background: '#007bff', color: 'white' };


    const closeButton = document.createElement("button");
    closeButton.textContent = "Close";
    Object.assign(closeButton.style, closeButtonStyle);
    closeButton.onmouseover = () => closeButton.style.background = '#e0e0e0';
    closeButton.onmouseout = () => closeButton.style.background = '#f0f0f0';
    closeButton.addEventListener("click", () => {
      if (errorModalDiv) errorModalDiv.remove();
      errorModalDiv = null;
    });
    buttonContainer.appendChild(closeButton);

    const apiKeyKeywords = ["api key", "missing key", "invalid key", "authentication", "credentials", "token", "api_key"];
    let showSettingsButton = false;
    if (errorContext === "API_KEY_ISSUE" || (typeof message === 'string' && apiKeyKeywords.some(keyword => message.toLowerCase().includes(keyword)))) {
      showSettingsButton = true;
    }

    if (showSettingsButton) {
      const openSettingsButton = document.createElement("button");
      openSettingsButton.textContent = "Open Settings";
      Object.assign(openSettingsButton.style, openSettingsButtonStyle);
      openSettingsButton.onmouseover = () => openSettingsButton.style.background = '#0056b3';
      openSettingsButton.onmouseout = () => openSettingsButton.style.background = '#007bff';
      openSettingsButton.addEventListener("click", () => {
        chrome.runtime.sendMessage({ type: "OPEN_SETTINGS" });
        if (errorModalDiv) errorModalDiv.remove();
        errorModalDiv = null;
      });
      // Prepend to put it before close, or append to put after
      buttonContainer.insertBefore(openSettingsButton, closeButton);
    }
    
    errorModalDiv.appendChild(buttonContainer);
    document.body.appendChild(errorModalDiv);
  }

  // For slow models, set up progress updates
  const streamHeartbeatSetup = () => {
    streamHeartbeatInterval = setInterval(() => {
      if (streamingPort) {
        const now = Date.now();
        const inactiveTime = now - lastActivityTime;
        
        // Check if connection seems inactive
        if (inactiveTime > 10000) {
          console.log(`Connection inactive for ${inactiveTime/1000}s, sending heartbeat`);
          
          try {
            // Send a heartbeat to keep the connection active
            streamingPort.postMessage({ 
              type: "HEARTBEAT", 
              timestamp: now 
            });
          } catch (e) {
            console.error("Error sending heartbeat, connection may be lost:", e.message);
            if (streamHeartbeatInterval) {
              clearInterval(streamHeartbeatInterval);
              streamHeartbeatInterval = null;
            }
            streamingPort = null; // Ensure this port reference is cleared
          }
        }
      } else {
        // Clean up the interval if port is gone
        if (streamHeartbeatInterval) {
          clearInterval(streamHeartbeatInterval);
          streamHeartbeatInterval = null;
        }
      }
    }, 15000); // Every 15 seconds
  };

  // TTS Overlay functions
  function showTTSOverlay() {
    if (window.self !== window.top) {
      chrome.runtime.sendMessage({ type: "UGT_SHOW_TTS_OVERLAY_RELAY" });
      return;
    }
    if (ttsOverlayDiv) hideTTSOverlay();
    
    ttsOverlayDiv = document.createElement("div");
    Object.assign(ttsOverlayDiv.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      padding: "12px 16px",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      color: "#fff",
      borderRadius: "8px",
      zIndex: "2147483647",
      fontSize: "14px",
      fontFamily: "Arial, sans-serif",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      boxShadow: "0 4px 15px rgba(102, 126, 234, 0.4)"
    });
    
    // Speaker icon
    const iconSpan = document.createElement("span");
    iconSpan.textContent = "🔊";
    iconSpan.style.fontSize = "18px";
    ttsOverlayDiv.appendChild(iconSpan);
    
    // Text
    const textSpan = document.createElement("span");
    textSpan.className = "tts-overlay-text";
    textSpan.textContent = "Generating speech...";
    ttsOverlayDiv.appendChild(textSpan);
    
    // Spinner
    const spinnerSpan = document.createElement("span");
    spinnerSpan.className = "tts-spinner";
    spinnerSpan.textContent = "⠋";
    spinnerSpan.style.display = "inline-block";
    spinnerSpan.style.width = "1em";
    spinnerSpan.style.animation = "none";
    ttsOverlayDiv.appendChild(spinnerSpan);
    
    // Animate spinner
    const dots = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frame = 0;
    ttsOverlayDiv._spinnerInterval = setInterval(() => {
      frame = (frame + 1) % dots.length;
      spinnerSpan.textContent = dots[frame];
    }, 100);
    
    // Close button
    const closeBtn = document.createElement("span");
    closeBtn.innerHTML = "✖";
    closeBtn.style.cursor = "pointer";
    closeBtn.style.marginLeft = "8px";
    closeBtn.style.color = "#ffcccc";
    closeBtn.title = "Stop";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      stopTTSAudio();
      hideTTSOverlay();
    });
    ttsOverlayDiv.appendChild(closeBtn);
    
    document.body.appendChild(ttsOverlayDiv);
  }
  
  function hideTTSOverlay() {
    if (window.self !== window.top) {
      chrome.runtime.sendMessage({ type: "UGT_HIDE_TTS_OVERLAY_RELAY" });
      return;
    }
    if (!ttsOverlayDiv) return;
    
    if (ttsOverlayDiv._spinnerInterval) {
      clearInterval(ttsOverlayDiv._spinnerInterval);
    }
    
    ttsOverlayDiv.remove();
    ttsOverlayDiv = null;
  }
  
  function updateTTSOverlay(text) {
    if (!ttsOverlayDiv) return;
    const textSpan = ttsOverlayDiv.querySelector('.tts-overlay-text');
    if (textSpan) {
      textSpan.textContent = text;
    }
    // Hide spinner when playing
    const spinnerSpan = ttsOverlayDiv.querySelector('.tts-spinner');
    if (spinnerSpan) {
      spinnerSpan.style.display = 'none';
      if (ttsOverlayDiv._spinnerInterval) {
        clearInterval(ttsOverlayDiv._spinnerInterval);
        ttsOverlayDiv._spinnerInterval = null;
      }
    }
  }
  
  function playTTSAudio(base64Audio, mimeType) {
    // Stop any existing audio
    stopTTSAudio();
    
    try {
      // Convert base64 to blob
      const binaryString = atob(base64Audio);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType || 'audio/mpeg' });
      const audioUrl = URL.createObjectURL(blob);
      
      // Create audio element
      ttsAudioElement = new Audio(audioUrl);
      
      // Update overlay when playing starts
      ttsAudioElement.addEventListener('playing', () => {
        updateTTSOverlay("Playing...");
      });
      
      // Clean up when done
      ttsAudioElement.addEventListener('ended', () => {
        URL.revokeObjectURL(audioUrl);
        hideTTSOverlay();
        ttsAudioElement = null;
      });
      
      // Handle errors
      ttsAudioElement.addEventListener('error', (e) => {
        console.error("Audio playback error:", e);
        URL.revokeObjectURL(audioUrl);
        hideTTSOverlay();
        ttsAudioElement = null;
      });
      
      // Play
      ttsAudioElement.play().catch(err => {
        console.error("Error playing TTS audio:", err);
        hideTTSOverlay();
      });
      
    } catch (e) {
      console.error("Error creating audio from base64:", e);
      hideTTSOverlay();
    }
  }
  
  function stopTTSAudio() {
    if (ttsAudioElement) {
      try {
        ttsAudioElement.pause();
        ttsAudioElement.currentTime = 0;
        // Revoke the object URL if it exists
        if (ttsAudioElement.src && ttsAudioElement.src.startsWith('blob:')) {
          URL.revokeObjectURL(ttsAudioElement.src);
        }
      } catch (e) {
        console.error("Error stopping TTS audio:", e);
      }
      ttsAudioElement = null;
    }
  }
} 