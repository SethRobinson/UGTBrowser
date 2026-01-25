// src/content/ui/overlays.js
// Progress and status overlays for translation, TTS, and other operations

// Track active overlays
let activeOverlay = null;
let ttsOverlay = null;

// ========================================
// TRANSLATION OVERLAY
// ========================================

/**
 * Show translation progress overlay
 */
export function showTranslationOverlay(providerName = 'AI') {
  // Remove any existing overlay
  removeTranslationOverlay(true);
  
  activeOverlay = document.createElement('div');
  activeOverlay.id = 'ugt-translation-overlay';
  Object.assign(activeOverlay.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    padding: '14px 20px',
    backgroundColor: 'rgba(250, 250, 250, 0.95)',
    backdropFilter: 'blur(10px)',
    color: '#1a1a2e',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    zIndex: '2147483645',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    maxWidth: '350px',
    minWidth: '220px',
    border: '1px solid rgba(0, 0, 0, 0.08)'
  });
  
  // Provider icon
  const icon = document.createElement('span');
  icon.style.fontSize = '20px';
  icon.textContent = getProviderIcon(providerName);
  
  // Content container
  const contentDiv = document.createElement('div');
  contentDiv.style.flex = '1';
  
  // Status text
  const statusText = document.createElement('div');
  statusText.id = 'ugt-overlay-status';
  statusText.style.fontWeight = '500';
  statusText.textContent = `Translating with ${providerName}...`;
  
  // Preview text (for streaming)
  const previewText = document.createElement('div');
  previewText.id = 'ugt-overlay-preview';
  Object.assign(previewText.style, {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '4px',
    maxHeight: '40px',
    overflow: 'hidden',
    textOverflow: 'ellipsis'
  });
  
  contentDiv.appendChild(statusText);
  contentDiv.appendChild(previewText);
  
  // Spinner
  const spinner = document.createElement('div');
  Object.assign(spinner.style, {
    width: '20px',
    height: '20px',
    border: '2px solid #e5e7eb',
    borderTopColor: '#6b8afd',
    borderRadius: '50%',
    animation: 'ugt-spin 1s linear infinite'
  });
  
  // Add spinner animation if not already present
  if (!document.getElementById('ugt-overlay-styles')) {
    const style = document.createElement('style');
    style.id = 'ugt-overlay-styles';
    style.textContent = `
      @keyframes ugt-spin { to { transform: rotate(360deg); } }
      @keyframes ugt-pulse { 0%, 100% { opacity: 0.5; } 50% { opacity: 1; } }
    `;
    document.head.appendChild(style);
  }
  
  activeOverlay.appendChild(icon);
  activeOverlay.appendChild(contentDiv);
  activeOverlay.appendChild(spinner);
  
  document.body.appendChild(activeOverlay);
}

/**
 * Update overlay preview text during streaming
 */
export function updateOverlayPreview(text) {
  const previewEl = document.getElementById('ugt-overlay-preview');
  if (previewEl && text) {
    // Show last 80 chars of streamed content
    const preview = text.length > 80 ? '...' + text.slice(-80) : text;
    previewEl.textContent = preview.replace(/\n/g, ' ');
  }
}

/**
 * Mark translation as complete in overlay
 */
export function markTranslationComplete(providerName = 'AI') {
  const statusEl = document.getElementById('ugt-overlay-status');
  if (statusEl) {
    statusEl.textContent = `Translation complete (${providerName})`;
    statusEl.style.color = '#10b981';
  }
  
  // Remove the spinner
  if (activeOverlay) {
    const spinner = activeOverlay.querySelector('div:last-child');
    if (spinner && spinner.style.animation) {
      spinner.style.animation = 'none';
      spinner.style.borderColor = '#10b981';
      spinner.innerHTML = '✓';
      spinner.style.textAlign = 'center';
      spinner.style.lineHeight = '18px';
      spinner.style.fontSize = '12px';
      spinner.style.color = '#10b981';
    }
  }
  
  // Auto-remove after 2 seconds
  setTimeout(() => removeTranslationOverlay(), 2000);
}

/**
 * Remove translation overlay
 */
export function removeTranslationOverlay(force = false) {
  if (activeOverlay) {
    if (force || activeOverlay.parentNode) {
      activeOverlay.remove();
    }
    activeOverlay = null;
  }
}

// ========================================
// ERROR OVERLAY
// ========================================

/**
 * Show error message overlay
 */
export function showErrorOverlay(message, context = '') {
  // Remove any existing error overlay
  removeErrorOverlay();
  
  const errorOverlay = document.createElement('div');
  errorOverlay.id = 'ugt-error-overlay';
  Object.assign(errorOverlay.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    padding: '14px 20px',
    backgroundColor: 'rgba(254, 242, 242, 0.98)',
    backdropFilter: 'blur(10px)',
    color: '#991b1b',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(220, 38, 38, 0.2)',
    zIndex: '2147483646',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    maxWidth: '400px',
    border: '1px solid rgba(220, 38, 38, 0.2)'
  });
  
  // Error icon
  const icon = document.createElement('span');
  icon.style.fontSize = '20px';
  icon.textContent = '⚠️';
  
  // Content
  const content = document.createElement('div');
  content.style.flex = '1';
  
  // Title
  const title = document.createElement('div');
  title.style.fontWeight = '600';
  title.style.marginBottom = '4px';
  title.textContent = 'Error';
  
  // Message
  const messageEl = document.createElement('div');
  messageEl.style.fontSize = '13px';
  messageEl.style.color = '#7f1d1d';
  messageEl.textContent = message;
  
  content.appendChild(title);
  content.appendChild(messageEl);
  
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '×';
  Object.assign(closeBtn.style, {
    background: 'none',
    border: 'none',
    color: '#991b1b',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0',
    lineHeight: '1'
  });
  closeBtn.onclick = removeErrorOverlay;
  
  errorOverlay.appendChild(icon);
  errorOverlay.appendChild(content);
  errorOverlay.appendChild(closeBtn);
  
  document.body.appendChild(errorOverlay);
  
  // Auto-remove after 8 seconds
  setTimeout(removeErrorOverlay, 8000);
}

