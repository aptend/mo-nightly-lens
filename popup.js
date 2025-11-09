// Popup script for the extension

document.addEventListener('DOMContentLoaded', () => {
  const tokenInput = document.getElementById('tokenInput');
  const saveTokenBtn = document.getElementById('saveTokenBtn');
  const tokenStatus = document.getElementById('tokenStatus');

  const aiTokenInput = document.getElementById('aiTokenInput');
  const saveAiTokenBtn = document.getElementById('saveAiTokenBtn');
  const aiTokenStatus = document.getElementById('aiTokenStatus');

  const extensionStatus = document.getElementById('extensionStatus');

  // Load saved tokens
  chrome.storage.local.get(['githubToken', 'aiSummaryApiKey'], (result) => {
    if (result.githubToken) {
      tokenInput.value = '••••••••••••';
      tokenStatus.textContent = 'Token saved';
      tokenStatus.className = 'status success';
      tokenStatus.style.display = 'block';
    }

    if (result.aiSummaryApiKey) {
      aiTokenInput.value = '••••••••••••';
      aiTokenStatus.textContent = 'AI token saved';
      aiTokenStatus.className = 'status success';
      aiTokenStatus.style.display = 'block';
    }
  });

  // Save token
  saveTokenBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    
    if (!token) {
      tokenStatus.textContent = 'Please enter a token';
      tokenStatus.className = 'status error';
      tokenStatus.style.display = 'block';
      return;
    }

    try {
      // Send token to background script
      chrome.runtime.sendMessage({
        action: 'setGitHubToken',
        token: token
      }, (response) => {
        if (response?.success) {
          tokenStatus.textContent = 'Token saved successfully!';
          tokenStatus.className = 'status success';
          tokenStatus.style.display = 'block';
          tokenInput.value = '••••••••••••';
        } else {
          tokenStatus.textContent = 'Failed to save token: ' + (response?.error || 'Unknown error');
          tokenStatus.className = 'status error';
          tokenStatus.style.display = 'block';
        }
      });
    } catch (error) {
      tokenStatus.textContent = 'Error: ' + error.message;
      tokenStatus.className = 'status error';
      tokenStatus.style.display = 'block';
    }
  });

  saveAiTokenBtn.addEventListener('click', () => {
    const token = aiTokenInput.value.trim();

    if (!token) {
      aiTokenStatus.textContent = 'Please enter an AI summary token';
      aiTokenStatus.className = 'status error';
      aiTokenStatus.style.display = 'block';
      return;
    }

    chrome.runtime.sendMessage(
      {
        action: 'setAiSummaryToken',
        token
      },
      (response) => {
        if (response?.success) {
          aiTokenStatus.textContent = 'AI token saved successfully!';
          aiTokenStatus.className = 'status success';
          aiTokenStatus.style.display = 'block';
          aiTokenInput.value = '••••••••••••';
        } else {
          aiTokenStatus.textContent =
            'Failed to save AI token: ' + (response?.error || 'Unknown error');
          aiTokenStatus.className = 'status error';
          aiTokenStatus.style.display = 'block';
        }
      }
    );
  });

  // Check current page
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTab = tabs[0];
    if (currentTab.url?.includes('github.com/matrixorigin/mo-nightly-regression/actions')) {
      extensionStatus.textContent = 'Active on GitHub Actions page';
      extensionStatus.style.color = '#1a7f37';
    } else {
      extensionStatus.textContent = 'Navigate to GitHub Actions page to use extension';
      extensionStatus.style.color = '#656d76';
    }
  });
});

