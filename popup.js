// Popup script for the extension

document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('tokenInput');
  const saveTokenBtn = document.getElementById('saveTokenBtn');
  const tokenStatus = document.getElementById('tokenStatus');

  const aiTokenInput = document.getElementById('aiTokenInput');
  const saveAiTokenBtn = document.getElementById('saveAiTokenBtn');
  const aiTokenStatus = document.getElementById('aiTokenStatus');

  const toggleExtensionBtn = document.getElementById('toggleExtensionBtn');
  const enableStatus = document.getElementById('enableStatus');

  // Helper function to set status message with icon
  function setStatus(element, message, isSuccess) {
    const icon = isSuccess ? '✓' : '✗';
    element.innerHTML = `<span class="status-icon">${icon}</span>${message}`;
    element.className = isSuccess ? 'status success' : 'status error';
    element.style.display = 'flex';
  }

  // Load saved tokens and extension enabled state
  chrome.storage.local.get(['githubToken', 'aiSummaryApiKey', 'extensionEnabled'], (result) => {
    if (result.githubToken) {
      tokenInput.value = '••••••••••••';
      setStatus(tokenStatus, 'Token saved', true);
    }

    if (result.aiSummaryApiKey) {
      aiTokenInput.value = '••••••••••••';
      setStatus(aiTokenStatus, 'AI token saved', true);
    }

    // Load extension enabled state (default to true if not set)
    const isEnabled = result.extensionEnabled !== false; // default to true
    console.log('Loaded extension enabled state:', isEnabled);
    updateToggleButton(isEnabled);
  });

  function updateToggleButton(isEnabled) {
    console.log('Updating toggle button, enabled:', isEnabled);
    toggleExtensionBtn.textContent = isEnabled ? 'Disable Extension' : 'Enable Extension';
    toggleExtensionBtn.className = isEnabled ? 'disable' : 'enable';
    setStatus(enableStatus, isEnabled ? 'Extension is enabled' : 'Extension is disabled', isEnabled);
  }

  // Handle enable/disable toggle
  toggleExtensionBtn.addEventListener('click', async () => {
    try {
      console.log('Toggle button clicked');
      const result = await chrome.storage.local.get(['extensionEnabled']);
      const currentState = result.extensionEnabled !== false; // default to true
      const newState = !currentState;
      
      console.log('Current state:', currentState, 'New state:', newState);
      
      await chrome.storage.local.set({ extensionEnabled: newState });
      console.log('Storage updated, newState:', newState);
      
      // Verify the state was saved
      const verify = await chrome.storage.local.get(['extensionEnabled']);
      console.log('Verified storage value:', verify.extensionEnabled);
      
      updateToggleButton(newState);
      
      // Notify content scripts to reload
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      console.log('Current tabs:', tabs);
      if (tabs[0] && tabs[0].id) {
        try {
          const response = await chrome.tabs.sendMessage(tabs[0].id, {
            action: 'extensionEnabledChanged',
            enabled: newState
          });
          console.log('Message sent to content script, enabled:', newState, 'response:', response);
        } catch (error) {
          console.warn('Failed to send message to content script:', error);
          // If content script is not loaded, user will need to refresh the page
          setStatus(enableStatus, newState 
            ? 'Extension enabled. Please refresh the page.' 
            : 'Extension disabled. Please refresh the page.', true);
        }
      } else {
        console.warn('No active tab found');
      }
    } catch (error) {
      console.error('Error toggling extension:', error);
      setStatus(enableStatus, 'Error: ' + error.message, false);
    }
  });

  // Save token
  saveTokenBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    
    if (!token) {
      setStatus(tokenStatus, 'Please enter a token', false);
      return;
    }

    try {
      // Send token to background script
      chrome.runtime.sendMessage({
        action: 'setGitHubToken',
        token: token
      }, (response) => {
        if (response?.success) {
          setStatus(tokenStatus, 'Token saved successfully!', true);
          tokenInput.value = '••••••••••••';
        } else {
          setStatus(tokenStatus, 'Failed to save token: ' + (response?.error || 'Unknown error'), false);
        }
      });
    } catch (error) {
      setStatus(tokenStatus, 'Error: ' + error.message, false);
    }
  });

  saveAiTokenBtn.addEventListener('click', () => {
    const token = aiTokenInput.value.trim();

    if (!token) {
      setStatus(aiTokenStatus, 'Please enter an AI summary token', false);
      return;
    }

    chrome.runtime.sendMessage(
      {
        action: 'setAiSummaryToken',
        token
      },
      (response) => {
        if (response?.success) {
          setStatus(aiTokenStatus, 'AI token saved successfully!', true);
          aiTokenInput.value = '••••••••••••';
        } else {
          setStatus(aiTokenStatus, 'Failed to save AI token: ' + (response?.error || 'Unknown error'), false);
        }
      }
    );
  });
});