/**
 * Remove error overlay
 */
export function removeErrorOverlay() {
  const overlay = document.getElementById('ugt-error-overlay');
  if (overlay) {
    overlay.remove();
  }
}

// ========================================
// TTS OVERLAY
// ========================================

/**
 * Show TTS playback overlay
 */
export function showTtsOverlay() {
  // Remove any existing TTS overlay
  removeTtsOverlay();
  
  ttsOverlay = document.createElement('div');
  ttsOverlay.id = 'ugt-tts-overlay';
  Object.assign(ttsOverlay.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    padding: '14px 20px',
    backgroundColor: 'rgba(250, 250, 250, 0.95)',
    backdropFilter: 'blur(10px)',
    color: '#1a1a2e',
    borderRadius: '12px',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.15)',
    zIndex: '2147483645',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    border: '1px solid rgba(0, 0, 0, 0.08)'
  });
  
  // Speaker icon
  const icon = document.createElement('span');
  icon.style.fontSize = '20px';
  icon.textContent = '🔊';
  
  // Status text
  const statusText = document.createElement('div');
  statusText.id = 'ugt-tts-status';
  statusText.textContent = 'Loading audio...';
  
  // Pulsing indicator
  const pulse = document.createElement('div');
  Object.assign(pulse.style, {
    width: '8px',
    height: '8px',
    backgroundColor: '#6b8afd',
    borderRadius: '50%',
    animation: 'ugt-pulse 1.5s ease-in-out infinite'
  });
  
  ttsOverlay.appendChild(icon);
  ttsOverlay.appendChild(statusText);
  ttsOverlay.appendChild(pulse);
  
  document.body.appendChild(ttsOverlay);
}

/**
 * Update TTS overlay status
 */
export function updateTtsOverlay(message) {
  const statusEl = document.getElementById('ugt-tts-status');
  if (statusEl) {
    statusEl.textContent = message;
  }
}

/**
 * Remove TTS overlay
 */
export function removeTtsOverlay() {
  if (ttsOverlay) {
    ttsOverlay.remove();
    ttsOverlay = null;
  }
  // Also try by ID in case of stale reference
  const overlay = document.getElementById('ugt-tts-overlay');
  if (overlay) {
    overlay.remove();
  }
}

// ========================================
// LESSON/ASK LOADING OVERLAY
// ========================================

/**
 * Show lesson/ask generation loading indicator
 */
export function showGenerationOverlay(type = 'lesson') {
  const existingOverlay = document.getElementById(`ugt-${type}-loading-overlay`);
  if (existingOverlay) return;
  
  const overlay = document.createElement('div');
  overlay.id = `ugt-${type}-loading-overlay`;
  Object.assign(overlay.style, {
    position: 'fixed',
    top: '16px',
    right: '16px',
    padding: '12px 18px',
    backgroundColor: type === 'lesson' ? 'rgba(240, 253, 244, 0.95)' : 'rgba(239, 246, 255, 0.95)',
    backdropFilter: 'blur(10px)',
    borderRadius: '10px',
    boxShadow: '0 4px 15px rgba(0, 0, 0, 0.1)',
    zIndex: '2147483645',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    fontSize: '13px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    border: type === 'lesson' ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(59, 130, 246, 0.2)'
  });
  
  // Icon
  const icon = document.createElement('span');
  icon.textContent = type === 'lesson' ? '📚' : '💬';
  icon.style.fontSize = '18px';
  
  // Text
  const text = document.createElement('span');
  text.style.color = type === 'lesson' ? '#047857' : '#1d4ed8';
  text.textContent = type === 'lesson' ? 'Generating lesson...' : 'Processing...';
  
  // Spinner
  const spinner = document.createElement('div');
  Object.assign(spinner.style, {
    width: '16px',
    height: '16px',
    border: '2px solid #e5e7eb',
    borderTopColor: type === 'lesson' ? '#10b981' : '#3b82f6',
    borderRadius: '50%',
    animation: 'ugt-spin 1s linear infinite'
  });
  
  overlay.appendChild(icon);
  overlay.appendChild(text);
  overlay.appendChild(spinner);
  
  document.body.appendChild(overlay);
}

/**
 * Remove lesson/ask generation overlay
 */
export function removeGenerationOverlay(type = 'lesson') {
  const overlay = document.getElementById(`ugt-${type}-loading-overlay`);
  if (overlay) {
    overlay.remove();
  }
}

// ========================================
// HELPERS
// ========================================

/**
 * Get icon for provider
 */
function getProviderIcon(provider) {
  const providerLower = provider.toLowerCase();
  if (providerLower.includes('openai') || providerLower.includes('gpt')) return '🤖';
  if (providerLower.includes('anthropic') || providerLower.includes('claude')) return '🧠';
  if (providerLower.includes('gemini') || providerLower.includes('google')) return '✨';
  return '🌐';
}
