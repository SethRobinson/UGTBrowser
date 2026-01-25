// Standalone mode initialization script
(function() {
  const urlParams = new URLSearchParams(window.location.search);
  const action = urlParams.get('action');
  const text = decodeURIComponent(urlParams.get('text') || '');
  const showNotice = urlParams.get('restricted') === 'true';
  
  // Show notice if applicable - explains why a popup window was opened
  if (showNotice) {
    document.getElementById('restrictedNotice').classList.add('visible');
    document.getElementById('dismissNotice').addEventListener('click', function() {
      document.getElementById('restrictedNotice').classList.remove('visible');
    });
  }
  
  // Update page title based on action
  const titles = {
    'translate': 'UGTBrowser - Translation',
    'lesson': 'UGTBrowser - Lesson',
    'ask': 'UGTBrowser - Ask'
  };
  document.getElementById('pageTitle').textContent = titles[action] || 'UGTBrowser';
  document.title = titles[action] || 'UGTBrowser';
  
  // Close button
  document.getElementById('closeButton').addEventListener('click', function() {
    window.close();
  });
  
  // Signal to content script that we're in standalone mode
  // The content script will check for this and handle accordingly
  window.UGT_STANDALONE_MODE = {
    action: action,
    text: text,
    container: document.getElementById('standaloneContainer')
  };
  
  // Dispatch a custom event that the content script will listen for
  window.dispatchEvent(new CustomEvent('UGTStandaloneInit'));
})();
