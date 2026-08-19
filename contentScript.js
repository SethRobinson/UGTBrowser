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
  
  // Cultural nuances streaming variables
  let expectedSegmentIds = new Set(); // Track which segments we expect to translate
  let translatedSegmentIds = new Set(); // Track which segments have received translations
  let culturalNuancesContainer = null; // Container for streaming cultural nuances
  let culturalNuancesContent = null; // Content wrapper inside the container
  
  // TTS-specific variables
  let ttsOverlayDiv = null;
  let ttsAudioElement = null;

  // Image translation variables
  let lastContextImage = null;
  let lastContextVideo = null;
  const imageTranslationTargets = new Map();
  
  // Lesson progress overlay
  let lessonOverlayDiv = null;
  let lessonOverlaySessionId = null; // Track which session the overlay belongs to

  // Chat context for follow-up questions - now stored per-session to support multiple concurrent chats
  const chatSessions = new Map(); // Map of sessionId -> { originalText, translatedText, culturalNuances, chatHistory, container, isStreaming, providerName, abortController }
  
  // Lesson sessions - similar to chat sessions but for lesson creation
  const lessonSessions = new Map(); // Map of sessionId -> { originalText, lessonContent, chatHistory, container, isStreaming, providerName, cancelRequested }
  
  // Ask sessions - for asking questions about selected text
  const askSessions = new Map(); // Map of sessionId -> { originalText, chatHistory, container, isStreaming, cancelRequested, currentContent }
  
  // Generate a unique session ID for chat
  function generateChatSessionId() {
    return 'chat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
  }
  
  // Generate a unique session ID for lessons
  function generateLessonSessionId() {
    return 'lesson_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
  }
  
  // Generate a unique session ID for ask sessions
  function generateAskSessionId() {
    return 'ask_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
  }
  
  // Handle the CREATE_LESSON message from the context menu
  function handleCreateLesson(selectedText, lessonPrompt) {
    if (!selectedText || !selectedText.trim()) {
      console.warn('CREATE_LESSON called without text');
      return;
    }
    
    // Create the lesson session ID early so we can show the overlay
    const sessionId = generateLessonSessionId();
    
    // Check for standalone mode
    const isStandalone = window.UGT_STANDALONE_MODE && window.UGT_STANDALONE_MODE.container;
    
    // Show progress overlay immediately for user feedback (skip in standalone mode)
    if (!isStandalone) {
      showLessonOverlay(sessionId);
    }
    
    // Create the lesson container
    const lessonContainer = createLessonContainer(selectedText, sessionId);
    
    if (isStandalone) {
      // Standalone mode: append to the standalone container
      window.UGT_STANDALONE_MODE.container.appendChild(lessonContainer);
    } else {
      // Normal mode: insert after selection
      // Get the selection range - use same approach as translate which works correctly
      let activeRange = savedRange;
      
      if (!activeRange) {
        const currentSelection = document.getSelection();
        if (currentSelection && currentSelection.rangeCount > 0) {
          activeRange = currentSelection.getRangeAt(0).cloneRange();
        }
      }
      
      // Insert after the selection, but OUTSIDE any anchor elements
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
            // Insert after the anchor element instead
            insertAfterElement = currentElement;
            break;
          }
          currentElement = currentElement.parentNode;
        }
        
        // Insert the lesson container after the element (outside any anchor)
        if (insertAfterElement && insertAfterElement.parentNode) {
          insertAfterElement.parentNode.insertBefore(lessonContainer, insertAfterElement.nextSibling);
        } else {
          // Fallback: use range insertion
          const insertionRange = activeRange.cloneRange();
          insertionRange.collapse(false);
          insertionRange.insertNode(lessonContainer);
        }
        
        // Clear the selection so user doesn't have to click away
        window.getSelection().removeAllRanges();
      } else {
        // Fallback: append to body if no range available
        console.warn('No selection range available for lesson insertion, appending to body');
        document.body.appendChild(lessonContainer);
      }
      
      // Scroll to the lesson container so the user can see it
      lessonContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    // Store session context
    const sessionContext = {
      originalText: selectedText,
      lessonContent: '',
      chatHistory: [],
      container: lessonContainer,
      isStreaming: true,
      isChatStreaming: false,
      cancelRequested: false,
      chatCancelRequested: false
    };
    lessonSessions.set(sessionId, sessionContext);
    
    // Request lesson generation from background
    chrome.runtime.sendMessage({
      type: 'LESSON_REQUEST',
      payload: {
        sessionId: sessionId,
        selectedText: selectedText,
        lessonPrompt: lessonPrompt
      }
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Lesson request error:', chrome.runtime.lastError);
        hideLessonOverlay(); // Hide overlay on error
        sessionContext.isStreaming = false;
        const contentWrapper = lessonContainer.querySelector('.ugt-lesson-content');
        if (contentWrapper) {
          contentWrapper.innerHTML = `<div style="color: #ef4444;">Error: ${escapeHtml(chrome.runtime.lastError.message)}</div>`;
        }
      }
    });
  }
  
  // Create the lesson container element
  function createLessonContainer(originalText, sessionId) {
    const container = document.createElement('div');
    container.className = 'ugt-lesson-container';
    container.dataset.lessonSessionId = sessionId;
    
    // Styling similar to cultural nuances but with a different accent color
    Object.assign(container.style, {
      marginLeft: '0',
      marginTop: '16px',
      marginBottom: '16px',
      padding: '18px 22px',
      borderLeft: '4px solid #10b981', // Green accent for lessons
      backgroundColor: '#f0fdf4', // Light green background
      borderRadius: '0 10px 10px 0',
      boxShadow: '0 3px 12px rgba(16, 185, 129, 0.15)',
      color: '#1f2937',
      fontSize: '14px',
      lineHeight: '1.6',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      maxWidth: '100%',
      boxSizing: 'border-box'
    });
    
    // Header with title and stop button
    const header = document.createElement('div');
    header.className = 'ugt-lesson-header';
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px',
      paddingBottom: '10px',
      borderBottom: '1px solid rgba(16, 185, 129, 0.3)'
    });
    
    const title = document.createElement('div');
    title.className = 'ugt-lesson-title';
    title.innerHTML = `<strong style="color: #059669; font-size: 15px;">📚 Language Lesson</strong>`;
    
    // Button container for Stop and Close buttons
    const buttonContainer = document.createElement('div');
    buttonContainer.style.display = 'flex';
    buttonContainer.style.gap = '8px';
    buttonContainer.style.alignItems = 'center';
    
    // Stop button for cancelling generation
    const stopButton = document.createElement('button');
    stopButton.className = 'ugt-lesson-stop-btn';
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
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext) {
        sessionContext.cancelRequested = true;
        sessionContext.isStreaming = false;
        
        // Send cancel message to background
        chrome.runtime.sendMessage({
          type: 'LESSON_CANCEL',
          payload: { sessionId: sessionId }
        });
        
        // Update content to show cancellation
        const contentWrapper = container.querySelector('.ugt-lesson-content');
        if (contentWrapper && sessionContext.lessonContent) {
          contentWrapper.innerHTML = simpleMarkdownToHtml(sessionContext.lessonContent + '\n\n_[Generation stopped by user]_');
        }
        
        // Remove stop button
        stopButton.remove();
        
        // Still allow chat if there's some content
        if (sessionContext.lessonContent && sessionContext.lessonContent.trim()) {
          // Add action buttons if not already present
          if (!container.querySelector('.ugt-message-actions')) {
            const htmlContent = simpleMarkdownToHtml(sessionContext.lessonContent);
            const actionButtons = createMessageActionButtons(sessionContext.lessonContent, htmlContent);
            container.appendChild(actionButtons);
          }
          
          createLessonChatInterface(container, sessionContext.originalText, sessionContext.lessonContent, sessionId);
        }
      }
    });
    stopButton.addEventListener('mousedown', (e) => e.stopPropagation());
    
    // Close button to remove the panel
    const closeButton = document.createElement('button');
    closeButton.className = 'ugt-lesson-close-btn';
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
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext && sessionContext.isStreaming) {
        // Cancel any ongoing streaming
        chrome.runtime.sendMessage({
          type: 'LESSON_CANCEL',
          payload: { sessionId: sessionId }
        });
      }
      lessonSessions.delete(sessionId);
      container.remove();
    });
    closeButton.addEventListener('mousedown', (e) => e.stopPropagation());
    
    buttonContainer.appendChild(stopButton);
    buttonContainer.appendChild(closeButton);
    
    header.appendChild(title);
    header.appendChild(buttonContainer);
    container.appendChild(header);
    
    // Original text preview (collapsible)
    const originalPreview = document.createElement('div');
    originalPreview.className = 'ugt-lesson-original';
    Object.assign(originalPreview.style, {
      marginBottom: '14px',
      padding: '10px 14px',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      borderRadius: '6px',
      fontSize: '13px',
      color: '#374151'
    });
    
    const truncatedText = originalText.length > 150 ? originalText.substring(0, 150) + '...' : originalText;
    originalPreview.innerHTML = `<strong style="color: #059669;">Studying:</strong> "${escapeHtml(truncatedText)}"`;
    container.appendChild(originalPreview);
    
    // Content wrapper for the lesson
    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'ugt-lesson-content';
    contentWrapper.innerHTML = `<span style="color: #9ca3af;">Generating lesson...</span>`;
    container.appendChild(contentWrapper);
    
    return container;
  }
  
  // Update the lesson content during streaming
  function updateLessonContent(container, content) {
    if (!container) return;
    const contentWrapper = container.querySelector('.ugt-lesson-content');
    if (contentWrapper) {
      contentWrapper.innerHTML = simpleMarkdownToHtml(content);
    }
  }
  
  // Create the chat interface for lesson follow-up questions
  function createLessonChatInterface(container, originalText, lessonContent, sessionId) {
    // Check if chat interface already exists
    if (container.querySelector('.ugt-lesson-chat-section')) {
      return;
    }
    
    // Create chat section wrapper
    const chatSection = document.createElement('div');
    chatSection.className = 'ugt-lesson-chat-section';
    Object.assign(chatSection.style, {
      marginTop: '18px',
      paddingTop: '14px',
      borderTop: '1px solid rgba(16, 185, 129, 0.3)'
    });
    
    // Chat history area (initially hidden, shows when there's history)
    const chatHistory = document.createElement('div');
    chatHistory.className = 'ugt-lesson-chat-history';
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
    inputRow.className = 'ugt-lesson-chat-input-row';
    Object.assign(inputRow.style, {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    });
    
    // Text input
    const chatInput = document.createElement('input');
    chatInput.type = 'text';
    chatInput.className = 'ugt-lesson-chat-input';
    chatInput.placeholder = 'Ask a follow-up question about this lesson...';
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
    
    // Focus styles
    chatInput.addEventListener('focus', () => {
      chatInput.style.borderColor = '#10b981';
      chatInput.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.15)';
    });
    chatInput.addEventListener('blur', () => {
      chatInput.style.borderColor = '#d1d5db';
      chatInput.style.boxShadow = 'none';
    });
    // Prevent clicks on input from triggering parent links (e.g., when selecting a URL)
    chatInput.addEventListener('mousedown', (e) => e.stopPropagation());
    chatInput.addEventListener('click', (e) => e.stopPropagation());
    
    // Send button
    const sendButton = document.createElement('button');
    sendButton.className = 'ugt-lesson-chat-send';
    sendButton.textContent = 'Ask';
    Object.assign(sendButton.style, {
      padding: '12px 20px',
      backgroundColor: '#10b981',
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
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext?.isChatStreaming) {
        sendButton.style.backgroundColor = '#dc2626';
      } else {
        sendButton.style.backgroundColor = '#059669';
      }
    });
    sendButton.addEventListener('mouseleave', () => {
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext?.isChatStreaming) {
        sendButton.style.backgroundColor = '#ef4444';
      } else {
        sendButton.style.backgroundColor = '#10b981';
      }
    });
    
    // Handle cancel action
    const cancelChatRequest = () => {
      const sessionContext = lessonSessions.get(sessionId);
      if (!sessionContext || !sessionContext.isChatStreaming) return;
      
      // Set cancel flag
      sessionContext.chatCancelRequested = true;
      
      // Send cancel message to background
      chrome.runtime.sendMessage({
        type: 'LESSON_CANCEL',
        payload: { sessionId: sessionId }
      });
      
      // Find the streaming message and mark it as cancelled
      const streamingMsg = container.querySelector(`.ugt-lesson-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
      if (streamingMsg) {
        const currentContent = streamingMsg.dataset.content || '';
        const cancelledContent = currentContent + (currentContent ? '\n\n' : '') + '_[Generation stopped by user]_';
        finishLessonChatResponse(streamingMsg, cancelledContent, false, sessionId);
        
        // Add to chat history
        if (!sessionContext.chatHistory) sessionContext.chatHistory = [];
        sessionContext.chatHistory.push({ role: 'assistant', content: cancelledContent });
      }
      
      resetLessonChatInputState(chatInput, sendButton, sessionId);
    };
    
    // Handle send action
    const sendChatMessage = () => {
      const question = chatInput.value.trim();
      
      const sessionContext = lessonSessions.get(sessionId);
      if (!question || !sessionContext || sessionContext.isChatStreaming) return;
      
      // Reset cancel flag
      sessionContext.chatCancelRequested = false;
      
      // Initialize chat history if needed
      if (!sessionContext.chatHistory) sessionContext.chatHistory = [];
      
      // Add user message to history display
      addLessonChatMessage(chatHistory, 'user', question, sessionId);
      sessionContext.chatHistory.push({ role: 'user', content: question });
      
      // Clear input
      chatInput.value = '';
      
      // Show loading state - transform to Stop button
      sessionContext.isChatStreaming = true;
      sendButton.textContent = 'Stop';
      sendButton.style.backgroundColor = '#ef4444';
      sendButton.style.cursor = 'pointer';
      sendButton.title = 'Stop generation';
      chatInput.disabled = true;
      
      // Create placeholder for assistant response
      const assistantMsgDiv = addLessonChatMessage(chatHistory, 'assistant', '', sessionId);
      assistantMsgDiv.dataset.streaming = 'true';
      assistantMsgDiv.dataset.sessionId = sessionId;
      
      // Send to background script
      chrome.runtime.sendMessage({
        type: 'LESSON_FOLLOWUP',
        payload: {
          sessionId: sessionId,
          question: question,
          originalText: sessionContext.originalText,
          lessonContent: sessionContext.lessonContent,
          chatHistory: sessionContext.chatHistory.slice(0, -1)
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Lesson chat followup error:', chrome.runtime.lastError);
          finishLessonChatResponse(assistantMsgDiv, 'Error: ' + chrome.runtime.lastError.message, true, sessionId);
          resetLessonChatInputState(chatInput, sendButton, sessionId);
        }
      });
    };
    
    // Button click handler - Send or Stop depending on state
    sendButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext && sessionContext.isChatStreaming) {
        cancelChatRequest();
      } else {
        sendChatMessage();
      }
    });
    sendButton.addEventListener('mousedown', (e) => e.stopPropagation());
    
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendChatMessage();
      }
    });
    
    inputRow.appendChild(chatInput);
    inputRow.appendChild(sendButton);
    chatSection.appendChild(inputRow);
    
    container.appendChild(chatSection);
  }
  
  // Add a message to the lesson chat history
  function addLessonChatMessage(historyContainer, role, content, sessionId = null) {
    // Show history container if hidden
    historyContainer.style.display = 'block';
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `ugt-lesson-chat-message ugt-lesson-chat-${role}`;
    Object.assign(msgDiv.style, {
      marginBottom: '12px',
      padding: '10px 14px',
      borderRadius: '8px',
      fontSize: '13px',
      lineHeight: '1.5'
    });
    
    if (role === 'user') {
      Object.assign(msgDiv.style, {
        backgroundColor: '#d1fae5', // Light green for user
        marginLeft: '24px',
        borderBottomRightRadius: '2px'
      });
      msgDiv.innerHTML = `<strong style="color: #047857;">You:</strong> ${escapeHtml(content)}`;
    } else {
      Object.assign(msgDiv.style, {
        backgroundColor: '#f3f4f6',
        marginRight: '24px',
        borderBottomLeftRadius: '2px'
      });
      if (content) {
        msgDiv.innerHTML = `<strong style="color: #10b981;">AI:</strong> ${simpleMarkdownToHtml(content)}`;
      } else {
        msgDiv.innerHTML = `<strong style="color: #10b981;">AI:</strong> <span style="color: #9ca3af;">Thinking...</span>`;
      }
    }
    
    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
    
    return msgDiv;
  }
  
  // Update streaming message content for lesson chat
  function updateLessonChatStreamingMessage(msgDiv, content) {
    if (!msgDiv) return;
    msgDiv.innerHTML = `<strong style="color: #10b981;">AI:</strong> ${simpleMarkdownToHtml(content)}`;
    const historyContainer = msgDiv.parentElement;
    if (historyContainer) {
      const isNearBottom = historyContainer.scrollHeight - historyContainer.scrollTop - historyContainer.clientHeight < 100;
      if (isNearBottom) {
        historyContainer.scrollTop = historyContainer.scrollHeight;
      }
    }
  }
  
  // Finish lesson chat response
  function finishLessonChatResponse(msgDiv, content, isError = false, sessionId = null) {
    if (!msgDiv) return;
    
    const htmlContent = simpleMarkdownToHtml(content);
    
    if (isError) {
      msgDiv.innerHTML = `<strong style="color: #ef4444;">Error:</strong> <span style="color: #ef4444;">${escapeHtml(content)}</span>`;
    } else {
      // Create content wrapper
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'ugt-message-content';
      contentWrapper.innerHTML = `<strong style="color: #10b981;">AI:</strong> ${htmlContent}`;
      
      // Clear and rebuild the message div
      msgDiv.innerHTML = '';
      msgDiv.appendChild(contentWrapper);
      
      // Add action buttons for non-error responses
      const actionButtons = createMessageActionButtons(content, htmlContent);
      msgDiv.appendChild(actionButtons);
    }
    
    // Remove streaming flag
    msgDiv.removeAttribute('data-streaming');
    
    const sessionContext = sessionId ? lessonSessions.get(sessionId) : null;
    if (sessionContext) {
      sessionContext.isChatStreaming = false;
    }
  }
  
  // Reset lesson chat input state
  function resetLessonChatInputState(chatInput, sendButton, sessionId) {
    const sessionContext = lessonSessions.get(sessionId);
    if (sessionContext) {
      sessionContext.isChatStreaming = false;
      sessionContext.chatCancelRequested = false;
    }
    
    chatInput.disabled = false;
    sendButton.textContent = 'Ask';
    sendButton.style.backgroundColor = '#10b981';
    sendButton.style.cursor = 'pointer';
    sendButton.title = '';
  }

  // ========================================
  // ASK ABOUT SELECTION FEATURE
  // ========================================
  
  // Handle the ASK_ABOUT message from the context menu
  function handleAskAbout(selectedText) {
    if (!selectedText || !selectedText.trim()) {
      console.warn('ASK_ABOUT called without text');
      return;
    }
    
    // Create the session ID
    const sessionId = generateAskSessionId();
    
    // Check for standalone mode
    const isStandalone = window.UGT_STANDALONE_MODE && window.UGT_STANDALONE_MODE.container;
    
    // Create the ask container
    const askContainer = createAskContainer(selectedText, sessionId);
    
    if (isStandalone) {
      // Standalone mode: append to the standalone container
      window.UGT_STANDALONE_MODE.container.appendChild(askContainer);
    } else {
      // Normal mode: insert after selection
      // Get the selection range
      let activeRange = savedRange;
      
      if (!activeRange) {
        const currentSelection = document.getSelection();
        if (currentSelection && currentSelection.rangeCount > 0) {
          activeRange = currentSelection.getRangeAt(0).cloneRange();
        }
      }
      
      // Insert after the selection, but OUTSIDE any anchor elements
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
            // Insert after the anchor element instead
            insertAfterElement = currentElement;
            break;
          }
          currentElement = currentElement.parentNode;
        }
        
        // Insert the ask container after the element (outside any anchor)
        if (insertAfterElement && insertAfterElement.parentNode) {
          insertAfterElement.parentNode.insertBefore(askContainer, insertAfterElement.nextSibling);
        } else {
          // Fallback: use range insertion
          const insertionRange = activeRange.cloneRange();
          insertionRange.collapse(false);
          insertionRange.insertNode(askContainer);
        }
        
        window.getSelection().removeAllRanges();
      } else {
        console.warn('No selection range available for ask insertion, appending to body');
        document.body.appendChild(askContainer);
      }
      
      // Scroll to the ask container
      askContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    
    // Store session context
    const sessionContext = {
      originalText: selectedText,
      chatHistory: [],
      container: askContainer,
      isStreaming: false,
      cancelRequested: false,
      currentContent: ''
    };
    askSessions.set(sessionId, sessionContext);
    
    // Focus the input field so user can start typing immediately
    const chatInput = askContainer.querySelector('.ugt-ask-input');
    if (chatInput) {
      setTimeout(() => chatInput.focus(), 100);
    }
  }
  
  // Create the ask container element
  function createAskContainer(originalText, sessionId) {
    const container = document.createElement('div');
    container.className = 'ugt-ask-container';
    container.dataset.askSessionId = sessionId;
    
    // Styling with a blue accent for ask feature
    Object.assign(container.style, {
      marginLeft: '0',
      marginTop: '16px',
      marginBottom: '16px',
      padding: '18px 22px',
      borderLeft: '4px solid #3b82f6', // Blue accent for ask
      backgroundColor: '#eff6ff', // Light blue background
      borderRadius: '0 10px 10px 0',
      boxShadow: '0 3px 12px rgba(59, 130, 246, 0.15)',
      color: '#1f2937',
      fontSize: '14px',
      lineHeight: '1.6',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      maxWidth: '100%',
      boxSizing: 'border-box'
    });
    
    // Header with title and close button
    const header = document.createElement('div');
    header.className = 'ugt-ask-header';
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px',
      paddingBottom: '10px',
      borderBottom: '1px solid rgba(59, 130, 246, 0.3)'
    });
    
    const title = document.createElement('div');
    title.className = 'ugt-ask-title';
    title.innerHTML = `<strong style="color: #2563eb; font-size: 15px;">💬 Ask About Selection</strong>`;
    
    // Close button to remove the panel
    const closeButton = document.createElement('button');
    closeButton.className = 'ugt-ask-close-btn';
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
      const sessionContext = askSessions.get(sessionId);
      if (sessionContext && sessionContext.isStreaming) {
        // Cancel any ongoing streaming
        chrome.runtime.sendMessage({
          type: 'ASK_CANCEL',
          payload: { sessionId: sessionId }
        });
      }
      askSessions.delete(sessionId);
      container.remove();
    });
    closeButton.addEventListener('mousedown', (e) => e.stopPropagation());
    
    header.appendChild(title);
    header.appendChild(closeButton);
    container.appendChild(header);
    
    // Original text preview (collapsible)
    const originalPreview = document.createElement('div');
    originalPreview.className = 'ugt-ask-original';
    Object.assign(originalPreview.style, {
      marginBottom: '14px',
      padding: '10px 14px',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      borderRadius: '6px',
      fontSize: '13px',
      color: '#374151'
    });
    
    const truncatedText = originalText.length > 150 ? originalText.substring(0, 150) + '...' : originalText;
    originalPreview.innerHTML = `<strong style="color: #2563eb;">Selected:</strong> "${escapeHtml(truncatedText)}"`;
    container.appendChild(originalPreview);
    
    // Chat history area (initially hidden, shows when there's history)
    const chatHistory = document.createElement('div');
    chatHistory.className = 'ugt-ask-chat-history';
    Object.assign(chatHistory.style, {
      display: 'none',
      maxHeight: '350px',
      overflowY: 'auto',
      marginBottom: '14px',
      padding: '10px',
      backgroundColor: 'rgba(255, 255, 255, 0.6)',
      borderRadius: '8px'
    });
    container.appendChild(chatHistory);
    
    // Input area
    const inputRow = document.createElement('div');
    inputRow.className = 'ugt-ask-input-row';
    Object.assign(inputRow.style, {
      display: 'flex',
      gap: '10px',
      alignItems: 'center'
    });
    
    const chatInput = document.createElement('input');
    chatInput.type = 'text';
    chatInput.className = 'ugt-ask-input';
    chatInput.placeholder = 'Ask a question about this text...';
    Object.assign(chatInput.style, {
      flex: '1',
      padding: '10px 14px',
      borderRadius: '8px',
      border: '1px solid #d1d5db',
      fontSize: '14px',
      color: '#1f2937',
      backgroundColor: '#ffffff',
      outline: 'none',
      transition: 'border-color 0.2s, box-shadow 0.2s'
    });
    chatInput.addEventListener('focus', () => {
      chatInput.style.borderColor = '#3b82f6';
      chatInput.style.boxShadow = '0 0 0 3px rgba(59, 130, 246, 0.1)';
    });
    chatInput.addEventListener('blur', () => {
      chatInput.style.borderColor = '#d1d5db';
      chatInput.style.boxShadow = 'none';
    });
    // Prevent clicks on input from triggering parent links (e.g., when selecting a URL)
    chatInput.addEventListener('mousedown', (e) => e.stopPropagation());
    chatInput.addEventListener('click', (e) => e.stopPropagation());
    
    const sendButton = document.createElement('button');
    sendButton.className = 'ugt-ask-send-btn';
    sendButton.textContent = 'Ask';
    Object.assign(sendButton.style, {
      padding: '10px 18px',
      backgroundColor: '#3b82f6',
      color: '#ffffff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background-color 0.2s'
    });
    
    sendButton.addEventListener('mouseenter', () => {
      const sessionContext = askSessions.get(sessionId);
      if (sessionContext && sessionContext.isStreaming) {
        sendButton.style.backgroundColor = '#dc2626';
      } else {
        sendButton.style.backgroundColor = '#2563eb';
      }
    });
    sendButton.addEventListener('mouseleave', () => {
      const sessionContext = askSessions.get(sessionId);
      if (sessionContext && sessionContext.isStreaming) {
        sendButton.style.backgroundColor = '#ef4444';
      } else {
        sendButton.style.backgroundColor = '#3b82f6';
      }
    });
    
    // Cancel function
    const cancelAskRequest = () => {
      const sessionContext = askSessions.get(sessionId);
      if (sessionContext && sessionContext.isStreaming) {
        sessionContext.cancelRequested = true;
        
        // Send cancel message to background
        chrome.runtime.sendMessage({
          type: 'ASK_CANCEL',
          payload: { sessionId: sessionId }
        });
        
        // Update the streaming message to show it was cancelled
        const streamingMsg = sessionContext.container?.querySelector(`.ugt-ask-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        if (streamingMsg) {
          const currentContent = sessionContext.currentContent || '';
          if (currentContent) {
            // Had partial content - show it with cancelled notice
            finishAskChatResponse(streamingMsg, currentContent + '\n\n*(Generation stopped)*', false, sessionId);
          } else {
            // No content yet - just remove the placeholder
            streamingMsg.remove();
          }
        }
        
        // Reset the input state immediately
        resetAskInputState(chatInput, sendButton, sessionId);
      }
    };
    
    // Send message function
    const sendAskMessage = () => {
      const question = chatInput.value.trim();
      if (!question) return;
      
      const sessionContext = askSessions.get(sessionId);
      if (!sessionContext || sessionContext.isStreaming) return;
      
      // Initialize chat history if needed
      if (!sessionContext.chatHistory) sessionContext.chatHistory = [];
      
      // Add user message to history display
      addAskChatMessage(chatHistory, 'user', question, sessionId);
      sessionContext.chatHistory.push({ role: 'user', content: question });
      
      // Clear input
      chatInput.value = '';
      
      // Show loading state - transform to Stop button
      sessionContext.isStreaming = true;
      sessionContext.currentContent = '';
      sendButton.textContent = 'Stop';
      sendButton.style.backgroundColor = '#ef4444';
      sendButton.style.cursor = 'pointer';
      sendButton.title = 'Stop generation';
      chatInput.disabled = true;
      
      // Create placeholder for assistant response
      const assistantMsgDiv = addAskChatMessage(chatHistory, 'assistant', '', sessionId);
      assistantMsgDiv.dataset.streaming = 'true';
      assistantMsgDiv.dataset.sessionId = sessionId;
      
      // Send to background script
      chrome.runtime.sendMessage({
        type: 'ASK_REQUEST',
        payload: {
          sessionId: sessionId,
          selectedText: sessionContext.originalText,
          question: question,
          chatHistory: sessionContext.chatHistory.slice(0, -1)
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('Ask request error:', chrome.runtime.lastError);
          finishAskChatResponse(assistantMsgDiv, 'Error: ' + chrome.runtime.lastError.message, true, sessionId);
          resetAskInputState(chatInput, sendButton, sessionId);
        }
      });
    };
    
    // Button click handler - Send or Stop depending on state
    sendButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const sessionContext = askSessions.get(sessionId);
      if (sessionContext && sessionContext.isStreaming) {
        cancelAskRequest();
      } else {
        sendAskMessage();
      }
    });
    sendButton.addEventListener('mousedown', (e) => e.stopPropagation());
    
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        sendAskMessage();
      }
    });
    
    inputRow.appendChild(chatInput);
    inputRow.appendChild(sendButton);
    container.appendChild(inputRow);
    
    return container;
  }
  
  // Add a message to the ask chat history
  function addAskChatMessage(historyContainer, role, content, sessionId = null) {
    // Show history container if hidden
    historyContainer.style.display = 'block';
    
    const msgDiv = document.createElement('div');
    msgDiv.className = `ugt-ask-chat-message ugt-ask-chat-${role}`;
    Object.assign(msgDiv.style, {
      marginBottom: '12px',
      padding: '10px 14px',
      borderRadius: '8px',
      fontSize: '13px',
      lineHeight: '1.5'
    });
    
    if (role === 'user') {
      Object.assign(msgDiv.style, {
        backgroundColor: '#dbeafe', // Light blue for user
        marginLeft: '24px',
        borderBottomRightRadius: '2px'
      });
      msgDiv.innerHTML = `<strong style="color: #1d4ed8;">You:</strong> ${escapeHtml(content)}`;
    } else {
      Object.assign(msgDiv.style, {
        backgroundColor: '#f3f4f6',
        marginRight: '24px',
        borderBottomLeftRadius: '2px'
      });
      if (content) {
        msgDiv.innerHTML = `<strong style="color: #3b82f6;">AI:</strong> ${simpleMarkdownToHtml(content)}`;
      } else {
        msgDiv.innerHTML = `<strong style="color: #3b82f6;">AI:</strong> <span style="color: #9ca3af;">Thinking...</span>`;
      }
    }
    
    historyContainer.appendChild(msgDiv);
    historyContainer.scrollTop = historyContainer.scrollHeight;
    
    return msgDiv;
  }
  
  // Update streaming message content for ask chat
  function updateAskStreamingMessage(msgDiv, content) {
    if (!msgDiv) return;
    msgDiv.innerHTML = `<strong style="color: #3b82f6;">AI:</strong> ${simpleMarkdownToHtml(content)}`;
    const historyContainer = msgDiv.parentElement;
    if (historyContainer) {
      const isNearBottom = historyContainer.scrollHeight - historyContainer.scrollTop - historyContainer.clientHeight < 100;
      if (isNearBottom) {
        historyContainer.scrollTop = historyContainer.scrollHeight;
      }
    }
  }
  
  // Finish ask chat response
  function finishAskChatResponse(msgDiv, content, isError = false, sessionId = null) {
    if (!msgDiv) return;
    
    const htmlContent = simpleMarkdownToHtml(content);
    
    if (isError) {
      msgDiv.innerHTML = `<strong style="color: #ef4444;">Error:</strong> <span style="color: #ef4444;">${escapeHtml(content)}</span>`;
    } else {
      // Create content wrapper
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'ugt-message-content';
      contentWrapper.innerHTML = `<strong style="color: #3b82f6;">AI:</strong> ${htmlContent}`;
      
      // Clear and rebuild the message div
      msgDiv.innerHTML = '';
      msgDiv.appendChild(contentWrapper);
      
      // Add action buttons for non-error responses
      const actionButtons = createMessageActionButtons(content, htmlContent);
      msgDiv.appendChild(actionButtons);
    }
    
    // Remove streaming flag
    msgDiv.removeAttribute('data-streaming');
    
    const sessionContext = sessionId ? askSessions.get(sessionId) : null;
    if (sessionContext) {
      sessionContext.isStreaming = false;
    }
  }
  
  // Reset ask input state
  function resetAskInputState(chatInput, sendButton, sessionId) {
    const sessionContext = askSessions.get(sessionId);
    if (sessionContext) {
      sessionContext.isStreaming = false;
      sessionContext.cancelRequested = false;
    }
    
    chatInput.disabled = false;
    sendButton.textContent = 'Ask';
    sendButton.style.backgroundColor = '#3b82f6';
    sendButton.style.cursor = 'pointer';
    sendButton.title = '';
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
    
    // Convert **bold** to <strong> with explicit color to prevent page CSS override
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: inherit; background: transparent;">$1</strong>');
    
    // Convert __bold__ to <strong>
    html = html.replace(/__([^_]+)__/g, '<strong style="color: inherit; background: transparent;">$1</strong>');
    
    // Convert _italic_ to <em>
    html = html.replace(/(?<![_\w])_([^_]+)_(?![_\w])/g, '<em style="color: inherit; background: transparent;">$1</em>');
    
    // Convert *italic* to <em> (but not at start of line to avoid bullet conflicts)
    html = html.replace(/(?<!^|\n|\*)\*([^*\n]+)\*(?!\*)/g, '<em style="color: inherit; background: transparent;">$1</em>');
    
    // Convert ~~strikethrough~~ to <del>
    html = html.replace(/~~([^~]+)~~/g, '<del style="color: inherit; background: transparent;">$1</del>');
    
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
        // Use defensive inline styles to prevent page CSS interference (dark backgrounds, icons, etc.)
        processedLines.push(`<div style="all: revert; display: block; font-size: ${sizes[level]}; font-weight: ${weights[level]}; margin: 12px 0 8px 0; color: #1a1a2e; background: transparent; border: none; padding: 0;">${headerText}</div>`);
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
          processedLines.push('<blockquote style="all: revert; border-left: 4px solid #6b8afd; margin: 8px 0; padding: 8px 16px; background: rgba(107, 138, 253, 0.05); color: #4a5568; font-style: italic;">');
          inBlockquote = true;
        }
        processedLines.push(`<p style="all: revert; margin: 4px 0; color: #4a5568; background: transparent;">${blockquoteMatch[1] || '&nbsp;'}</p>`);
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
          processedLines.push('<ol style="all: revert; margin: 8px 0 8px 20px; padding-left: 0; list-style-position: outside; color: #2d3748; background: transparent;">');
          inOrderedList = true;
        }
        processedLines.push(`<li style="all: revert; margin: 4px 0; color: #2d3748; background: transparent; display: list-item;">${orderedMatch[2]}</li>`);
        continue;
      }
      
      // Check for unordered list / bullet points (*, -, •)
      const bulletMatch = line.match(/^[\*\-•]\s+(.+)$/);
      if (bulletMatch) {
        if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
        if (!inUnorderedList) {
          processedLines.push('<ul style="all: revert; margin: 8px 0 8px 20px; padding-left: 0; list-style-type: disc; list-style-position: outside; color: #2d3748; background: transparent;">');
          inUnorderedList = true;
        }
        processedLines.push(`<li style="all: revert; margin: 4px 0; color: #2d3748; background: transparent; display: list-item;">${bulletMatch[1]}</li>`);
        continue;
      }
      
      // Close any open lists for non-list content
      if (inUnorderedList) { processedLines.push('</ul>'); inUnorderedList = false; }
      if (inOrderedList) { processedLines.push('</ol>'); inOrderedList = false; }
      
      if (line === '') {
        // Empty line - add spacing
        processedLines.push('<div style="height: 8px;"></div>');
      } else {
        // Regular paragraph - use defensive styling
        processedLines.push(`<p style="all: revert; margin: 6px 0; color: #2d3748; background: transparent;">${line}</p>`);
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
      originalText: '', // Will be set later when translation completes (source language)
      translatedText: '', // Will be set later when translation completes (target language)
      culturalNuances: culturalNuancesText,
      chatHistory: [],
      container: container,
      isStreaming: false,
      providerName: '',
      cancelRequested: false // Flag to signal cancellation
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
    // Prevent clicks on input from triggering parent links (e.g., when selecting a URL)
    chatInput.addEventListener('mousedown', (e) => e.stopPropagation());
    chatInput.addEventListener('click', (e) => e.stopPropagation());
    
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
      if (currentSession?.isStreaming) {
        sendButton.style.backgroundColor = '#dc2626'; // Darker red on hover when Stop
      } else {
        sendButton.style.backgroundColor = '#5a7be0';
      }
    });
    sendButton.addEventListener('mouseleave', () => {
      const currentSession = chatSessions.get(sessionId);
      if (currentSession?.isStreaming) {
        sendButton.style.backgroundColor = '#ef4444'; // Red when Stop
      } else {
        sendButton.style.backgroundColor = '#6b8afd';
      }
    });
    
    // Handle cancel action
    const cancelRequest = () => {
      const currentSession = chatSessions.get(sessionId);
      if (!currentSession || !currentSession.isStreaming) return;
      
      // Set cancel flag
      currentSession.cancelRequested = true;
      
      // Send cancel message to background
      chrome.runtime.sendMessage({
        type: 'CHAT_CANCEL',
        payload: { sessionId: sessionId }
      });
      
      // Find the streaming message and mark it as cancelled
      const streamingMsg = currentSession.container.querySelector(`.ugt-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
      if (streamingMsg) {
        const currentContent = streamingMsg.dataset.content || '';
        const cancelledContent = currentContent + (currentContent ? '\n\n' : '') + '_[Generation stopped by user]_';
        finishChatResponse(streamingMsg, cancelledContent, false, sessionId);
        
        // Add to chat history
        currentSession.chatHistory.push({ role: 'assistant', content: cancelledContent });
      }
      
      resetChatInputState(chatInput, sendButton, sessionId);
    };
    
    // Handle send action
    const sendMessage = () => {
      const question = chatInput.value.trim();
      
      // Get the session context for this chat interface
      const currentSession = chatSessions.get(sessionId);
      if (!question || !currentSession || currentSession.isStreaming) return;
      
      // Reset cancel flag
      currentSession.cancelRequested = false;
      
      // Add user message to history
      addChatMessage(chatHistory, 'user', question, sessionId);
      currentSession.chatHistory.push({ role: 'user', content: question });
      
      // Clear input
      chatInput.value = '';
      
      // Show loading state - transform to Stop button
      currentSession.isStreaming = true;
      sendButton.textContent = 'Stop';
      sendButton.style.backgroundColor = '#ef4444';
      sendButton.style.cursor = 'pointer';
      sendButton.title = 'Stop generation';
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
          translatedText: currentSession.translatedText || '',
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
    
    // Button click handler - Send or Stop depending on state
    sendButton.addEventListener('click', (e) => {
      e.stopPropagation();
      const currentSession = chatSessions.get(sessionId);
      if (currentSession && currentSession.isStreaming) {
        cancelRequest();
      } else {
        sendMessage();
      }
    });
    sendButton.addEventListener('mousedown', (e) => e.stopPropagation());
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
      // Only auto-scroll if user is already near the bottom (within 100px)
      // This allows users to scroll up and read while streaming continues
      const isNearBottom = historyContainer.scrollHeight - historyContainer.scrollTop - historyContainer.clientHeight < 100;
      if (isNearBottom) {
        historyContainer.scrollTop = historyContainer.scrollHeight;
      }
    }
  }
  
  // Finish chat response (success or error)
  function finishChatResponse(msgDiv, content, isError = false, sessionId = null) {
    if (!msgDiv) return;
    
    const htmlContent = simpleMarkdownToHtml(content);
    
    if (isError) {
      msgDiv.innerHTML = `<strong style="color: #ef4444;">Error:</strong> <span style="color: #ef4444;">${escapeHtml(content)}</span>`;
    } else {
      // Create content wrapper
      const contentWrapper = document.createElement('div');
      contentWrapper.className = 'ugt-message-content';
      contentWrapper.innerHTML = `<strong style="color: #6b8afd;">AI:</strong> ${htmlContent}`;
      
      // Clear and rebuild the message div
      msgDiv.innerHTML = '';
      msgDiv.appendChild(contentWrapper);
      
      // Add action buttons for non-error responses
      const actionButtons = createMessageActionButtons(content, htmlContent);
      msgDiv.appendChild(actionButtons);
    }
    
    delete msgDiv.dataset.streaming;
    delete msgDiv.dataset.sessionId;
    delete msgDiv.dataset.content;
    
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
        sessionContext.cancelRequested = false;
      }
    }
    sendButton.textContent = 'Send';
    sendButton.style.backgroundColor = '#6b8afd';
    sendButton.style.cursor = 'pointer';
    sendButton.title = '';
    chatInput.disabled = false;
    chatInput.focus();
  }
  
  // Escape HTML for safe display
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Copy text to clipboard with visual feedback
  async function copyToClipboard(text, feedbackElement = null) {
    try {
      await navigator.clipboard.writeText(text);
      if (feedbackElement) {
        const originalText = feedbackElement.textContent;
        feedbackElement.textContent = '✓';
        feedbackElement.style.color = '#10b981';
        setTimeout(() => {
          feedbackElement.textContent = originalText;
          feedbackElement.style.color = '';
        }, 1500);
      }
      return true;
    } catch (e) {
      console.error('Failed to copy to clipboard:', e);
      return false;
    }
  }
  
  // Open content in a new browser tab (fullscreen view)
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
            @media print {
              body { padding: 0; }
            }
          </style>
        </head>
        <body>${htmlContent}</body>
        </html>
      `);
      newWindow.document.close();
    }
  }
  
  // Create action buttons for AI messages (copy, open in new tab)
  function createMessageActionButtons(rawContent, htmlContent) {
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
    const copyBtn = document.createElement('button');
    copyBtn.className = 'ugt-action-btn ugt-copy-btn';
    copyBtn.innerHTML = '📋';
    copyBtn.title = 'Copy to clipboard';
    Object.assign(copyBtn.style, {
      padding: '4px 8px',
      fontSize: '14px',
      backgroundColor: 'transparent',
      border: '1px solid #e5e7eb',
      borderRadius: '4px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      lineHeight: '1'
    });
    copyBtn.addEventListener('mouseenter', () => {
      copyBtn.style.backgroundColor = '#f3f4f6';
      copyBtn.style.borderColor = '#d1d5db';
    });
    copyBtn.addEventListener('mouseleave', () => {
      copyBtn.style.backgroundColor = 'transparent';
      copyBtn.style.borderColor = '#e5e7eb';
    });
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const success = await copyToClipboard(rawContent);
      if (success) {
        copyBtn.innerHTML = '✓';
        copyBtn.style.color = '#10b981';
        setTimeout(() => {
          copyBtn.innerHTML = '📋';
          copyBtn.style.color = '';
        }, 1500);
      }
    });
    actionsDiv.appendChild(copyBtn);
    
    // Open in new tab button
    const expandBtn = document.createElement('button');
    expandBtn.className = 'ugt-action-btn ugt-expand-btn';
    expandBtn.innerHTML = '↗';
    expandBtn.title = 'Open in new tab';
    Object.assign(expandBtn.style, {
      padding: '4px 8px',
      fontSize: '14px',
      backgroundColor: 'transparent',
      border: '1px solid #e5e7eb',
      borderRadius: '4px',
      cursor: 'pointer',
      transition: 'all 0.2s',
      lineHeight: '1'
    });
    expandBtn.addEventListener('mouseenter', () => {
      expandBtn.style.backgroundColor = '#f3f4f6';
      expandBtn.style.borderColor = '#d1d5db';
    });
    expandBtn.addEventListener('mouseleave', () => {
      expandBtn.style.backgroundColor = 'transparent';
      expandBtn.style.borderColor = '#e5e7eb';
    });
    expandBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openInNewTab(htmlContent);
    });
    actionsDiv.appendChild(expandBtn);
    
    return actionsDiv;
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
      verticalAlign: 'middle',
      gap: '3px',
      marginLeft: '8px',
      padding: '2px 10px',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontWeight: '500',
      color: '#6b8afd',
      backgroundColor: 'rgba(107, 138, 253, 0.08)',
      border: '1px solid rgba(107, 138, 253, 0.25)',
      borderRadius: '12px',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      lineHeight: '1.2'
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

  // Create the cultural nuances container for streaming
  function createCulturalNuancesContainer() {
    if (culturalNuancesContainer) return; // Already created
    if (!lastTranslatedElement) return; // No translation element to attach to
    
    culturalNuancesContainer = document.createElement('div');
    culturalNuancesContainer.className = 'ugt-cultural-nuances';
    
    // Close button in top-right corner to remove the panel
    const closeButton = document.createElement('button');
    closeButton.className = 'ugt-cultural-nuances-close-btn';
    closeButton.textContent = '✕';
    closeButton.title = 'Close';
    Object.assign(closeButton.style, {
      position: 'absolute',
      top: '8px',
      right: '8px',
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
      // Get the session ID and clean up
      const sessionId = culturalNuancesContainer.dataset.chatSessionId;
      if (sessionId) {
        const sessionContext = chatSessions.get(sessionId);
        if (sessionContext && sessionContext.isStreaming) {
          // Cancel any ongoing streaming
          chrome.runtime.sendMessage({
            type: 'CHAT_CANCEL',
            payload: { sessionId: sessionId }
          });
        }
        chatSessions.delete(sessionId);
      }
      culturalNuancesContainer.remove();
      culturalNuancesContainer = null;
      culturalNuancesContent = null;
    });
    closeButton.addEventListener('mousedown', (e) => e.stopPropagation());
    
    culturalNuancesContainer.appendChild(closeButton);
    
    // Create a content wrapper for the cultural nuances text
    culturalNuancesContent = document.createElement('div');
    culturalNuancesContent.className = 'ugt-cultural-nuances-content';
    culturalNuancesContainer.appendChild(culturalNuancesContent);
    
    // Enhanced styling for cultural nuances container
    Object.assign(culturalNuancesContainer.style, {
      position: 'relative',
      marginLeft: '0',
      marginTop: '12px',
      marginBottom: '8px',
      padding: '14px 18px',
      paddingRight: '40px', // Extra space for close button
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
    
    // Apply CSS reset to content wrapper to prevent page CSS interference
    Object.assign(culturalNuancesContent.style, {
      all: 'revert', // Reset inherited styles
      color: '#2d3748',
      fontSize: '14px',
      lineHeight: '1.6',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    });
    
    // Find the appropriate insertion point - must be OUTSIDE any anchor elements
    let insertionParent = lastTranslatedElement.parentNode;
    let insertAfter = lastTranslatedElement;
    
    // Walk up the DOM tree to find if we're inside an anchor element
    let currentElement = lastTranslatedElement;
    while (currentElement && currentElement !== document.body) {
      if (currentElement.tagName === 'A') {
        insertionParent = currentElement.parentNode;
        insertAfter = currentElement;
        break;
      }
      currentElement = currentElement.parentNode;
    }
    
    // Skip past the "Toggle All" button if it exists
    let insertBeforeRef = insertAfter.nextSibling;
    if (insertBeforeRef && insertBeforeRef.classList && insertBeforeRef.classList.contains('ugt-toggle-all-btn')) {
      insertBeforeRef = insertBeforeRef.nextSibling;
    }
    
    if (insertionParent) {
      insertionParent.insertBefore(culturalNuancesContainer, insertBeforeRef);
    } else {
      document.body.appendChild(culturalNuancesContainer);
    }
  }
  
  // Update the cultural nuances content with streaming text
  function updateCulturalNuancesContent(text) {
    if (!culturalNuancesContent) return;
    culturalNuancesContent.innerHTML = simpleMarkdownToHtml(text);
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

  // Helper function to check if two elements are in the same inline flow
  // Returns false if there's a line break, BR tag, or block element between them
  function areInSameInlineFlow(prev, current) {
    if (!prev || !current) return false;
    
    const blockTags = ['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'TR', 'TD', 'TH', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'BODY', 'HTML'];
    
    // If same parent, check for BR/block elements/newlines between them
    if (prev.parentNode === current.parentNode) {
      let node = prev.nextSibling;
      while (node && node !== current) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toUpperCase();
          if (tagName === 'BR') return false;
          if (blockTags.includes(tagName)) return false;
        } else if (node.nodeType === Node.TEXT_NODE) {
          // If there's a text node with newlines, they're not in the same inline flow
          if (/[\n\r]/.test(node.nodeValue)) {
            return false;
          }
        }
        node = node.nextSibling;
      }
      return true;
    }
    
    // Different parents - check if they share the same block-level ancestor
    // This handles cases like: text <a>link</a> more text (where link is in different parent)
    function getBlockAncestor(el) {
      let node = el.parentNode;
      while (node && node.nodeType === Node.ELEMENT_NODE) {
        if (blockTags.includes(node.tagName.toUpperCase())) {
          return node;
        }
        node = node.parentNode;
      }
      return null;
    }
    
    const prevBlock = getBlockAncestor(prev);
    const currentBlock = getBlockAncestor(current);
    
    // If they share the same block ancestor, they're in the same inline flow
    // (e.g., both inside the same <p> or <div>)
    if (prevBlock && currentBlock && prevBlock === currentBlock) {
      // Still need to check if there's a BR between them within this block
      // Walk from prev to current looking for BRs
      function containsBRBetween(ancestor, el1, el2) {
        // Simple check: see if there's a BR element between the two elements
        // by checking if any BR in the ancestor is positioned between them
        const brs = ancestor.querySelectorAll('br');
        if (brs.length === 0) return false;
        
        // Use compareDocumentPosition to check ordering
        for (const br of brs) {
          const afterPrev = (prev.compareDocumentPosition(br) & Node.DOCUMENT_POSITION_FOLLOWING);
          const beforeCurrent = (current.compareDocumentPosition(br) & Node.DOCUMENT_POSITION_PRECEDING);
          if (afterPrev && beforeCurrent) {
            return true; // BR is between prev and current
          }
        }
        return false;
      }
      
      if (containsBRBetween(prevBlock, prev, current)) {
        return false;
      }
      
      return true;
    }
    
    // Different block ancestors = different lines/blocks
    return false;
  }

  function getContextImageElement(eventTarget) {
    if (!eventTarget || eventTarget.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    return eventTarget.closest?.('img') || null;
  }

  function getContextVideoElement(eventTarget, point = null) {
    if (!eventTarget || eventTarget.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    const directVideo = eventTarget.closest?.('video');
    if (directVideo) return directVideo;

    return findBestVideoTranslationCandidate({ point });
  }

  function imageSourceMatches(image, srcUrl) {
    if (!image || !srcUrl) return false;
    return image.currentSrc === srcUrl || image.src === srcUrl || image.getAttribute('src') === srcUrl;
  }

  function videoSourceMatches(video, srcUrl) {
    if (!video || !srcUrl) return false;
    return video.currentSrc === srcUrl || video.src === srcUrl || video.getAttribute('src') === srcUrl;
  }

  function getClippedImageRect(image) {
    const rect = image.getBoundingClientRect();
    const clipped = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(window.innerWidth, rect.right),
      bottom: Math.min(window.innerHeight, rect.bottom)
    };
    clipped.width = clipped.right - clipped.left;
    clipped.height = clipped.bottom - clipped.top;
    return { rect, clipped };
  }

  function pointIsInsideRect(point, rect) {
    if (!point || !rect) return false;
    return point.clientX >= rect.left && point.clientX <= rect.right && point.clientY >= rect.top && point.clientY <= rect.bottom;
  }

  function scoreVideoTranslationCandidate(video, options = {}) {
    if (!video?.isConnected) return -1;

    const style = getComputedStyle(video);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      return -1;
    }

    const { clipped } = getClippedImageRect(video);
    if (clipped.width < 80 || clipped.height < 45) return -1;

    const visibleArea = clipped.width * clipped.height;
    let score = visibleArea;

    if (!video.paused && !video.ended) score += visibleArea * 1.5;
    if (video.readyState >= 2) score += 5000;
    if (pointIsInsideRect(options.point, video.getBoundingClientRect())) score += visibleArea * 3;
    if (options.srcUrl && videoSourceMatches(video, options.srcUrl)) score += visibleArea * 4;

    return score;
  }

  function findBestVideoTranslationCandidate(options = {}) {
    let bestVideo = null;
    let bestScore = -1;

    Array.from(document.querySelectorAll('video')).forEach((video) => {
      const score = scoreVideoTranslationCandidate(video, options);
      if (score > bestScore) {
        bestScore = score;
        bestVideo = video;
      }
    });

    return bestScore > 0 ? bestVideo : null;
  }

  function captureImageDisplayState(image) {
    return {
      src: image.src || '',
      currentSrc: image.currentSrc || '',
      srcAttr: image.getAttribute('src'),
      srcset: image.getAttribute('srcset'),
      sizes: image.getAttribute('sizes')
    };
  }

  function getImageTranslationTarget(srcUrl, requestId) {
    const now = Date.now();
    let image = null;

    if (lastContextImage && now - lastContextImage.time < 15000) {
      if (!srcUrl || imageSourceMatches(lastContextImage.image, srcUrl)) {
        image = lastContextImage.image;
      }
    }

    if (!image && srcUrl) {
      image = Array.from(document.images).find((candidate) => imageSourceMatches(candidate, srcUrl)) || null;
    }

    if (!image) {
      return { ok: false, error: 'Could not find the clicked image on the page.' };
    }

    const { rect, clipped } = getClippedImageRect(image);

    if (clipped.width < 8 || clipped.height < 8) {
      return { ok: false, error: 'The clicked image is not visible enough to capture.' };
    }

    imageTranslationTargets.set(requestId, {
      image,
      rect: clipped,
      originalRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      originalStyle: {
        width: image.style.width,
        height: image.style.height,
        objectFit: image.style.objectFit,
        filter: image.style.filter,
        opacity: image.style.opacity
      },
      originalImageState: captureImageDisplayState(image),
      originalImageDataUrl: '',
      originalCaptureSource: '',
      translatedDisplaySize: {
        width: rect.width,
        height: rect.height
      },
      sourceUrl: image.currentSrc || image.src || srcUrl || '',
      progressTitle: 'Preparing image',
      progressDetail: '',
      targetLanguage: '',
      translatedImageDataUrl: '',
      showingTranslatedImage: false,
      settled: false,
      overlay: null,
      actionsOverlay: null,
      actionsTimer: null,
      timer: null,
      startedAt: 0
    });

    return {
      ok: true,
      isTopFrame: window.self === window.top,
      sourceUrl: image.currentSrc || image.src || srcUrl || '',
      naturalWidth: image.naturalWidth || 0,
      naturalHeight: image.naturalHeight || 0,
      rect: clipped,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };
  }

  function getVideoFrameTranslationTarget(srcUrl, requestId, options = {}) {
    const now = Date.now();
    let video = null;

    if (lastContextVideo && now - lastContextVideo.time < 15000) {
      if (!srcUrl || videoSourceMatches(lastContextVideo.video, srcUrl) || options.mediaType === 'video') {
        video = lastContextVideo.video;
      }
    }

    if (!video && srcUrl) {
      video = Array.from(document.querySelectorAll('video')).find((candidate) => videoSourceMatches(candidate, srcUrl)) || null;
    }

    if (!video) {
      video = findBestVideoTranslationCandidate({ srcUrl });
    }

    if (!video) {
      return { ok: false, error: 'Could not find a visible video on the page.' };
    }

    const { rect, clipped } = getClippedImageRect(video);

    if (clipped.width < 80 || clipped.height < 45) {
      return { ok: false, error: 'The selected video is not visible enough to capture.' };
    }

    imageTranslationTargets.set(requestId, {
      kind: 'video-frame',
      video,
      rect: clipped,
      originalRect: {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      },
      originalStyle: {
        filter: video.style.filter,
        opacity: video.style.opacity
      },
      sourceUrl: video.currentSrc || video.src || srcUrl || '',
      progressTitle: 'Preparing frame',
      progressDetail: '',
      targetLanguage: '',
      translatedImageDataUrl: '',
      showingTranslatedImage: false,
      settled: false,
      overlay: null,
      actionsOverlay: null,
      actionsTimer: null,
      resultOverlay: null,
      captureCleanupTimer: null,
      capturePrepared: false,
      pausedForTranslation: false,
      wasPausedAtCapture: video.paused,
      timer: null,
      startedAt: 0
    });

    return {
      ok: true,
      isTopFrame: window.self === window.top,
      sourceUrl: video.currentSrc || video.src || srcUrl || '',
      naturalWidth: video.videoWidth || Math.round(rect.width) || 0,
      naturalHeight: video.videoHeight || Math.round(rect.height) || 0,
      rect: clipped,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };
  }

  function ensureImageTranslationStyles() {
    if (document.getElementById('ugt-image-translation-styles')) return;

    const style = document.createElement('style');
    style.id = 'ugt-image-translation-styles';
    style.textContent = `
      .ugt-image-translation-overlay {
        position: fixed;
        box-sizing: border-box;
        z-index: 2147483647;
        pointer-events: none;
        overflow: hidden;
        border-radius: 8px;
        border: 2px solid rgba(99, 102, 241, 0.9);
        background:
          linear-gradient(120deg, rgba(255,255,255,0.14), rgba(255,255,255,0.5), rgba(255,255,255,0.14)),
          rgba(15, 23, 42, 0.40);
        background-size: 220% 100%;
        box-shadow: 0 12px 38px rgba(15, 23, 42, 0.32), inset 0 0 0 1px rgba(255,255,255,0.35);
        backdrop-filter: blur(2px) saturate(1.2);
        animation: ugtImageTranslationSweep 1.35s linear infinite;
      }
      .ugt-image-translation-card {
        position: absolute !important;
        left: 50% !important;
        top: 50% !important;
        transform: translate(-50%, -50%) !important;
        min-width: min(240px, calc(100% - 24px)) !important;
        max-width: calc(100% - 24px) !important;
        padding: 12px 14px !important;
        border-radius: 8px !important;
        background: rgba(15, 23, 42, 0.94) !important;
        color: #ffffff !important;
        font: 600 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        text-align: center !important;
        letter-spacing: 0 !important;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55) !important;
        mix-blend-mode: normal !important;
        isolation: isolate !important;
      }
      .ugt-image-translation-card *,
      .ugt-image-translation-title {
        color: #ffffff !important;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        letter-spacing: 0 !important;
      }
      .ugt-image-translation-spinner {
        width: 28px;
        height: 28px;
        margin: 0 auto 8px;
        border-radius: 50%;
        border: 3px solid rgba(255,255,255,0.28);
        border-top-color: #ffffff;
        animation: ugtImageTranslationSpin 0.8s linear infinite;
      }
      .ugt-image-translation-subtext {
        margin-top: 4px !important;
        font-weight: 600 !important;
        font-size: 11px !important;
        color: rgba(255,255,255,0.84) !important;
        word-break: break-word !important;
      }
      .ugt-image-translation-done {
        border-color: rgba(16, 185, 129, 0.95);
        animation: none;
      }
      .ugt-image-translation-error {
        border-color: rgba(239, 68, 68, 0.95);
        animation: none;
        z-index: 2147483646;
      }
      .ugt-image-translation-actions {
        position: fixed;
        z-index: 2147483647;
        display: inline-flex;
        flex-direction: row-reverse;
        align-items: center;
        gap: 3px;
        max-width: 24px;
        padding: 2px;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.86);
        border: 1px solid rgba(255, 255, 255, 0.55);
        box-shadow: 0 8px 22px rgba(15, 23, 42, 0.35);
        pointer-events: auto;
        overflow: hidden;
        backdrop-filter: blur(5px) saturate(1.25);
        transition: max-width 130ms ease, background-color 130ms ease, border-color 130ms ease;
        isolation: isolate;
      }
      .ugt-image-translation-actions:hover,
      .ugt-image-translation-actions:focus-within,
      .ugt-image-translation-actions[data-expanded="true"] {
        max-width: 112px;
        background: rgba(15, 23, 42, 0.95);
        border-color: rgba(255, 255, 255, 0.82);
      }
      .ugt-image-translation-action-button {
        all: initial;
        box-sizing: border-box;
        width: 20px;
        height: 20px;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        flex: 0 0 20px;
        color: #ffffff !important;
        background: rgba(255, 255, 255, 0.12);
        border: 1px solid rgba(255, 255, 255, 0.28);
        pointer-events: auto;
        opacity: 0;
        transform: scale(0.85);
        transition: background-color 120ms ease, border-color 120ms ease, opacity 110ms ease, transform 120ms ease;
      }
      .ugt-image-translation-actions:hover .ugt-image-translation-action-button,
      .ugt-image-translation-actions:focus-within .ugt-image-translation-action-button,
      .ugt-image-translation-actions[data-expanded="true"] .ugt-image-translation-action-button,
      .ugt-image-translation-action-trigger {
        opacity: 1;
        transform: scale(1);
      }
      .ugt-image-translation-action-button:hover {
        background: rgba(37, 99, 235, 0.96);
        border-color: rgba(255, 255, 255, 0.78);
      }
      .ugt-image-translation-action-button:active {
        transform: scale(0.96);
      }
      .ugt-image-translation-action-trigger {
        background: rgba(37, 99, 235, 0.96);
        border-color: rgba(255, 255, 255, 0.70);
        flex: 0 0 auto;
      }
      .ugt-image-translation-action-button svg {
        width: 13px;
        height: 13px;
        display: block;
        color: #ffffff !important;
        stroke: #ffffff !important;
        fill: none !important;
      }
      .ugt-image-translation-action-button svg path,
      .ugt-image-translation-action-button svg circle {
        stroke: #ffffff !important;
      }
      .ugt-image-translation-action-button[data-state="original"] {
        background: rgba(217, 119, 6, 0.96);
        border-color: rgba(255, 255, 255, 0.78);
      }
      .ugt-video-frame-translation-result {
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        overflow: hidden;
        background: #000000;
        box-sizing: border-box;
      }
      .ugt-video-frame-translation-result img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        background: #000000;
      }
      html.ugt-video-frame-capturing .ugt-image-translation-overlay,
      html.ugt-video-frame-capturing .ugt-image-translation-actions,
      html.ugt-video-frame-capturing .ugt-video-frame-translation-result,
      html.ugt-video-frame-capturing .ytp-chrome-bottom,
      html.ugt-video-frame-capturing .ytp-chrome-top,
      html.ugt-video-frame-capturing .ytp-gradient-bottom,
      html.ugt-video-frame-capturing .ytp-gradient-top,
      html.ugt-video-frame-capturing .ytp-contextmenu,
      html.ugt-video-frame-capturing .ytp-popup,
      html.ugt-video-frame-capturing .ytp-tooltip,
      html.ugt-video-frame-capturing .ytp-spinner,
      html.ugt-video-frame-capturing .ytp-pause-overlay {
        opacity: 0 !important;
        visibility: hidden !important;
      }
      @keyframes ugtImageTranslationSpin {
        to { transform: rotate(360deg); }
      }
      @keyframes ugtImageTranslationSweep {
        from { background-position: 220% 0; }
        to { background-position: -220% 0; }
      }
    `;
    document.documentElement.appendChild(style);
  }

  function escapeImageTranslationText(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatImageTranslationBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function estimateImageTranslationDataUrlBytes(dataUrl) {
    const value = String(dataUrl || '');
    const comma = value.indexOf(',');
    if (comma === -1) return value.length;
    const metadata = value.slice(0, comma);
    const payload = value.slice(comma + 1);
    return metadata.includes(';base64') ? Math.floor(payload.length * 3 / 4) : payload.length;
  }

  function getImageTranslationProgressDetail(target) {
    const seconds = target.startedAt ? Math.floor((Date.now() - target.startedAt) / 1000) : 0;
    const detail = target.progressDetail || `to ${target.targetLanguage || 'English'}`;
    return `${detail} · ${seconds}s`;
  }

  function scoreVideoFrameTranslationCandidate(video, target) {
    if (!video || video === target.video) return -1;

    const { clipped } = getClippedImageRect(video);
    if (clipped.width < 80 || clipped.height < 45) return -1;

    const centerX = clipped.left + clipped.width / 2;
    const centerY = clipped.top + clipped.height / 2;
    const originalCenterX = target.originalRect.left + target.originalRect.width / 2;
    const originalCenterY = target.originalRect.top + target.originalRect.height / 2;
    const distance = Math.hypot(centerX - originalCenterX, centerY - originalCenterY);
    let score = Math.max(0, 100 - distance / 6);

    if (!video.paused && !video.ended) score += 30;
    if (target.sourceUrl && videoSourceMatches(video, target.sourceUrl)) score += 100;
    score += Math.min(60, (clipped.width * clipped.height) / 20000);

    return score;
  }

  function resolveCurrentVideoFrameTranslationElement(target) {
    if (target.video?.isConnected) {
      const { clipped } = getClippedImageRect(target.video);
      if (clipped.width >= 80 && clipped.height >= 45) {
        return target.video;
      }
    }

    let bestVideo = null;
    let bestScore = -1;
    for (const candidate of Array.from(document.querySelectorAll('video'))) {
      const score = scoreVideoFrameTranslationCandidate(candidate, target);
      if (score > bestScore) {
        bestScore = score;
        bestVideo = candidate;
      }
    }

    return bestScore > 0 ? bestVideo : target.video;
  }

  function getImageTranslationVisualElement(target) {
    if (target?.kind === 'video-frame') {
      target.video = resolveCurrentVideoFrameTranslationElement(target);
      return target.video;
    }

    return target?.image || null;
  }

  function updateImageTranslationOverlayPosition(target) {
    if (!target?.overlay) return;

    const visualElement = getImageTranslationVisualElement(target);
    if (!visualElement) return;

    const { clipped } = getClippedImageRect(visualElement);
    if (clipped.width < 1 || clipped.height < 1) {
      target.overlay.style.display = 'none';
      return;
    }

    target.rect = clipped;
    target.overlay.style.display = '';
    target.overlay.style.left = `${clipped.left}px`;
    target.overlay.style.top = `${clipped.top}px`;
    target.overlay.style.width = `${clipped.width}px`;
    target.overlay.style.height = `${clipped.height}px`;
  }

  function renderImageTranslationProgress(target) {
    if (!target?.overlay) return;

    updateImageTranslationOverlayPosition(target);

    const title = target.overlay.querySelector('.ugt-image-translation-title');
    const subtext = target.overlay.querySelector('.ugt-image-translation-subtext');
    if (title) {
      title.textContent = target.progressTitle || 'Translating image';
    }
    if (subtext) {
      subtext.textContent = getImageTranslationProgressDetail(target);
    }
  }

  function updateImageTranslationProgress(requestId, progress = {}) {
    const target = imageTranslationTargets.get(requestId);
    if (!target) return { ok: false, error: 'Image translation target was lost.' };

    // Offscreen progress relays are fire-and-forget, so a queued progress message
    // can arrive after the completion or error relay. Never let it recreate or
    // overwrite terminal UI.
    if (target.settled) {
      return { ok: true, ignored: true };
    }

    if (progress.targetLanguage) {
      target.targetLanguage = progress.targetLanguage;
    }
    if (progress.title) {
      target.progressTitle = progress.title;
    }
    if (progress.detail) {
      target.progressDetail = progress.detail;
    }
    if (Number.isFinite(progress.loadedBytes)) {
      const loaded = formatImageTranslationBytes(progress.loadedBytes);
      const total = formatImageTranslationBytes(progress.totalBytes);
      target.progressTitle = progress.title || 'Sending image';
      target.progressDetail = total ? `${loaded} of ${total} uploaded` : `${loaded} uploaded`;
    }

    if (!target.overlay) {
      showImageTranslationOverlay(requestId, target.targetLanguage || progress.targetLanguage || 'English');
    } else {
      renderImageTranslationProgress(target);
    }

    return { ok: true };
  }

  function showImageTranslationOverlay(requestId, targetLanguage) {
    const target = imageTranslationTargets.get(requestId);
    if (!target || target.settled) return null;

    ensureImageTranslationStyles();

    const visualElement = getImageTranslationVisualElement(target);
    if (!visualElement) return null;

    const overlay = document.createElement('div');
    overlay.className = 'ugt-image-translation-overlay';
    target.targetLanguage = targetLanguage || target.targetLanguage || 'English';

    const card = document.createElement('div');
    card.className = 'ugt-image-translation-card';
    card.innerHTML = `
      <div class="ugt-image-translation-spinner"></div>
      <div class="ugt-image-translation-title">${escapeImageTranslationText(target.progressTitle || 'Translating image')}</div>
      <div class="ugt-image-translation-subtext"></div>
    `;
    overlay.appendChild(card);
    document.documentElement.appendChild(overlay);

    target.overlay = overlay;
    target.startedAt = Date.now();

    target.timer = setInterval(() => {
      renderImageTranslationProgress(target);
    }, 250);

    const visualStyle = getComputedStyle(visualElement);
    if (visualStyle.opacity !== '0' && visualStyle.visibility !== 'hidden' && visualStyle.display !== 'none') {
      visualElement.style.filter = `${visualElement.style.filter || ''} saturate(0.85) blur(0.4px)`.trim();
      visualElement.style.opacity = visualElement.style.opacity || '0.82';
    }

    renderImageTranslationProgress(target);

    return overlay;
  }

  function hideImageTranslationOverlay(requestId, keepTarget = false) {
    const target = imageTranslationTargets.get(requestId);
    if (!target) return;

    if (target.timer) {
      clearInterval(target.timer);
      target.timer = null;
    }

    if (target.overlay) {
      target.overlay.remove();
      target.overlay = null;
    }

    const visualElement = getImageTranslationVisualElement(target);
    if (visualElement && target.originalStyle) {
      visualElement.style.filter = target.originalStyle.filter || '';
      visualElement.style.opacity = target.originalStyle.opacity || '';
    }

    if (!keepTarget) {
      if (target.reapplyTimer) {
        clearInterval(target.reapplyTimer);
        target.reapplyTimer = null;
      }

      if (target.kind === 'video-frame') {
        cleanupVideoFrameTranslationTarget(target, { resume: true });
      } else {
        removeImageTranslationActions(target);
      }
      imageTranslationTargets.delete(requestId);
    }
  }

  function loadImageElement(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load captured tab image.'));
      image.src = dataUrl;
    });
  }

  function blobToImageTranslationDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read image data.'));
      reader.readAsDataURL(blob);
    });
  }

  async function fetchFullImageForTranslation(target) {
    const sourceUrl = target.sourceUrl || target.image.currentSrc || target.image.src || '';
    if (!sourceUrl) {
      throw new Error('The image source URL is unavailable.');
    }

    const fullImage = await fetchImageUrlForTranslation(sourceUrl, {
      fallbackWidth: target.image.naturalWidth || Math.round(target.originalRect.width),
      fallbackHeight: target.image.naturalHeight || Math.round(target.originalRect.height)
    });

    return {
      ...fullImage,
      captureSource: fullImage.captureSource || 'full_image_fetch'
    };
  }

  async function fetchImageUrlForTranslation(sourceUrl, options = {}) {
    if (!sourceUrl) {
      throw new Error('The image source URL is unavailable.');
    }

    if (sourceUrl.startsWith('data:')) {
      return {
        imageDataUrl: sourceUrl,
        width: options.fallbackWidth || 0,
        height: options.fallbackHeight || 0,
        byteLength: estimateImageTranslationDataUrlBytes(sourceUrl),
        captureSource: 'data_url'
      };
    }

    let response;
    try {
      response = await fetch(sourceUrl, {
        credentials: 'omit',
        cache: 'force-cache'
      });
    } catch (error) {
      response = await fetch(sourceUrl, {
        credentials: 'include',
        cache: 'force-cache'
      });
    }

    if (response && !response.ok) {
      response = await fetch(sourceUrl, {
        credentials: 'include',
        cache: 'force-cache'
      });
    }

    if (!response.ok) {
      throw new Error(`Could not fetch full image (${response.status}).`);
    }

    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error('The full image request did not return image data.');
    }

    const imageDataUrl = await blobToImageTranslationDataUrl(blob);
    let width = options.fallbackWidth || 0;
    let height = options.fallbackHeight || 0;
    try {
      const loadedImage = await loadImageElement(imageDataUrl);
      width = loadedImage.naturalWidth || width;
      height = loadedImage.naturalHeight || height;
    } catch {
      // Keep fallback dimensions.
    }

    return {
      imageDataUrl,
      width,
      height,
      byteLength: blob.size || estimateImageTranslationDataUrlBytes(imageDataUrl),
      captureSource: 'full_image_fetch'
    };
  }

  async function captureImageForTranslation(requestId, screenshotDataUrl, targetLanguage) {
    const target = imageTranslationTargets.get(requestId);
    if (!target) {
      return { ok: false, error: 'Image translation target was lost.' };
    }

    updateImageTranslationProgress(requestId, {
      targetLanguage,
      title: 'Preparing image',
      detail: 'Reading full image'
    });

    if (!screenshotDataUrl) {
      try {
        const fullImage = await fetchFullImageForTranslation(target);
        setImageTranslationOriginalSnapshot(requestId, fullImage.imageDataUrl, fullImage.captureSource);
        updateImageTranslationProgress(requestId, {
          title: 'Preparing image',
          detail: `Full image ready (${formatImageTranslationBytes(fullImage.byteLength)})`
        });
        return {
          ok: true,
          ...fullImage
        };
      } catch (error) {
        target.fullImageFetchError = error.message || String(error);
        updateImageTranslationProgress(requestId, {
          title: 'Preparing image',
          detail: 'Full image blocked; capturing visible area'
        });
        return {
          ok: false,
          needsScreenshot: true,
          error: target.fullImageFetchError
        };
      }
    }

    const screenshot = await loadImageElement(screenshotDataUrl);
    const scaleX = screenshot.naturalWidth / window.innerWidth;
    const scaleY = screenshot.naturalHeight / window.innerHeight;
    updateImageTranslationOverlayPosition(target);
    const sx = Math.max(0, Math.round(target.rect.left * scaleX));
    const sy = Math.max(0, Math.round(target.rect.top * scaleY));
    const sw = Math.max(1, Math.round(target.rect.width * scaleX));
    const sh = Math.max(1, Math.round(target.rect.height * scaleY));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const context = canvas.getContext('2d');
    context.drawImage(screenshot, sx, sy, sw, sh, 0, 0, sw, sh);

    const imageDataUrl = canvas.toDataURL('image/png');
    const byteLength = estimateImageTranslationDataUrlBytes(imageDataUrl);
    updateImageTranslationProgress(requestId, {
      title: 'Preparing image',
      detail: `Visible area ready (${formatImageTranslationBytes(byteLength)})`
    });
    return {
      ok: true,
      imageDataUrl,
      width: sw,
      height: sh,
      byteLength,
      captureSource: 'visible_screenshot',
      warning: target.fullImageFetchError ? `Full image unavailable: ${target.fullImageFetchError}` : undefined
    };
  }

  function setImageTranslationOriginalSnapshot(requestId, imageDataUrl, captureSource = '') {
    const target = imageTranslationTargets.get(requestId);
    if (!target || target.kind === 'video-frame') {
      return { ok: false, error: 'Image translation target was lost.' };
    }

    if (!String(imageDataUrl || '').startsWith('data:image/')) {
      return { ok: false, error: 'Original image snapshot data is unavailable.' };
    }

    if (captureSource === 'visible_screenshot') {
      return { ok: true, ignored: true };
    }

    target.originalImageDataUrl = imageDataUrl;
    target.originalCaptureSource = captureSource;
    return { ok: true };
  }

  function restoreVideoFrameCaptureUi(target) {
    document.documentElement.classList.remove('ugt-video-frame-capturing');

    if (target?.captureCleanupTimer) {
      clearTimeout(target.captureCleanupTimer);
      target.captureCleanupTimer = null;
    }

    if (target) {
      target.capturePrepared = false;
    }
  }

  async function waitForVideoFrameCaptureLayout() {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  async function prepareVideoFrameCapture(requestId, targetLanguage) {
    const target = imageTranslationTargets.get(requestId);
    if (!target || target.kind !== 'video-frame') {
      return { ok: false, error: 'Video frame translation target was lost.' };
    }

    ensureImageTranslationStyles();
    target.targetLanguage = targetLanguage || target.targetLanguage || 'English';
    target.progressTitle = 'Preparing frame';
    target.progressDetail = 'Capturing visible video frame';

    const video = resolveCurrentVideoFrameTranslationElement(target);
    if (!video) {
      return { ok: false, error: 'Could not find the selected video.' };
    }

    target.video = video;
    const { clipped } = getClippedImageRect(video);
    if (clipped.width < 80 || clipped.height < 45) {
      return { ok: false, error: 'The selected video is not visible enough to capture.' };
    }

    target.rect = clipped;
    document.documentElement.classList.add('ugt-video-frame-capturing');
    target.capturePrepared = true;

    if (target.captureCleanupTimer) {
      clearTimeout(target.captureCleanupTimer);
    }
    target.captureCleanupTimer = setTimeout(() => restoreVideoFrameCaptureUi(target), 8000);

    await waitForVideoFrameCaptureLayout();
    return { ok: true, prepared: true };
  }

  async function captureVideoFrameForTranslation(requestId, screenshotDataUrl, targetLanguage, phase = '') {
    const target = imageTranslationTargets.get(requestId);
    if (!target || target.kind !== 'video-frame') {
      return { ok: false, error: 'Video frame translation target was lost.' };
    }

    if (phase === 'prepare' || !screenshotDataUrl) {
      return prepareVideoFrameCapture(requestId, targetLanguage);
    }

    try {
      const screenshot = await loadImageElement(screenshotDataUrl);
      const video = resolveCurrentVideoFrameTranslationElement(target);
      if (!video) {
        return { ok: false, error: 'Could not find the selected video.' };
      }

      target.video = video;
      const { clipped } = getClippedImageRect(video);
      if (clipped.width < 80 || clipped.height < 45) {
        return { ok: false, error: 'The selected video is not visible enough to capture.' };
      }

      target.rect = clipped;
      const scaleX = screenshot.naturalWidth / window.innerWidth;
      const scaleY = screenshot.naturalHeight / window.innerHeight;
      const sx = Math.max(0, Math.round(clipped.left * scaleX));
      const sy = Math.max(0, Math.round(clipped.top * scaleY));
      const sw = Math.max(1, Math.round(clipped.width * scaleX));
      const sh = Math.max(1, Math.round(clipped.height * scaleY));

      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      const context = canvas.getContext('2d');
      context.drawImage(screenshot, sx, sy, sw, sh, 0, 0, sw, sh);

      const imageDataUrl = canvas.toDataURL('image/png');
      const byteLength = estimateImageTranslationDataUrlBytes(imageDataUrl);

      target.wasPausedAtCapture = video.paused;
      target.pausedForTranslation = false;
      if (!video.paused && !video.ended) {
        video.pause();
        target.pausedForTranslation = true;
      }

      updateImageTranslationProgress(requestId, {
        targetLanguage,
        title: 'Preparing frame',
        detail: `Video frame ready (${formatImageTranslationBytes(byteLength)})`
      });

      return {
        ok: true,
        imageDataUrl,
        width: sw,
        height: sh,
        byteLength,
        captureSource: 'visible_video_frame'
      };
    } finally {
      restoreVideoFrameCaptureUi(target);
    }
  }

  function scoreImageTranslationCandidate(image, target) {
    if (!image || image === target.image) return -1;

    let score = 0;
    const source = image.currentSrc || image.src || image.getAttribute('src') || '';
    if (target.sourceUrl && source === target.sourceUrl) score += 100;
    if (target.sourceUrl && source.includes(target.sourceUrl)) score += 60;

    const rect = image.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return -1;

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const originalCenterX = target.originalRect.left + target.originalRect.width / 2;
    const originalCenterY = target.originalRect.top + target.originalRect.height / 2;
    const distance = Math.hypot(centerX - originalCenterX, centerY - originalCenterY);
    score += Math.max(0, 50 - distance / 10);

    return score;
  }

  function resolveCurrentImageTranslationElement(target) {
    if (target.image?.isConnected) {
      const rect = target.image.getBoundingClientRect();
      if (rect.width >= 8 && rect.height >= 8) {
        return target.image;
      }
    }

    let bestImage = null;
    let bestScore = -1;
    for (const candidate of Array.from(document.images)) {
      const score = scoreImageTranslationCandidate(candidate, target);
      if (score > bestScore) {
        bestScore = score;
        bestImage = candidate;
      }
    }

    return bestScore > 0 ? bestImage : target.image;
  }

  function isImageShowingTranslatedData(image, target) {
    const translatedImageDataUrl = target?.translatedImageDataUrl || '';
    if (!translatedImageDataUrl) return false;

    const imageSources = [image?.currentSrc, image?.src, image?.getAttribute?.('src')].filter(Boolean);
    if (!imageSources.includes(translatedImageDataUrl)) return false;

    const paintLayers = findImageTranslationPaintLayers(image);
    return paintLayers.length === 0 || paintLayers.every((layer) => {
      const backgroundImage = layer.style.backgroundImage || getComputedStyle(layer).backgroundImage || '';
      return backgroundImage.includes(translatedImageDataUrl);
    });
  }

  function getImageSourceCandidates(image) {
    const values = [
      image?.dataset?.ugtOriginalSrc,
      image?.currentSrc,
      image?.src,
      image?.getAttribute?.('src')
    ].filter(Boolean);

    const candidates = [];

    values.forEach((value) => {
      const source = String(value);
      if (source.startsWith('data:image/')) return;

      candidates.push(source);

      try {
        const parsed = new URL(source, location.href);
        candidates.push(`${parsed.origin}${parsed.pathname}`);
        const format = parsed.searchParams.get('format');
        if (format) {
          candidates.push(`${parsed.origin}${parsed.pathname}?format=${format}`);
        }
      } catch {
        // Keep the original value only.
      }
    });

    return Array.from(new Set(candidates.filter((value) => value && String(value).length > 8)));
  }

  function cssBackgroundImageContainsSource(backgroundImage, sourceCandidates) {
    if (!backgroundImage || backgroundImage === 'none') return false;

    const normalizedBackground = String(backgroundImage)
      .replace(/&amp;/g, '&')
      .replace(/\\(["'])/g, '$1');

    return sourceCandidates.some((source) => {
      if (!source) return false;
      const normalizedSource = String(source).replace(/&amp;/g, '&');
      return normalizedBackground.includes(normalizedSource);
    });
  }

  function getRectOverlapRatio(a, b) {
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    const overlapWidth = Math.max(0, right - left);
    const overlapHeight = Math.max(0, bottom - top);
    const overlapArea = overlapWidth * overlapHeight;
    const imageArea = Math.max(1, a.width * a.height);
    return overlapArea / imageArea;
  }

  function findImageTranslationPaintLayers(image, sourceCandidates = getImageSourceCandidates(image)) {
    if (!image?.parentElement) return [];

    const imageRect = image.getBoundingClientRect();
    if (imageRect.width < 8 || imageRect.height < 8) return [];

    const root = image.parentElement;
    const candidates = [root, ...Array.from(root.querySelectorAll('div, span'))];

    return candidates.filter((candidate) => {
      if (candidate === image || candidate.nodeType !== Node.ELEMENT_NODE) return false;

      const candidateStyle = getComputedStyle(candidate);
      const backgroundImage = candidate.style.backgroundImage || candidateStyle.backgroundImage || '';
      const wasTranslatedLayer = candidate.dataset.ugtTranslatedImageLayer === 'true';
      const sourceMatched = cssBackgroundImageContainsSource(backgroundImage, sourceCandidates);
      if (!wasTranslatedLayer && !sourceMatched) return false;

      const candidateRect = candidate.getBoundingClientRect();
      if (candidateRect.width < 8 || candidateRect.height < 8) return false;

      return getRectOverlapRatio(imageRect, candidateRect) >= 0.7;
    });
  }

  function toCssImageUrl(imageDataUrl) {
    return `url("${String(imageDataUrl).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}")`;
  }

  function applyTranslatedImageToPaintLayers(image, imageDataUrl, sourceCandidates) {
    const paintLayers = findImageTranslationPaintLayers(image, sourceCandidates);
    const cssImageUrl = toCssImageUrl(imageDataUrl);

    paintLayers.forEach((layer) => {
      layer.dataset.ugtOriginalBackgroundImage = layer.dataset.ugtOriginalBackgroundImage || layer.style.backgroundImage || getComputedStyle(layer).backgroundImage || '';
      layer.dataset.ugtTranslatedImageLayer = 'true';
      layer.style.backgroundImage = cssImageUrl;
    });

    return paintLayers.length;
  }

  function applyOriginalImageToPaintLayers(image, target) {
    const sourceCandidates = getImageSourceCandidates(image);
    const paintLayers = findImageTranslationPaintLayers(image, sourceCandidates);
    const originalSnapshotCss = target?.originalImageDataUrl
      ? toCssImageUrl(target.originalImageDataUrl)
      : '';

    paintLayers.forEach((layer) => {
      if (originalSnapshotCss) {
        layer.style.backgroundImage = originalSnapshotCss;
      } else if (layer.dataset.ugtOriginalBackgroundImage) {
        layer.style.backgroundImage = layer.dataset.ugtOriginalBackgroundImage;
      }
    });

    return paintLayers.length;
  }

  function setNullableImageAttribute(image, name, value) {
    if (value === null || typeof value === 'undefined') {
      image.removeAttribute(name);
    } else {
      image.setAttribute(name, value);
    }
  }

  function restoreOriginalImageSizing(image, target) {
    if (!image?.isConnected || !target?.originalStyle) return;

    image.style.width = target.originalStyle.width || '';
    image.style.height = target.originalStyle.height || '';
    image.style.objectFit = target.originalStyle.objectFit || '';
  }

  function getStableTranslatedImageSize(image, target) {
    const existing = target?.translatedDisplaySize;
    if (
      existing &&
      Number.isFinite(existing.width) &&
      Number.isFinite(existing.height) &&
      existing.width >= 8 &&
      existing.height >= 8
    ) {
      return existing;
    }

    const rect = image.getBoundingClientRect();
    const width = rect.width || target?.originalRect?.width || image.naturalWidth || 0;
    const height = rect.height || target?.originalRect?.height || image.naturalHeight || 0;
    if (width < 8 || height < 8) return null;

    const size = { width, height };
    if (target) {
      target.translatedDisplaySize = size;
    }
    return size;
  }

  function applyTranslatedImageSizing(image, target) {
    const size = getStableTranslatedImageSize(image, target);
    if (!size) return false;

    image.style.width = `${size.width}px`;
    image.style.height = `${size.height}px`;
    if (!image.style.objectFit) {
      image.style.objectFit = 'contain';
    }

    return true;
  }

  function applyOriginalImageToElement(image, target) {
    if (!image?.isConnected || !target?.originalImageState) return false;

    const rect = image.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;

    const original = target.originalImageState;
    if (target.originalImageDataUrl) {
      image.removeAttribute('srcset');
      image.removeAttribute('sizes');
      image.src = target.originalImageDataUrl;
    } else {
      setNullableImageAttribute(image, 'srcset', original.srcset);
      setNullableImageAttribute(image, 'sizes', original.sizes);
      setNullableImageAttribute(image, 'src', original.srcAttr || original.currentSrc || original.src || target.sourceUrl || '');

      if (original.currentSrc || original.src || target.sourceUrl) {
        image.src = original.currentSrc || original.src || target.sourceUrl;
      }
    }

    restoreOriginalImageSizing(image, target);

    const originalPaintLayerCount = applyOriginalImageToPaintLayers(image, target);
    const imageStyle = getComputedStyle(image);
    const imagePaintsVisibly = imageStyle.opacity !== '0' && imageStyle.visibility !== 'hidden' && imageStyle.display !== 'none';

    target.showingTranslatedImage = false;
    updateImageTranslationActionsState(target);

    return imagePaintsVisibly || originalPaintLayerCount > 0;
  }

  function applyTranslatedImageToElement(image, imageDataUrl, target = null) {
    if (!image?.isConnected) return false;

    const rect = image.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return false;

    const sourceCandidates = getImageSourceCandidates(image);
    image.dataset.ugtOriginalSrc = image.dataset.ugtOriginalSrc || image.currentSrc || image.src || '';
    image.dataset.ugtTranslatedImage = 'true';
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
    if (!applyTranslatedImageSizing(image, target)) return false;
    image.src = imageDataUrl;

    const translatedPaintLayerCount = applyTranslatedImageToPaintLayers(image, imageDataUrl, sourceCandidates);
    const imageStyle = getComputedStyle(image);
    const imagePaintsVisibly = imageStyle.opacity !== '0' && imageStyle.visibility !== 'hidden' && imageStyle.display !== 'none';

    if (target) {
      target.showingTranslatedImage = true;
      updateImageTranslationActionsState(target);
    }

    return imagePaintsVisibly || translatedPaintLayerCount > 0;
  }

  function applyTranslatedImageToCurrentTarget(target, imageDataUrl) {
    target.image = resolveCurrentImageTranslationElement(target);
    return applyTranslatedImageToElement(target.image, imageDataUrl, target);
  }

  function keepImageTranslationStateApplied(target) {
    const expiresAt = Date.now() + 15000;

    const tick = () => {
      if (Date.now() > expiresAt) {
        clearInterval(target.reapplyTimer);
        target.reapplyTimer = null;
        return;
      }

      const currentImage = resolveCurrentImageTranslationElement(target);
      if (!currentImage) return;

      target.image = currentImage;
      if (target.showingTranslatedImage && !isImageShowingTranslatedData(currentImage, target)) {
        applyTranslatedImageToElement(currentImage, target.translatedImageDataUrl, target);
      } else if (!target.showingTranslatedImage && isImageShowingTranslatedData(currentImage, target)) {
        applyOriginalImageToElement(currentImage, target);
      }
    };

    if (target.reapplyTimer) {
      clearInterval(target.reapplyTimer);
    }
    target.reapplyTimer = setInterval(tick, 500);
  }

  function getImageTranslationActionIcon(name) {
    if (name === 'menu') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="12" cy="19" r="1.7"></circle></svg>';
    }

    if (name === 'open') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M16 16l4 4"></path><path d="M10.5 7.5v6"></path><path d="M7.5 10.5h6"></path></svg>';
    }

    if (name === 'close') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6L6 18"></path><path d="M6 6l12 12"></path></svg>';
    }

    return '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4"></path><path d="M3 11V9a3 3 0 0 1 3-3h15"></path><path d="M7 22l-4-4 4-4"></path><path d="M21 13v2a3 3 0 0 1-3 3H3"></path></svg>';
  }

  function createImageTranslationActionButton(iconName, title) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ugt-image-translation-action-button';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = getImageTranslationActionIcon(iconName);
    return button;
  }

  function updateVideoFrameTranslationResultPosition(target, clipped = null) {
    if (!target?.resultOverlay) return;

    const video = resolveCurrentVideoFrameTranslationElement(target);
    if (!video) {
      target.resultOverlay.style.display = 'none';
      return;
    }

    target.video = video;
    const nextClipped = clipped || getClippedImageRect(video).clipped;
    if (nextClipped.width < 80 || nextClipped.height < 45) {
      target.resultOverlay.style.display = 'none';
      return;
    }

    target.rect = nextClipped;
    target.resultOverlay.style.display = target.showingTranslatedImage ? '' : 'none';
    target.resultOverlay.style.left = `${nextClipped.left}px`;
    target.resultOverlay.style.top = `${nextClipped.top}px`;
    target.resultOverlay.style.width = `${nextClipped.width}px`;
    target.resultOverlay.style.height = `${nextClipped.height}px`;
  }

  function applyTranslatedVideoFrameToCurrentTarget(target, imageDataUrl) {
    const video = resolveCurrentVideoFrameTranslationElement(target);
    if (!video) return false;

    const { clipped } = getClippedImageRect(video);
    if (clipped.width < 80 || clipped.height < 45) return false;

    ensureImageTranslationStyles();
    target.video = video;
    target.translatedImageDataUrl = imageDataUrl;
    target.showingTranslatedImage = true;

    if (!target.resultOverlay) {
      const resultOverlay = document.createElement('div');
      resultOverlay.className = 'ugt-video-frame-translation-result';

      const image = document.createElement('img');
      image.alt = 'Translated video frame';
      resultOverlay.appendChild(image);
      document.documentElement.appendChild(resultOverlay);
      target.resultOverlay = resultOverlay;
    }

    const image = target.resultOverlay.querySelector('img');
    if (image) {
      image.src = imageDataUrl;
    }

    updateVideoFrameTranslationResultPosition(target, clipped);
    updateImageTranslationActionsState(target);
    return true;
  }

  function setVideoFrameTranslationVisibility(target, visible) {
    if (!target?.translatedImageDataUrl) return false;
    target.showingTranslatedImage = visible;
    updateVideoFrameTranslationResultPosition(target);
    updateImageTranslationActionsState(target);
    return true;
  }

  function cleanupVideoFrameTranslationTarget(target, options = {}) {
    if (!target) return;

    restoreVideoFrameCaptureUi(target);
    removeImageTranslationActions(target);

    if (target.resultOverlay) {
      target.resultOverlay.remove();
      target.resultOverlay = null;
    }

    const video = resolveCurrentVideoFrameTranslationElement(target);
    if (video && target.originalStyle) {
      video.style.filter = target.originalStyle.filter || '';
      video.style.opacity = target.originalStyle.opacity || '';
    }

    if (options.resume && target.pausedForTranslation && video?.paused && !video.ended) {
      const playResult = video.play();
      if (playResult?.catch) {
        playResult.catch(() => {});
      }
    }
    target.pausedForTranslation = false;
  }

  function closeVideoFrameTranslation(requestId, target) {
    hideImageTranslationOverlay(requestId, true);
    cleanupVideoFrameTranslationTarget(target, { resume: true });
    imageTranslationTargets.delete(requestId);
  }

  function updateImageTranslationActionsPosition(target) {
    if (!target?.actionsOverlay) return;

    const visualElement = target.kind === 'video-frame'
      ? resolveCurrentVideoFrameTranslationElement(target)
      : resolveCurrentImageTranslationElement(target);
    if (!visualElement) {
      target.actionsOverlay.style.display = 'none';
      return;
    }

    if (target.kind === 'video-frame') {
      target.video = visualElement;
    } else {
      target.image = visualElement;
    }

    const { clipped } = getClippedImageRect(visualElement);
    if (clipped.width < 8 || clipped.height < 8) {
      target.actionsOverlay.style.display = 'none';
      if (target.kind === 'video-frame') {
        updateVideoFrameTranslationResultPosition(target, clipped);
      }
      return;
    }

    if (target.kind === 'video-frame') {
      updateVideoFrameTranslationResultPosition(target, clipped);
    }

    const overlayHeight = target.actionsOverlay.offsetHeight || 26;
    const right = Math.max(8, window.innerWidth - clipped.right + 8);
    const top = Math.min(
      Math.max(8, clipped.top + 8),
      Math.max(8, window.innerHeight - overlayHeight - 8)
    );

    target.actionsOverlay.style.display = '';
    target.actionsOverlay.style.left = 'auto';
    target.actionsOverlay.style.right = `${right}px`;
    target.actionsOverlay.style.top = `${top}px`;
  }

  function updateImageTranslationActionsState(target) {
    const toggleButton = target?.actionsOverlay?.querySelector('[data-ugt-image-action="toggle"]');
    if (!toggleButton) return;

    const title = target.kind === 'video-frame'
      ? (target.showingTranslatedImage ? 'Show video frame' : 'Show translated frame')
      : (target.showingTranslatedImage ? 'Show original image' : 'Show translated image');
    toggleButton.title = title;
    toggleButton.setAttribute('aria-label', title);
    toggleButton.dataset.state = target.showingTranslatedImage ? 'translated' : 'original';
  }

  function removeImageTranslationActions(target) {
    if (!target) return;

    if (target.actionsTimer) {
      clearInterval(target.actionsTimer);
      target.actionsTimer = null;
    }

    if (target.actionsOverlay) {
      target.actionsOverlay.remove();
      target.actionsOverlay = null;
    }
  }

  async function openImageTranslationNativeImage(target) {
    if (!target?.translatedImageDataUrl) {
      showCustomError('Translated image data is unavailable.', 'IMAGE_TRANSLATION');
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: 'UGT_OPEN_IMAGE_TRANSLATION_IMAGE',
        imageDataUrl: target.translatedImageDataUrl
      }, (previewResponse) => {
        if (previewResponse?.ok) return;

        const opened = window.open(target.translatedImageDataUrl, '_blank', 'noopener');
        if (!opened) {
          showCustomError(
            previewResponse?.error || chrome.runtime.lastError?.message || 'Could not open translated image preview.',
            'IMAGE_TRANSLATION'
          );
        }
      });
    } catch (error) {
      showCustomError(error.message || 'Could not open translated image preview.', 'IMAGE_TRANSLATION');
    }
  }

  function toggleImageTranslationState(target) {
    if (!target?.translatedImageDataUrl) return;

    if (target.kind === 'video-frame') {
      const applied = setVideoFrameTranslationVisibility(target, !target.showingTranslatedImage);
      if (!applied) {
        showCustomError('Could not switch the video frame display.', 'IMAGE_TRANSLATION');
        return;
      }
      updateImageTranslationActionsPosition(target);
      return;
    }

    const applied = target.showingTranslatedImage
      ? applyOriginalImageToElement(resolveCurrentImageTranslationElement(target), target)
      : applyTranslatedImageToElement(resolveCurrentImageTranslationElement(target), target.translatedImageDataUrl, target);

    if (!applied) {
      showCustomError('Could not switch the image display.', 'IMAGE_TRANSLATION');
      return;
    }

    keepImageTranslationStateApplied(target);
    updateImageTranslationActionsPosition(target);
  }

  function showImageTranslationActions(requestId) {
    const target = imageTranslationTargets.get(requestId);
    if (!target?.translatedImageDataUrl) return;

    ensureImageTranslationStyles();

    if (!target.actionsOverlay) {
      const actions = document.createElement('div');
      actions.className = 'ugt-image-translation-actions';
      actions.dataset.expanded = 'false';

      const triggerTitle = target.kind === 'video-frame' ? 'Video frame translation actions' : 'Image translation actions';
      const triggerButton = createImageTranslationActionButton('menu', triggerTitle);
      triggerButton.classList.add('ugt-image-translation-action-trigger');
      triggerButton.dataset.ugtImageAction = 'menu';
      triggerButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.dataset.expanded = actions.dataset.expanded === 'true' ? 'false' : 'true';
        updateImageTranslationActionsPosition(target);
      });

      const openButton = createImageTranslationActionButton('open', target.kind === 'video-frame' ? 'Open translated frame' : 'Open translated image');
      openButton.dataset.ugtImageAction = 'open';
      openButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.dataset.expanded = 'false';
        openImageTranslationNativeImage(target);
      });

      const toggleButton = createImageTranslationActionButton('toggle', target.kind === 'video-frame' ? 'Show video frame' : 'Show original image');
      toggleButton.dataset.ugtImageAction = 'toggle';
      toggleButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        actions.dataset.expanded = 'false';
        toggleImageTranslationState(target);
      });

      actions.append(triggerButton, openButton, toggleButton);

      if (target.kind === 'video-frame') {
        const closeButton = createImageTranslationActionButton('close', 'Close translated frame');
        closeButton.dataset.ugtImageAction = 'close';
        closeButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          actions.dataset.expanded = 'false';
          closeVideoFrameTranslation(requestId, target);
        });
        actions.append(closeButton);
      }

      document.documentElement.appendChild(actions);
      target.actionsOverlay = actions;
      target.actionsTimer = setInterval(() => updateImageTranslationActionsPosition(target), 500);
    }

    updateImageTranslationActionsState(target);
    updateImageTranslationActionsPosition(target);
  }

  async function completeImageTranslation(requestId, imageDataUrl, elapsedMs) {
    const target = imageTranslationTargets.get(requestId);
    if (!target) return { ok: false, error: 'Image translation target was lost.' };
    if (target.settled) {
      hideImageTranslationOverlay(requestId, true);
      showImageTranslationActions(requestId);
      return { ok: true, duplicate: true };
    }

    target.translatedImageDataUrl = imageDataUrl;
    const applied = target.kind === 'video-frame'
      ? applyTranslatedVideoFrameToCurrentTarget(target, imageDataUrl)
      : applyTranslatedImageToCurrentTarget(target, imageDataUrl);
    if (!applied) {
      return { ok: false, error: target.kind === 'video-frame' ? 'Could not find a visible video frame to overlay.' : 'Could not find a visible image element to replace.' };
    }

    target.settled = true;

    if (target.kind !== 'video-frame') {
      keepImageTranslationStateApplied(target);
    }

    if (target.overlay && target.overlay.style.display !== 'none') {
      target.overlay.classList.add('ugt-image-translation-done');
      const card = target.overlay.querySelector('.ugt-image-translation-card');
      if (card) {
        const seconds = elapsedMs ? Math.round(elapsedMs / 1000) : Math.round((Date.now() - target.startedAt) / 1000);
        const title = target.kind === 'video-frame' ? 'Video frame translated' : 'Image translated';
        card.innerHTML = `<div class="ugt-image-translation-title">${title}</div><div class="ugt-image-translation-subtext">${seconds}s</div>`;
      }
      setTimeout(() => {
        hideImageTranslationOverlay(requestId, true);
        showImageTranslationActions(requestId);
      }, 650);
    } else {
      hideImageTranslationOverlay(requestId, true);
      showImageTranslationActions(requestId);
    }

    return { ok: true };
  }

  function failImageTranslation(requestId, error) {
    const target = imageTranslationTargets.get(requestId);
    const fallbackMessage = target?.kind === 'video-frame' ? 'Video frame translation failed.' : 'Image translation failed.';
    const errorMessage = error || fallbackMessage;
    const alertMessage = target?.kind === 'video-frame'
      ? `Video frame translation failed:\n${errorMessage}`
      : `Image translation failed:\n${errorMessage}`;

    if (!target) {
      showCustomError(alertMessage, 'IMAGE_TRANSLATION');
      return;
    }

    target.settled = true;

    console.warn('UGT image translation failed:', errorMessage);
    if (target.kind === 'video-frame') {
      restoreVideoFrameCaptureUi(target);
    }

    if (target.overlay) {
      target.overlay.classList.add('ugt-image-translation-error');
      const card = target.overlay.querySelector('.ugt-image-translation-card');
      if (card) {
        const title = target.kind === 'video-frame' ? 'Video frame translation failed' : 'Image translation failed';
        card.innerHTML = `<div class="ugt-image-translation-title">${title}</div><div class="ugt-image-translation-subtext">${escapeImageTranslationText(errorMessage)}</div>`;
      }
      showCustomError(alertMessage, 'IMAGE_TRANSLATION');
      setTimeout(() => hideImageTranslationOverlay(requestId), 9000);
    } else {
      hideImageTranslationOverlay(requestId);
      showCustomError(alertMessage, 'IMAGE_TRANSLATION');
    }
  }

  document.addEventListener('contextmenu', (event) => {
    const image = getContextImageElement(event.target);
    if (image) {
      lastContextImage = {
        image,
        time: Date.now()
      };
    }

    const point = { clientX: event.clientX, clientY: event.clientY };
    const video = getContextVideoElement(event.target, point);
    if (video) {
      lastContextVideo = {
        video,
        point,
        time: Date.now()
      };
    }
  }, true);

  document.addEventListener("selectionchange", () => {
    const sel = document.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRange = sel.getRangeAt(0).cloneRange();
    }
  });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "TRANSLATE_SELECTION") {
      handleTranslate(msg.text, msg.settings, msg.simpleMode);
      sendResponse();
      return true;
    } else if (msg.type === "CREATE_LESSON") {
      handleCreateLesson(msg.text, msg.lessonPrompt);
      sendResponse();
      return true;
    } else if (msg.type === "ASK_ABOUT") {
      handleAskAbout(msg.text);
      sendResponse();
      return true;
    } else if (msg.type === "PING") {
      sendResponse({ status: "ok" });
      return true;
    } else if (msg.type === "GET_SELECTION") {
      // Return the current page selection (used when right-clicking away from selected text)
      const selection = window.getSelection();
      const selectionText = selection ? selection.toString().trim() : '';
      sendResponse({ selectionText: selectionText || null });
      return true;
    } else if (msg.type === "UGT_IMAGE_TRANSLATION_GET_TARGET") {
      sendResponse(getImageTranslationTarget(msg.srcUrl, msg.requestId));
      return true;
    } else if (msg.type === "UGT_IMAGE_TRANSLATION_CAPTURE") {
      captureImageForTranslation(msg.requestId, msg.screenshotDataUrl, msg.targetLanguage)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ ok: false, error: error.message || String(error) });
        });
      return true;
    } else if (msg.type === "UGT_VIDEO_FRAME_TRANSLATION_GET_TARGET") {
      sendResponse(getVideoFrameTranslationTarget(msg.srcUrl, msg.requestId, { mediaType: msg.mediaType || '' }));
      return true;
    } else if (msg.type === "UGT_VIDEO_FRAME_TRANSLATION_CAPTURE") {
      captureVideoFrameForTranslation(msg.requestId, msg.screenshotDataUrl, msg.targetLanguage, msg.phase || '')
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ ok: false, error: error.message || String(error) });
        });
      return true;
    } else if (msg.type === "UGT_IMAGE_TRANSLATION_PROGRESS") {
      sendResponse(updateImageTranslationProgress(msg.requestId, msg.progress || {}));
      return true;
    } else if (msg.type === "UGT_IMAGE_TRANSLATION_SET_ORIGINAL_SNAPSHOT") {
      sendResponse(setImageTranslationOriginalSnapshot(msg.requestId, msg.imageDataUrl, msg.captureSource || ''));
      return true;
    } else if (msg.type === "UGT_IMAGE_TRANSLATION_FETCH_URL") {
      fetchImageUrlForTranslation(msg.sourceUrl || window.location.href)
        .then((result) => sendResponse({ ok: true, ...result, captureSource: 'source_tab_fetch' }))
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    } else if (msg.type === "UGT_IMAGE_TRANSLATION_COMPLETE") {
      completeImageTranslation(msg.requestId, msg.imageDataUrl, msg.elapsedMs)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
      return true;
    } else if (msg.type === "UGT_IMAGE_TRANSLATION_ERROR") {
      failImageTranslation(msg.requestId, msg.error);
      sendResponse({ ok: true });
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
      // Ignore chunks if cancel was requested
      if (sessionContext && sessionContext.isStreaming && sessionContext.container && !sessionContext.cancelRequested) {
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
      // Ignore completion if already cancelled (was handled locally)
      if (sessionContext && sessionContext.container && !sessionContext.cancelRequested) {
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
      // Ignore errors if already cancelled (was handled locally)
      if (sessionContext && sessionContext.container && !sessionContext.cancelRequested) {
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
      sendResponse({ status: "shown" });
      return true;
    } else if (msg.type === "UGT_HIDE_TTS_OVERLAY" && window.self === window.top) {
      console.log('[UGT TTS] Received UGT_HIDE_TTS_OVERLAY message');
      hideTTSOverlay();
    } else if (msg.type === "PLAY_TTS_AUDIO") {
      console.log('[UGT TTS] Received PLAY_TTS_AUDIO message, audio size:', msg.audio?.length || 0);
      playTTSAudio(msg.audio, msg.mimeType, (success) => {
        // Send status back to background so it knows if playback started
        sendResponse({ status: success ? "playing" : "failed" });
      });
      return true; // Keep channel open for async response
    } else if (msg.type === "LESSON_STREAM_CHUNK") {
      // Handle lesson streaming chunks - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('LESSON_STREAM_CHUNK received without sessionId');
        return;
      }
      
      const sessionContext = lessonSessions.get(sessionId);
      // Ignore chunks if cancel was requested
      if (sessionContext && sessionContext.isStreaming && sessionContext.container && !sessionContext.cancelRequested) {
        // Hide the progress overlay on first chunk - lesson is now visible
        const currentContent = sessionContext.lessonContent || '';
        if (!currentContent) {
          // First chunk received - hide overlay and update text
          hideLessonOverlay();
        }
        
        // Append new chunk
        const newContent = currentContent + msg.chunk;
        sessionContext.lessonContent = newContent;
        
        // Update the lesson content display
        updateLessonContent(sessionContext.container, newContent);
      }
    } else if (msg.type === "LESSON_STREAM_COMPLETE") {
      // Handle lesson stream completion - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('LESSON_STREAM_COMPLETE received without sessionId');
        return;
      }
      
      // Ensure overlay is hidden
      hideLessonOverlay();
      
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext && sessionContext.container && !sessionContext.cancelRequested) {
        sessionContext.isStreaming = false;
        
        // Add action buttons for the lesson content if not already present
        if (!sessionContext.container.querySelector('.ugt-message-actions')) {
          const htmlContent = simpleMarkdownToHtml(sessionContext.lessonContent);
          const actionButtons = createMessageActionButtons(sessionContext.lessonContent, htmlContent);
          sessionContext.container.appendChild(actionButtons);
        }
        
        // Show the chat interface now that the lesson is complete
        createLessonChatInterface(sessionContext.container, sessionContext.originalText, sessionContext.lessonContent, sessionId);
        
        // Update stop button to indicate completion
        const stopButton = sessionContext.container.querySelector('.ugt-lesson-stop-btn');
        if (stopButton) {
          stopButton.remove();
        }
      }
    } else if (msg.type === "LESSON_STREAM_ERROR") {
      // Handle lesson stream error - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('LESSON_STREAM_ERROR received without sessionId');
        return;
      }
      
      // Ensure overlay is hidden
      hideLessonOverlay();
      
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext && sessionContext.container && !sessionContext.cancelRequested) {
        sessionContext.isStreaming = false;
        
        // Show error in the lesson container
        const contentWrapper = sessionContext.container.querySelector('.ugt-lesson-content');
        if (contentWrapper) {
          contentWrapper.innerHTML = `<div style="color: #ef4444; font-weight: 500;">Error: ${escapeHtml(msg.error || 'An error occurred')}</div>`;
        }
        
        // Remove stop button
        const stopButton = sessionContext.container.querySelector('.ugt-lesson-stop-btn');
        if (stopButton) {
          stopButton.remove();
        }
      }
    } else if (msg.type === "LESSON_CHAT_STREAM_CHUNK") {
      // Handle lesson chat streaming chunks - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('LESSON_CHAT_STREAM_CHUNK received without sessionId');
        return;
      }
      
      const sessionContext = lessonSessions.get(sessionId);
      // Ignore chunks if cancel was requested
      if (sessionContext && sessionContext.isChatStreaming && sessionContext.container && !sessionContext.chatCancelRequested) {
        // Find the streaming message element by both streaming status AND session ID
        const streamingMsg = sessionContext.container.querySelector(`.ugt-lesson-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        if (streamingMsg) {
          // Get existing content or empty string
          const currentContent = streamingMsg.dataset.content || '';
          const newContent = currentContent + msg.chunk;
          streamingMsg.dataset.content = newContent;
          updateLessonChatStreamingMessage(streamingMsg, newContent);
        }
      }
    } else if (msg.type === "LESSON_CHAT_STREAM_COMPLETE") {
      // Handle lesson chat stream completion - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('LESSON_CHAT_STREAM_COMPLETE received without sessionId');
        return;
      }
      
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext && sessionContext.container && !sessionContext.chatCancelRequested) {
        const streamingMsg = sessionContext.container.querySelector(`.ugt-lesson-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        const chatInput = sessionContext.container.querySelector('.ugt-lesson-chat-input');
        const sendButton = sessionContext.container.querySelector('.ugt-lesson-chat-send');
        
        if (streamingMsg) {
          const finalContent = streamingMsg.dataset.content || '';
          finishLessonChatResponse(streamingMsg, finalContent, false, sessionId);
          
          // Add to chat history in session context
          if (!sessionContext.chatHistory) sessionContext.chatHistory = [];
          sessionContext.chatHistory.push({ role: 'assistant', content: finalContent });
        }
        
        if (chatInput && sendButton) {
          resetLessonChatInputState(chatInput, sendButton, sessionId);
        }
      }
    } else if (msg.type === "LESSON_CHAT_STREAM_ERROR") {
      // Handle lesson chat stream error - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('LESSON_CHAT_STREAM_ERROR received without sessionId');
        return;
      }
      
      const sessionContext = lessonSessions.get(sessionId);
      if (sessionContext && sessionContext.container && !sessionContext.chatCancelRequested) {
        const streamingMsg = sessionContext.container.querySelector(`.ugt-lesson-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        const chatInput = sessionContext.container.querySelector('.ugt-lesson-chat-input');
        const sendButton = sessionContext.container.querySelector('.ugt-lesson-chat-send');
        
        if (streamingMsg) {
          finishLessonChatResponse(streamingMsg, msg.error || 'An error occurred', true, sessionId);
        }
        
        if (chatInput && sendButton) {
          resetLessonChatInputState(chatInput, sendButton, sessionId);
        }
      }
    } else if (msg.type === "ASK_STREAM_CHUNK") {
      // Handle ask streaming chunks - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('ASK_STREAM_CHUNK received without sessionId');
        return;
      }
      
      const sessionContext = askSessions.get(sessionId);
      // Ignore chunks if cancel was requested
      if (sessionContext && sessionContext.isStreaming && sessionContext.container && !sessionContext.cancelRequested) {
        // Find the streaming message element by both streaming status AND session ID
        const streamingMsg = sessionContext.container.querySelector(`.ugt-ask-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        if (streamingMsg) {
          // Accumulate content
          sessionContext.currentContent = (sessionContext.currentContent || '') + msg.chunk;
          updateAskStreamingMessage(streamingMsg, sessionContext.currentContent);
        }
      }
    } else if (msg.type === "ASK_STREAM_COMPLETE") {
      // Handle ask stream completion - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('ASK_STREAM_COMPLETE received without sessionId');
        return;
      }
      
      const sessionContext = askSessions.get(sessionId);
      if (sessionContext && sessionContext.container && !sessionContext.cancelRequested) {
        const streamingMsg = sessionContext.container.querySelector(`.ugt-ask-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        const chatInput = sessionContext.container.querySelector('.ugt-ask-input');
        const sendButton = sessionContext.container.querySelector('.ugt-ask-send-btn');
        
        if (streamingMsg) {
          const finalContent = sessionContext.currentContent || '';
          finishAskChatResponse(streamingMsg, finalContent, false, sessionId);
          
          // Add to chat history in session context
          if (!sessionContext.chatHistory) sessionContext.chatHistory = [];
          sessionContext.chatHistory.push({ role: 'assistant', content: finalContent });
        }
        
        if (chatInput && sendButton) {
          resetAskInputState(chatInput, sendButton, sessionId);
        }
      }
    } else if (msg.type === "ASK_STREAM_ERROR") {
      // Handle ask stream error - route by session ID
      const sessionId = msg.sessionId;
      if (!sessionId) {
        console.warn('ASK_STREAM_ERROR received without sessionId');
        return;
      }
      
      const sessionContext = askSessions.get(sessionId);
      if (sessionContext && sessionContext.container && !sessionContext.cancelRequested) {
        const streamingMsg = sessionContext.container.querySelector(`.ugt-ask-chat-message[data-streaming="true"][data-session-id="${sessionId}"]`);
        const chatInput = sessionContext.container.querySelector('.ugt-ask-input');
        const sendButton = sessionContext.container.querySelector('.ugt-ask-send-btn');
        
        if (streamingMsg) {
          finishAskChatResponse(streamingMsg, msg.error || 'An error occurred', true, sessionId);
        }
        
        if (chatInput && sendButton) {
          resetAskInputState(chatInput, sendButton, sessionId);
        }
      }
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

                        // Only add space if elements are in the same inline flow (no line breaks between them)
                        if (shouldAddSpace && areInSameInlineFlow(lastTranslatedElement, targetSpan)) {
                            finalTranslatedContent = " " + finalTranslatedContent;
                            //console.log("[UGT Space Debug] Space ADDED. New finalTranslatedContent:", finalTranslatedContent);
                        }
                    }
                }
              }
              targetSpan.textContent = finalTranslatedContent;
              targetSpan.setAttribute('data-translated-text', finalTranslatedContent); // Store for toggle feature
              lastTranslatedElement = targetSpan; // Update last translated element
              
              // Track this segment as translated for cultural nuances streaming
              translatedSegmentIds.add(ugtId);
            } else {
              console.warn(`No placeholder span found for ugt_id: ${ugtId}`);
            }
            lastIndex = tagRegex.lastIndex; // Update lastIndex to continue search from end of this match
          }

          // Remove processed part from buffer
          if (lastIndex > 0) {
            streamBuffer = streamBuffer.substring(lastIndex);
          }
          
          // Check if all expected segments are translated - if so, stream cultural nuances
          if (expectedSegmentIds.size > 0 && translatedSegmentIds.size >= expectedSegmentIds.size) {
            // All translations received, any remaining buffer content is cultural nuances
            const extraText = streamBuffer.trim();
            if (extraText && !extraText.startsWith('<ugt_')) {
              // Create cultural nuances container if not exists
              if (!culturalNuancesContainer) {
                // Add "Toggle All" button first if there are segments that changed
                if (lastTranslatedElement && currentTranslationBatchId && batchHasChangedSegments(currentTranslationBatchId)) {
                  const existingToggleBtn = document.querySelector(`.ugt-toggle-all-btn[data-batch-id="${currentTranslationBatchId}"]`);
                  if (!existingToggleBtn) {
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
                }
                createCulturalNuancesContainer();
              }
              
              // Update cultural nuances content with streaming text
              updateCulturalNuancesContent(extraText);
            }
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

                        // Only add space if elements are in the same inline flow (no line breaks between them)
                        if (shouldAddSpace && areInSameInlineFlow(lastTranslatedElement, targetSpan)) {
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
          
          // Add "Toggle All" button if there are segments that changed (and not already added during streaming)
          if (lastTranslatedElement && currentTranslationBatchId && batchHasChangedSegments(currentTranslationBatchId)) {
            const existingToggleBtn = document.querySelector(`.ugt-toggle-all-btn[data-batch-id="${currentTranslationBatchId}"]`);
            if (!existingToggleBtn) {
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
          }
          
          // Handle cultural nuances - either update existing container or create new one
          // Skip cultural nuances and chat interface in simple mode (Translate Only)
          const extraText = streamBuffer.trim();
          if (extraText && lastTranslatedElement && !msg.simpleMode) {
            // Use existing container if created during streaming, otherwise create new one
            let containerToUse = culturalNuancesContainer;
            
            if (!containerToUse) {
              // Create new container if not created during streaming
              containerToUse = document.createElement('div');
              containerToUse.className = 'ugt-cultural-nuances';
              
              // Create a content wrapper for the cultural nuances text
              const contentWrapper = document.createElement('div');
              contentWrapper.className = 'ugt-cultural-nuances-content';
              contentWrapper.innerHTML = simpleMarkdownToHtml(extraText);
              containerToUse.appendChild(contentWrapper);
              
              // Apply CSS reset to content wrapper to prevent page CSS interference
              Object.assign(contentWrapper.style, {
                all: 'revert',
                color: '#2d3748',
                fontSize: '14px',
                lineHeight: '1.6',
                fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
              });
              
              // Enhanced styling for cultural nuances container
              Object.assign(containerToUse.style, {
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
              let insertionParent = lastTranslatedElement.parentNode;
              let insertAfter = lastTranslatedElement;
              
              let currentElement = lastTranslatedElement;
              while (currentElement && currentElement !== document.body) {
                if (currentElement.tagName === 'A') {
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
                insertionParent.insertBefore(containerToUse, insertBeforeRef);
              } else {
                document.body.appendChild(containerToUse);
                console.warn("Last translated element had no parent, appended extra text to body.");
              }
            } else {
              // Container exists from streaming - finalize the content
              updateCulturalNuancesContent(extraText);
            }
            
            // Add action buttons for the cultural nuances content if not already present
            if (!containerToUse.querySelector('.ugt-message-actions')) {
              const htmlContent = simpleMarkdownToHtml(extraText);
              const actionButtons = createMessageActionButtons(extraText, htmlContent);
              containerToUse.appendChild(actionButtons);
            }
            
            // Create chat interface if not already present
            if (!containerToUse.querySelector('.ugt-chat-section')) {
              const chatElements = createChatInterface(containerToUse, extraText);
            }
            
            // Update the session context with translation info
            const chatSessionId = containerToUse.dataset.chatSessionId;
            if (chatSessionId) {
              const sessionContext = chatSessions.get(chatSessionId);
              if (sessionContext) {
                // Collect the ORIGINAL text (before translation) from the translated spans
                let collectedOriginalText = "";
                let collectedTranslatedText = "";
                if (currentTranslationBatchId) {
                  const batchSegments = document.querySelectorAll(`span.${UGT_SEGMENT_CLASS}[data-ugt-batch="${currentTranslationBatchId}"]`);
                  const originalTexts = [];
                  const translatedTexts = [];
                  batchSegments.forEach(span => {
                    const originalText = span.getAttribute('data-original-text');
                    const translatedText = span.getAttribute('data-translated-text');
                    if (originalText && originalText.trim()) {
                      originalTexts.push(originalText.trim());
                    }
                    if (translatedText && translatedText.trim()) {
                      translatedTexts.push(translatedText.trim());
                    }
                  });
                  collectedOriginalText = originalTexts.join(' ');
                  collectedTranslatedText = translatedTexts.join(' ');
                }
                
                sessionContext.originalText = collectedOriginalText || '';
                sessionContext.translatedText = collectedTranslatedText || fullyAssembledTranslation.trim();
                // Get provider name from settings (capitalize first letter)
                const provider = currentTranslationSettings?.provider || 'AI';
                sessionContext.providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
              }
            }
          } else if (streamBuffer.length > 0) {
            // This case means there's extra text, but no translation happened (lastTranslatedElement is null)
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

  async function handleTranslate(selectedText, settings, simpleMode = false) {
    // selectedText is info.selectionText, so it *should* be valid if we got this far.
    if (!selectedText || !selectedText.trim()) {
      console.warn("UGTBrowser: handleTranslate called without selectedText. This shouldn't happen if background script validated selection.");
      // Use a more specific error message or handle as appropriate
      showCustomError("UGTBrowser: No text was provided for translation by the extension."); 
      return;
    }
    
    // Store simpleMode for use in UI decisions later
    const isSimpleMode = simpleMode;

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

    const segmentsToTranslate = [];
    let segmentCounter = 0;
    
    // Generate a unique batch ID for this translation request (for toggle feature)
    currentTranslationBatchId = generateId();
    
    // Reset cultural nuances streaming state
    expectedSegmentIds = new Set();
    translatedSegmentIds = new Set();
    culturalNuancesContainer = null;
    culturalNuancesContent = null;

    // IN-PLACE REPLACEMENT: Find all text nodes within the range in the actual DOM
    // This avoids the clone-delete-insert cycle that breaks DOM structure with complex selections
    const textNodesToReplace = [];
    
    // Get the common ancestor that contains the entire selection
    const commonAncestor = range.commonAncestorContainer;
    
    // Helper function to check if a node is within the selection range
    function isNodeInRange(node, range) {
      try {
        // Create a range for just this node
        const nodeRange = document.createRange();
        nodeRange.selectNodeContents(node);
        
        // Check if this node's range intersects with our selection range
        // A node is in range if it starts before the range ends AND ends after the range starts
        const startsBeforeEnd = range.compareBoundaryPoints(Range.START_TO_END, nodeRange) >= 0;
        const endsAfterStart = range.compareBoundaryPoints(Range.END_TO_START, nodeRange) <= 0;
        
        return startsBeforeEnd && endsAfterStart;
      } catch (e) {
        return false;
      }
    }
    
    // Use TreeWalker on the actual DOM, starting from the common ancestor
    const rootNode = commonAncestor.nodeType === Node.TEXT_NODE ? commonAncestor.parentNode : commonAncestor;
    const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, null, false);
    
    let node;
    while (node = walker.nextNode()) {
      if (node.nodeValue.trim() !== "" && isNodeInRange(node, range)) {
        textNodesToReplace.push(node);
      }
    }

    // Replace text nodes with our placeholder spans IN-PLACE (pre-filled with original text)
    for (const textNode of textNodesToReplace) {
      const originalText = textNode.nodeValue;
      const uniqueIdCore = `${generateId()}_${segmentCounter++}`;
      const idForLLMPrompt = `ugt_${uniqueIdCore}`; // This is the ugt_id prefix for the prompt

      segmentsToTranslate.push(`${idForLLMPrompt}: ${originalText.trim()}`);
      expectedSegmentIds.add(uniqueIdCore); // Track expected segment for cultural nuances streaming

      const span = document.createElement('span');
      span.setAttribute('data-ugt-id', uniqueIdCore); // The span data-id does not have "ugt_" prefix
      span.setAttribute('data-original-text', originalText); // Store original for toggle feature
      span.setAttribute('data-ugt-batch', currentTranslationBatchId); // Batch ID for toggle all feature
      span.className = UGT_SEGMENT_CLASS;
      span.textContent = originalText; // Pre-fill with original text

      // Replace the text node with the new span IN THE ORIGINAL DOM
      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(span, textNode);
      } else {
        console.warn("Text node had no parent during replacement:", textNode);
      }
    }

    if (segmentsToTranslate.length === 0) {
      console.log("No translatable text segments found.");
      hideOverlay(true);
      return;
    }

    // Use a unique delimiter between segments so newlines within text don't break parsing
    const SEGMENT_DELIMITER = '\n<<<UGT_SEG>>>\n';
    const textPayload = segmentsToTranslate.join(SEGMENT_DELIMITER);
    showOverlay(settings.provider || "?");

    // With in-place replacement, we no longer need to delete/insert content
    // The original DOM structure (including images) is preserved
    initialInsertionHasOccurred = true;
    
    // Clear the text selection so user doesn't have to click away
    window.getSelection().removeAllRanges();

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
            },
            simpleMode: isSimpleMode // Skip creative task and follow-up chat when true
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
      
      // Track if streaming was actually in progress when user clicked close
      const wasStreamingActive = streamingPort !== null;
      
      if (streamingPort) {
        try {
          streamingPort.disconnect();
        } catch (err) {
          console.warn("Error disconnecting port on close:", err);
        }
        streamingPort = null;
      }
      
      // If there's a cultural nuances container with content, finalize it with action buttons and chat
      if (culturalNuancesContainer && culturalNuancesContent) {
        const rawText = culturalNuancesContent.textContent || '';
        if (rawText.trim()) {
          // Only add stopped notice if streaming was actually in progress
          const stoppedContent = wasStreamingActive 
            ? rawText + '\n\n_[Translation stopped by user]_'
            : rawText;
          culturalNuancesContent.innerHTML = simpleMarkdownToHtml(stoppedContent);
          
          // Add action buttons if not already present
          if (!culturalNuancesContainer.querySelector('.ugt-message-actions')) {
            const htmlContent = simpleMarkdownToHtml(stoppedContent);
            const actionButtons = createMessageActionButtons(stoppedContent, htmlContent);
            culturalNuancesContainer.appendChild(actionButtons);
          }
          
          // Create chat interface if not already present
          if (!culturalNuancesContainer.querySelector('.ugt-chat-section')) {
            createChatInterface(culturalNuancesContainer, stoppedContent);
          }
          
          // Update the session context with translation info
          const chatSessionId = culturalNuancesContainer.dataset.chatSessionId;
          if (chatSessionId) {
            const sessionContext = chatSessions.get(chatSessionId);
            if (sessionContext) {
              // Collect the ORIGINAL text (before translation) from the translated spans
              let collectedOriginalText = "";
              let collectedTranslatedText = "";
              if (currentTranslationBatchId) {
                const batchSegments = document.querySelectorAll(`span.${UGT_SEGMENT_CLASS}[data-ugt-batch="${currentTranslationBatchId}"]`);
                const originalTexts = [];
                const translatedTexts = [];
                batchSegments.forEach(span => {
                  const originalText = span.getAttribute('data-original-text');
                  const translatedText = span.getAttribute('data-translated-text');
                  if (originalText && originalText.trim()) {
                    originalTexts.push(originalText.trim());
                  }
                  if (translatedText && translatedText.trim()) {
                    translatedTexts.push(translatedText.trim());
                  }
                });
                collectedOriginalText = originalTexts.join(' ');
                collectedTranslatedText = translatedTexts.join(' ');
              }
              
              sessionContext.originalText = collectedOriginalText || '';
              sessionContext.translatedText = collectedTranslatedText || currentStreamingText.trim();
              // Get provider name from settings (capitalize first letter)
              const provider = currentTranslationSettings?.provider || 'AI';
              sessionContext.providerName = provider.charAt(0).toUpperCase() + provider.slice(1);
            }
          }
        }
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
    console.log('[UGT TTS] showTTSOverlay called, isTopFrame:', window.self === window.top);
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
    console.log('[UGT TTS] hideTTSOverlay called, isTopFrame:', window.self === window.top, 'hasOverlay:', !!ttsOverlayDiv);
    if (window.self !== window.top) {
      console.log('[UGT TTS] In iframe, sending relay to background');
      chrome.runtime.sendMessage({ type: "UGT_HIDE_TTS_OVERLAY_RELAY" });
      return;
    }
    if (!ttsOverlayDiv) {
      console.log('[UGT TTS] No overlay div to hide');
      return;
    }
    
    if (ttsOverlayDiv._spinnerInterval) {
      clearInterval(ttsOverlayDiv._spinnerInterval);
    }
    
    console.log('[UGT TTS] Removing overlay div');
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
  
  function playTTSAudio(base64Audio, mimeType, statusCallback) {
    // Stop any existing audio
    stopTTSAudio();
    
    let callbackCalled = false;
    const reportStatus = (success) => {
      if (!callbackCalled && statusCallback) {
        callbackCalled = true;
        console.log('[UGT TTS] Reporting status:', success ? 'success' : 'failed');
        statusCallback(success);
      }
    };
    
    // Timeout to ensure callback is always called (in case events don't fire)
    setTimeout(() => {
      if (!callbackCalled) {
        console.log('[UGT TTS] Callback timeout - assuming success since no error');
        reportStatus(true);
      }
    }, 3000);
    
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
        console.log('[UGT TTS] Audio playing event fired');
        updateTTSOverlay("Playing...");
        reportStatus(true); // Report success when audio actually starts
      });
      
      // Clean up when done
      ttsAudioElement.addEventListener('ended', () => {
        console.log('[UGT TTS] Audio ended event fired, hiding overlay');
        URL.revokeObjectURL(audioUrl);
        hideTTSOverlay();
        ttsAudioElement = null;
      });
      
      // Handle errors
      ttsAudioElement.addEventListener('error', (e) => {
        console.error("[UGT TTS] Audio playback error:", e);
        URL.revokeObjectURL(audioUrl);
        hideTTSOverlay();
        ttsAudioElement = null;
        reportStatus(false);
      });
      
      // Play
      ttsAudioElement.play().catch(err => {
        console.error("Error playing TTS audio:", err);
        hideTTSOverlay();
        reportStatus(false);
      });
      
    } catch (e) {
      console.error("Error creating audio from base64:", e);
      hideTTSOverlay();
      reportStatus(false);
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
  
  // Lesson Progress Overlay functions
  function showLessonOverlay(sessionId) {
    if (window.self !== window.top) {
      chrome.runtime.sendMessage({ type: "UGT_SHOW_LESSON_OVERLAY_RELAY", sessionId });
      return;
    }
    if (lessonOverlayDiv) hideLessonOverlay();
    
    lessonOverlaySessionId = sessionId;
    lessonOverlayDiv = document.createElement("div");
    Object.assign(lessonOverlayDiv.style, {
      position: "fixed",
      top: "10px",
      right: "10px",
      padding: "12px 16px",
      background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
      color: "#fff",
      borderRadius: "8px",
      zIndex: "2147483647",
      fontSize: "14px",
      fontFamily: "Arial, sans-serif",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      boxShadow: "0 4px 15px rgba(16, 185, 129, 0.4)"
    });
    
    // Book icon
    const iconSpan = document.createElement("span");
    iconSpan.textContent = "📚";
    iconSpan.style.fontSize = "18px";
    lessonOverlayDiv.appendChild(iconSpan);
    
    // Text
    const textSpan = document.createElement("span");
    textSpan.className = "lesson-overlay-text";
    textSpan.textContent = "Creating lesson...";
    lessonOverlayDiv.appendChild(textSpan);
    
    // Spinner
    const spinnerSpan = document.createElement("span");
    spinnerSpan.className = "lesson-spinner";
    spinnerSpan.textContent = "⠋";
    spinnerSpan.style.display = "inline-block";
    spinnerSpan.style.width = "1em";
    spinnerSpan.style.animation = "none";
    lessonOverlayDiv.appendChild(spinnerSpan);
    
    // Animate spinner
    const dots = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frame = 0;
    lessonOverlayDiv._spinnerInterval = setInterval(() => {
      frame = (frame + 1) % dots.length;
      spinnerSpan.textContent = dots[frame];
    }, 100);
    
    // Cancel button
    const cancelBtn = document.createElement("span");
    cancelBtn.innerHTML = "✖";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.marginLeft = "8px";
    cancelBtn.style.color = "#ffcccc";
    cancelBtn.title = "Cancel";
    cancelBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      cancelLessonFromOverlay();
    });
    lessonOverlayDiv.appendChild(cancelBtn);
    
    document.body.appendChild(lessonOverlayDiv);
  }
  
  function hideLessonOverlay() {
    if (window.self !== window.top) {
      chrome.runtime.sendMessage({ type: "UGT_HIDE_LESSON_OVERLAY_RELAY" });
      return;
    }
    if (!lessonOverlayDiv) return;
    
    if (lessonOverlayDiv._spinnerInterval) {
      clearInterval(lessonOverlayDiv._spinnerInterval);
    }
    
    lessonOverlayDiv.remove();
    lessonOverlayDiv = null;
    lessonOverlaySessionId = null;
  }
  
  function updateLessonOverlay(text) {
    if (!lessonOverlayDiv) return;
    const textSpan = lessonOverlayDiv.querySelector('.lesson-overlay-text');
    if (textSpan) {
      textSpan.textContent = text;
    }
  }
  
  function cancelLessonFromOverlay() {
    const sessionId = lessonOverlaySessionId;
    if (!sessionId) {
      hideLessonOverlay();
      return;
    }
    
    const sessionContext = lessonSessions.get(sessionId);
    if (sessionContext) {
      sessionContext.cancelRequested = true;
      sessionContext.isStreaming = false;
      
      // Send cancel message to background
      chrome.runtime.sendMessage({
        type: 'LESSON_CANCEL',
        payload: { sessionId: sessionId }
      });
      
      // Remove the lesson container if it was created
      if (sessionContext.container && sessionContext.container.parentNode) {
        sessionContext.container.remove();
      }
      
      // Clean up session
      lessonSessions.delete(sessionId);
    }
    
    hideLessonOverlay();
  }
  
  // ========================================
  // STANDALONE MODE INITIALIZATION
  // ========================================
  
  // Listen for standalone mode initialization
  window.addEventListener('UGTStandaloneInit', function() {
    const standaloneConfig = window.UGT_STANDALONE_MODE;
    if (!standaloneConfig || !standaloneConfig.text) {
      console.error('UGT Standalone: No configuration found');
      return;
    }
    
    console.log('UGT Standalone: Initializing with action:', standaloneConfig.action);
    
    const { action, text, simpleMode } = standaloneConfig;
    
    switch (action) {
      case 'lesson':
        // Get lesson prompt from storage, then create lesson
        chrome.storage.local.get(['lessonPrompt'], (data) => {
          handleCreateLesson(text, data.lessonPrompt);
        });
        break;
        
      case 'ask':
        handleAskAbout(text);
        break;
        
      case 'translate':
        // For translate in standalone mode, we need to handle it differently
        // Create a simple display panel instead of inline replacement
        handleStandaloneTranslate(text, simpleMode);
        break;
        
      default:
        console.error('UGT Standalone: Unknown action:', action);
    }
  });
  
  // Handle translation in standalone mode (creates a display panel instead of inline replacement)
  function handleStandaloneTranslate(text, simpleMode = false) {
    if (!text || !text.trim()) {
      console.warn('Standalone translate called without text');
      return;
    }
    
    const container = window.UGT_STANDALONE_MODE?.container;
    if (!container) {
      console.error('Standalone translate: No container found');
      return;
    }
    
    // Create a translation display panel similar to lesson/ask panels
    const translatePanel = document.createElement('div');
    translatePanel.className = 'ugt-translate-panel';
    Object.assign(translatePanel.style, {
      padding: '18px 22px',
      borderLeft: '4px solid #10b981', // Green accent for translation
      backgroundColor: '#ecfdf5',
      borderRadius: '0 10px 10px 0',
      color: '#1f2937',
      fontSize: '14px',
      lineHeight: '1.6',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif'
    });
    
    // Header
    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px',
      paddingBottom: '10px',
      borderBottom: '1px solid rgba(16, 185, 129, 0.3)'
    });
    header.innerHTML = '<strong style="color: #059669; font-size: 15px;">🌐 Translation</strong>';
    translatePanel.appendChild(header);
    
    // Original text section
    const originalSection = document.createElement('div');
    originalSection.style.marginBottom = '16px';
    originalSection.innerHTML = `
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Original Text</div>
      <div style="color: #4b5563; font-style: italic; padding: 10px; background: rgba(0,0,0,0.03); border-radius: 6px;">${escapeHtml(text)}</div>
    `;
    translatePanel.appendChild(originalSection);
    
    // Translation section
    const translationSection = document.createElement('div');
    translationSection.innerHTML = `
      <div style="font-size: 12px; color: #6b7280; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Translation</div>
      <div class="ugt-translation-content" style="color: #1f2937; padding: 10px; background: white; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.2);">
        <span class="ugt-loading-spinner" style="color: #10b981;">⠋</span> Translating...
      </div>
    `;
    translatePanel.appendChild(translationSection);
    
    const translationContent = translationSection.querySelector('.ugt-translation-content');
    
    // Start spinner animation
    const spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let spinnerIndex = 0;
    const spinnerEl = translationSection.querySelector('.ugt-loading-spinner');
    const spinnerInterval = setInterval(() => {
      if (spinnerEl) {
        spinnerIndex = (spinnerIndex + 1) % spinnerChars.length;
        spinnerEl.textContent = spinnerChars[spinnerIndex];
      }
    }, 100);
    
    // Action buttons (will be populated after translation)
    const actionButtons = document.createElement('div');
    actionButtons.className = 'ugt-translation-actions';
    actionButtons.style.cssText = 'margin-top: 12px; display: none;';
    translatePanel.appendChild(actionButtons);
    
    container.appendChild(translatePanel);
    
    // Get settings and request translation
    chrome.storage.local.get(null, (data) => {
      const settings = data.settings || {};
      const targetLang = settings.targetLang || 'English';
      
      // Request simple translation from background
      chrome.runtime.sendMessage({
        type: 'STANDALONE_TRANSLATE',
        sessionId: 'translate_' + Date.now(),
        text: text,
        settings: settings
      });
      
      // Store reference for message handling
      translatePanel.dataset.targetLang = targetLang;
    });
    
    // Listen for translation result
    const messageHandler = (msg) => {
      if (msg.type === 'STANDALONE_RESULT' || msg.type === 'STANDALONE_ERROR') {
        clearInterval(spinnerInterval);
        
        if (msg.type === 'STANDALONE_ERROR') {
          translationContent.innerHTML = `<span style="color: #ef4444;">Error: ${escapeHtml(msg.error)}</span>`;
        } else {
          const translatedText = msg.content;
          translationContent.innerHTML = simpleMarkdownToHtml(translatedText);
          
          // Show action buttons
          actionButtons.style.display = 'flex';
          actionButtons.style.gap = '8px';
          actionButtons.innerHTML = `
            <button class="ugt-copy-btn" style="padding: 6px 12px; font-size: 12px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer;">📋 Copy Translation</button>
          `;
          
          const copyBtn = actionButtons.querySelector('.ugt-copy-btn');
          copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(translatedText).then(() => {
              copyBtn.textContent = '✓ Copied!';
              setTimeout(() => { copyBtn.textContent = '📋 Copy Translation'; }, 2000);
            });
          });
          
          // Add chat interface for follow-up questions (skip in simple mode)
          if (!simpleMode) {
            createStandaloneTranslateChat(translatePanel, text, translatedText);
          }
        }
        
        // Remove listener after handling
        chrome.runtime.onMessage.removeListener(messageHandler);
      }
    };
    
    chrome.runtime.onMessage.addListener(messageHandler);
  }
  
  // Create chat interface for standalone translation follow-up questions
  function createStandaloneTranslateChat(container, originalText, translatedText) {
    const sessionId = 'translate_chat_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 10);
    
    // Chat section
    const chatSection = document.createElement('div');
    chatSection.className = 'ugt-translate-chat-section';
    Object.assign(chatSection.style, {
      marginTop: '16px',
      paddingTop: '12px',
      borderTop: '1px solid rgba(16, 185, 129, 0.2)'
    });
    
    // Chat header
    const chatHeader = document.createElement('div');
    chatHeader.style.cssText = 'font-size: 12px; color: #6b7280; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;';
    chatHeader.textContent = 'Ask Follow-up Questions';
    chatSection.appendChild(chatHeader);
    
    // Chat history container
    const chatHistory = document.createElement('div');
    chatHistory.className = 'ugt-translate-chat-history';
    Object.assign(chatHistory.style, {
      maxHeight: '300px',
      overflowY: 'auto',
      marginBottom: '10px',
      display: 'none'
    });
    chatSection.appendChild(chatHistory);
    
    // Input row
    const inputRow = document.createElement('div');
    inputRow.style.cssText = 'display: flex; gap: 8px;';
    
    const chatInput = document.createElement('input');
    chatInput.type = 'text';
    chatInput.placeholder = 'Ask about this translation...';
    chatInput.className = 'ugt-translate-chat-input';
    Object.assign(chatInput.style, {
      flex: '1',
      padding: '8px 12px',
      border: '1px solid #d1d5db',
      borderRadius: '6px',
      fontSize: '14px',
      outline: 'none'
    });
    chatInput.addEventListener('focus', () => { chatInput.style.borderColor = '#10b981'; });
    chatInput.addEventListener('blur', () => { chatInput.style.borderColor = '#d1d5db'; });
    
    const sendButton = document.createElement('button');
    sendButton.textContent = 'Ask';
    sendButton.className = 'ugt-translate-chat-send';
    Object.assign(sendButton.style, {
      padding: '8px 16px',
      backgroundColor: '#10b981',
      color: 'white',
      border: 'none',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer'
    });
    sendButton.addEventListener('mouseenter', () => { sendButton.style.backgroundColor = '#059669'; });
    sendButton.addEventListener('mouseleave', () => { 
      if (!isStreaming) sendButton.style.backgroundColor = '#10b981'; 
    });
    
    inputRow.appendChild(chatInput);
    inputRow.appendChild(sendButton);
    chatSection.appendChild(inputRow);
    container.appendChild(chatSection);
    
    // State
    let isStreaming = false;
    let chatMessages = [];
    let currentStreamingContent = '';
    
    // Add message to chat
    function addChatMessage(role, content) {
      chatHistory.style.display = 'block';
      
      const msgDiv = document.createElement('div');
      msgDiv.className = `ugt-translate-chat-msg ugt-translate-chat-${role}`;
      Object.assign(msgDiv.style, {
        padding: '8px 12px',
        marginBottom: '8px',
        borderRadius: '8px',
        fontSize: '14px',
        lineHeight: '1.5'
      });
      
      if (role === 'user') {
        Object.assign(msgDiv.style, {
          backgroundColor: '#10b981',
          color: 'white',
          marginLeft: '20%'
        });
        msgDiv.textContent = content;
      } else {
        Object.assign(msgDiv.style, {
          backgroundColor: '#f3f4f6',
          color: '#1f2937',
          marginRight: '10%'
        });
        msgDiv.innerHTML = content ? `<strong style="color: #10b981;">AI:</strong> ${simpleMarkdownToHtml(content)}` : '<span style="color: #10b981;">⠋</span> Thinking...';
      }
      
      chatHistory.appendChild(msgDiv);
      chatHistory.scrollTop = chatHistory.scrollHeight;
      return msgDiv;
    }
    
    // Send message
    function sendMessage() {
      const question = chatInput.value.trim();
      if (!question || isStreaming) return;
      
      // Add user message
      addChatMessage('user', question);
      chatMessages.push({ role: 'user', content: question });
      chatInput.value = '';
      
      // Show loading
      isStreaming = true;
      currentStreamingContent = '';
      sendButton.textContent = 'Stop';
      sendButton.style.backgroundColor = '#ef4444';
      chatInput.disabled = true;
      
      const assistantMsg = addChatMessage('assistant', '');
      assistantMsg.dataset.streaming = 'true';
      
      // Send to background
      chrome.runtime.sendMessage({
        type: 'CHAT_FOLLOWUP',
        payload: {
          sessionId: sessionId,
          question: question,
          originalText: originalText,
          translatedText: translatedText,
          culturalNuances: '',
          chatHistory: chatMessages.slice(0, -1)
        }
      });
    }
    
    // Handle streaming responses
    const chatMessageHandler = (msg) => {
      if (msg.type === 'CHAT_STREAM_CHUNK' && msg.sessionId === sessionId) {
        const streamingMsg = chatHistory.querySelector('[data-streaming="true"]');
        if (streamingMsg && !streamingMsg.dataset.cancelled) {
          currentStreamingContent += msg.chunk;
          streamingMsg.innerHTML = `<strong style="color: #10b981;">AI:</strong> ${simpleMarkdownToHtml(currentStreamingContent)}`;
          chatHistory.scrollTop = chatHistory.scrollHeight;
        }
      } else if (msg.type === 'CHAT_STREAM_COMPLETE' && msg.sessionId === sessionId) {
        finishResponse(false);
      } else if (msg.type === 'CHAT_STREAM_ERROR' && msg.sessionId === sessionId) {
        const streamingMsg = chatHistory.querySelector('[data-streaming="true"]');
        if (streamingMsg) {
          streamingMsg.innerHTML = `<strong style="color: #ef4444;">Error:</strong> ${escapeHtml(msg.error)}`;
          streamingMsg.removeAttribute('data-streaming');
        }
        resetInput();
      }
    };
    
    function finishResponse(cancelled) {
      const streamingMsg = chatHistory.querySelector('[data-streaming="true"]');
      if (streamingMsg) {
        const finalContent = currentStreamingContent + (cancelled && currentStreamingContent ? '\n\n*(Stopped)*' : '');
        if (finalContent) {
          streamingMsg.innerHTML = `<strong style="color: #10b981;">AI:</strong> ${simpleMarkdownToHtml(finalContent)}`;
          chatMessages.push({ role: 'assistant', content: finalContent });
          
          // Add action buttons
          const actions = createMessageActionButtons(finalContent, simpleMarkdownToHtml(finalContent));
          streamingMsg.appendChild(actions);
        } else {
          streamingMsg.remove();
        }
        streamingMsg.removeAttribute('data-streaming');
      }
      resetInput();
    }
    
    function resetInput() {
      isStreaming = false;
      sendButton.textContent = 'Ask';
      sendButton.style.backgroundColor = '#10b981';
      chatInput.disabled = false;
    }
    
    // Button click - send or stop
    sendButton.addEventListener('click', () => {
      if (isStreaming) {
        // Cancel
        const streamingMsg = chatHistory.querySelector('[data-streaming="true"]');
        if (streamingMsg) streamingMsg.dataset.cancelled = 'true';
        chrome.runtime.sendMessage({ type: 'CHAT_CANCEL', payload: { sessionId: sessionId } });
        finishResponse(true);
      } else {
        sendMessage();
      }
    });
    
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendMessage();
    });
    
    chrome.runtime.onMessage.addListener(chatMessageHandler);
  }
  
  // Check if we're already in standalone mode when script loads
  if (window.UGT_STANDALONE_MODE && window.UGT_STANDALONE_MODE.text) {
    // Delay slightly to ensure DOM is ready
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('UGTStandaloneInit'));
    }, 50);
  }
}
