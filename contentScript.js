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

  // NEW: Class name for our translation segments/placeholders
  const UGT_SEGMENT_CLASS = "ugt-translation-segment";

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
                        const noSpaceBeforeThese = ['.', ',', ';', ':', '?', '!', ')', ']', '}', '”', '’', '"', '\'', '%', '>'];
                        const noSpaceAfterThese = ['(', '[', '{', '“', '‘', '"', '\'', '<'];
                        
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
                        const noSpaceBeforeThese = ['.', ',', ';', ':', '?', '!', ')', ']', '}', '”', '’', '"', '\'', '%', '>'];
                        const noSpaceAfterThese = ['(', '[', '{', '“', '‘', '"', '\'', '<'];
                        
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
              lastTranslatedElement = targetSpan; // Update last translated element
            } else {
              console.warn(`(Complete) No placeholder span for ugt_id: ${ugtId}`);
            }
            lastIndex = tagRegex.lastIndex;
          }
          streamBuffer = streamBuffer.substring(lastIndex); // Remove processed parts
          
          if (streamBuffer.length > 0 && lastTranslatedElement) {
            const extraText = streamBuffer.trim();
            if (extraText) {
              //console.log("Appending extra text after last translation:", extraText);
              const extraTextContainer = document.createElement('div');
              extraTextContainer.textContent = extraText; 
              // Basic styling for the appended text container
              extraTextContainer.style.marginLeft = '8px'; 
              extraTextContainer.style.padding = '5px';
              extraTextContainer.style.border = '1px dashed #ccc';
              extraTextContainer.style.marginTop = '5px';
              extraTextContainer.style.backgroundColor = '#f9f9f9';
              extraTextContainer.style.color = '#222222'; // Ensure text is dark and readable
              extraTextContainer.style.fontWeight = '400'; // Slightly bolder for better readability
              
              if (lastTranslatedElement.parentNode) {
                lastTranslatedElement.parentNode.insertBefore(extraTextContainer, lastTranslatedElement.nextSibling);
              } else {
                // Fallback: append to body if lastTranslatedElement somehow lost its parent
                document.body.appendChild(extraTextContainer);
                console.warn("Last translated element had no parent, appended extra text to body.");
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

          // Disconnect the port now that processing is complete
          if (streamingPort) {
            try {
              console.log("Translation complete, disconnecting streaming port from content script.");
              streamingPort.disconnect();
              streamingPort = null; // Set to null immediately to prevent race conditions
            } catch (e) {
              console.warn("Error disconnecting port on stream complete:", e);
              streamingPort = null; // Also set to null if there was an error
            }
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
          if (streamingPort) {
            try { streamingPort.disconnect(); } catch (e) {}
            streamingPort = null;
          }

        } else if (msg.type === "HEARTBEAT_CONTENT" || msg.type === "HEARTBEAT_RESPONSE" || msg.type === "STATUS_CHECK") {
          // Handle other message types as before or log them
          console.log("Received message:", msg.type, msg);
          if (msg.type === "STATUS_CHECK" && streamingPort) {
            try {
              streamingPort.postMessage({ type: "STATUS_RESPONSE", status: "active", timestamp: Date.now() });
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
} 