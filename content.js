// Content script for GitHub Actions pages
// This script runs on GitHub Actions pages and extracts workflow information

// Check if extension is enabled before initializing
let extensionInstance = null;

async function initializeExtension() {
  // Check if extension is enabled
  const result = await chrome.storage.local.get(['extensionEnabled']);
  const isEnabled = result.extensionEnabled !== false; // default to true
  
  if (!isEnabled) {
    console.log('[GitHub Actions Extension] Extension is disabled, skipping initialization');
    // Make sure to clean up if already initialized
    if (extensionInstance) {
      await cleanupExtension();
    }
    return;
  }

  // If already initialized, don't initialize again
  if (extensionInstance) {
    console.log('[GitHub Actions Extension] Extension already initialized, skipping');
    return;
  }

  try {
    console.log('[GitHub Actions Extension] Loading modules...');
    const workflowModule = await import(chrome.runtime.getURL('modules/workflow/extractor.js'));
    const namespaceModule = await import(chrome.runtime.getURL('modules/namespace/index.js'));
    const uiModule = await import(chrome.runtime.getURL('modules/ui-renderer.js'));
    let issueModule = null;
    try {
      issueModule = await import(
        chrome.runtime.getURL('modules/issues/context-issue-builder-browser.js')
      );
    } catch (issueError) {
      console.warn('[GitHub Actions Extension] Failed to load issue builder module:', issueError);
    }
    
    const WorkflowExtractor = workflowModule.WorkflowExtractor;
    const NamespaceExtractor = namespaceModule.NamespaceExtractor;
    const UIRenderer = uiModule.UIRenderer;
    
    console.log('[GitHub Actions Extension] Modules loaded successfully');
    
    // Initialize extension after modules are loaded
    extensionInstance = new GitHubActionsExtension(
      WorkflowExtractor,
      NamespaceExtractor,
      UIRenderer,
      issueModule
    );
    console.log('[GitHub Actions Extension] Initializing extension...');
    await extensionInstance.init();
    console.log('[GitHub Actions Extension] Extension initialized');
  } catch (error) {
    console.error('[GitHub Actions Extension] Failed to load modules:', error);
    console.error('[GitHub Actions Extension] Error details:', error.stack);
    // Fallback: initialize with inline implementations (will check extensionEnabled internally)
    await initFallback();
  }
}

async function cleanupExtension() {
  if (extensionInstance) {
    try {
      if (typeof extensionInstance.cleanup === 'function') {
        await extensionInstance.cleanup();
      }
    } catch (error) {
      console.error('[GitHub Actions Extension] Error during cleanup:', error);
    }
    extensionInstance = null;
  }
  
  // Also manually remove any remaining UI elements as a fallback
  const allControls = document.querySelectorAll('.dc-run-controls, .dc-action-button, .dc-status-text, .dc-timeline, .dc-clear-button, [data-dc-namespace]');
  allControls.forEach(element => {
    try {
      element.remove();
    } catch (e) {
      // Ignore errors
    }
  });
  
  // Remove injected styles
  const styleElement = document.getElementById('daily-check-content-styles');
  if (styleElement) {
    try {
      styleElement.remove();
    } catch (e) {
      // Ignore errors
    }
  }
}

// Load modules and initialize extension
console.log('[GitHub Actions Extension] Content script loaded');
initializeExtension();

// Listen for enable/disable messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extensionEnabledChanged') {
    console.log('[GitHub Actions Extension] Received extensionEnabledChanged message, enabled:', message.enabled);
    
    (async () => {
      try {
        // Always clean up first
        await cleanupExtension();
        
        if (message.enabled) {
          console.log('[GitHub Actions Extension] Extension enabled, initializing...');
          await initializeExtension();
        } else {
          console.log('[GitHub Actions Extension] Extension disabled, cleanup completed');
        }
        sendResponse({ success: true });
      } catch (error) {
        console.error('[GitHub Actions Extension] Error handling extensionEnabledChanged:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    
    return true; // Indicates we will send a response asynchronously
  }
});

class GitHubActionsExtension {
  constructor(WorkflowExtractor, NamespaceExtractor, UIRenderer, issueModule) {
    if (WorkflowExtractor && NamespaceExtractor && UIRenderer) {
      this.workflowExtractor = new WorkflowExtractor();
      this.namespaceExtractor = new NamespaceExtractor();
      this.uiRenderer = new UIRenderer();
    } else {
      // Fallback: create minimal implementations
      this.workflowExtractor = null;
      this.namespaceExtractor = null;
      this.uiRenderer = null;
    }
    this.workflowData = new Map();
    this.stylesInjected = false;
    this.issueBuilderFn = issueModule?.buildIssuePayload || null;
    this.issueBuilderModulePath = 'modules/issues/context-issue-builder-browser.js';
    this.issueBuilderLoadingPromise = null;
    
    // 使用新的模块化组件
    this.stateManager = null;
    this.progressListener = null;
    this.initModules();
  }

  async initModules() {
    // 动态导入模块（因为它们在 web_accessible_resources 中）
    try {
      const stateManagerModule = await import(chrome.runtime.getURL('modules/content/state-manager.js'));
      const progressListenerModule = await import(chrome.runtime.getURL('modules/content/progress-listener.js'));
      
      this.stateManager = new stateManagerModule.StateManager();
      this.progressListener = new progressListenerModule.ProgressListener(
        this.stateManager,
        (runId, stateUpdate) => {
          // 进度更新回调
          this.handleProgressUpdate(runId, stateUpdate);
        }
      );
      
      this.progressListener.register();
    } catch (error) {
      console.warn('[GitHub Actions Extension] Failed to load content modules, using fallback:', error);
      // Fallback: 使用内联实现
      this.stateManager = this.createFallbackStateManager();
      this.progressListener = null;
      this.registerProgressListener();
      this.startProgressPolling();
    }
  }

  createFallbackStateManager() {
    // Fallback 实现 - 使用内联状态管理
    const fallbackState = {
      runStates: new Map(),
      failureReports: new Map(),
      timelineOpen: new Set()
    };
    
    return {
      runStates: fallbackState.runStates,
      failureReports: fallbackState.failureReports,
      timelineOpen: fallbackState.timelineOpen,
      getRunState: (runId) => {
        if (fallbackState.runStates.has(runId)) {
          return fallbackState.runStates.get(runId);
        }
        if (fallbackState.failureReports.has(runId)) {
          return { status: 'ready', message: 'Failure report available' };
        }
        return { status: 'idle', message: null };
      },
      setRunState: (runId, state) => {
        fallbackState.runStates.set(runId, state);
      },
      getFailureReport: (runId) => fallbackState.failureReports.get(runId) || null,
      setFailureReport: (runId, report) => {
        if (report) {
          fallbackState.failureReports.set(runId, report);
        } else {
          fallbackState.failureReports.delete(runId);
        }
      },
      updateFailureReportsCache: (reports) => {
        Object.entries(reports || {}).forEach(([runId, report]) => {
          if (report) {
            fallbackState.failureReports.set(runId, report);
          }
        });
      },
      isTimelineOpen: (runId) => fallbackState.timelineOpen.has(runId),
      toggleTimeline: (runId) => {
        if (fallbackState.timelineOpen.has(runId)) {
          fallbackState.timelineOpen.delete(runId);
        } else {
          fallbackState.timelineOpen.add(runId);
        }
      },
      getAllRunIds: () => Array.from(fallbackState.runStates.keys())
    };
  }

  handleProgressUpdate(runId, stateUpdate) {
    // 当进度更新时，更新 UI
    let item = this.workflowData.get(runId);
    if (!item || !document.contains(item)) {
      const refreshed = this.findWorkflowItemByRunId(runId);
      if (refreshed) {
        this.workflowData.set(runId, refreshed);
        item = refreshed;
      } else {
        item = null;
      }
    }
    const report = this.stateManager.getFailureReport(runId);
    if (item) {
      this.renderRunActions(item, runId, report);
    }
  }

  async init() {
    // Check if we're on a workflow run page or workflow list page
    const url = window.location.href;
    console.log('[GitHub Actions Extension] Current URL:', url);
    
    if (url.includes('/actions/runs/')) {
      console.log('[GitHub Actions Extension] Detected workflow run page');
      // Workflow run page - extract namespace from step output
      await this.handleWorkflowRunPage();
    } else if (url.includes('/actions/workflows/')) {
      console.log('[GitHub Actions Extension] Detected workflow list page');
      // Workflow list page - display extracted namespaces
      await this.handleWorkflowListPage();
    } else {
      console.log('[GitHub Actions Extension] Not a recognized page type. URL should contain /actions/runs/ or /actions/workflows/');
    }
  }

  async cleanup() {
    console.log('[GitHub Actions Extension] Cleaning up extension...');
    
    // Stop progress polling
    if (this.progressListener && typeof this.progressListener.stopPolling === 'function') {
      this.progressListener.stopPolling();
    }
    
    // Stop fallback progress polling
    this.stopProgressPolling();
    
    // Stop UI presence check
    this.stopUIPresenceCheck();
    
    // Disconnect MutationObserver
    if (this.workflowListObserver) {
      this.workflowListObserver.disconnect();
      this.workflowListObserver = null;
    }
    
    // Clean up navigation listeners
    if (this.cleanupNavigationListeners) {
      this.cleanupNavigationListeners();
      this.cleanupNavigationListeners = null;
    }
    
    // Clear workflow data
    this.workflowData.clear();
    
    // Remove all injected UI elements - use more specific selectors
    const allControls = document.querySelectorAll('.dc-run-controls, .dc-action-button, .dc-status-text, .dc-timeline, .dc-clear-button');
    allControls.forEach(element => {
      try {
        element.remove();
      } catch (e) {
        console.warn('[GitHub Actions Extension] Error removing element:', e);
      }
    });
    
    // Also remove any namespace badges that might have been injected
    const namespaceBadges = document.querySelectorAll('[data-dc-namespace]');
    namespaceBadges.forEach(badge => {
      try {
        badge.remove();
      } catch (e) {
        console.warn('[GitHub Actions Extension] Error removing namespace badge:', e);
      }
    });
    
    // Remove injected styles if any
    const styleElement = document.getElementById('daily-check-content-styles');
    if (styleElement) {
      try {
        styleElement.remove();
        this.stylesInjected = false; // Reset flag so styles can be re-injected if needed
      } catch (e) {
        console.warn('[GitHub Actions Extension] Error removing styles:', e);
      }
    }
    
    console.log('[GitHub Actions Extension] Cleanup completed');
  }

  async handleWorkflowRunPage() {
    console.log('[GitHub Actions Extension] Processing workflow run page...');
    
    try {
      // Extract workflow run ID
      const runId = this.extractRunId();
      console.log('[GitHub Actions Extension] Extracted run ID:', runId);
      if (!runId) {
        console.warn('[GitHub Actions Extension] Could not extract run ID from URL');
        return;
      }

      // Wait for page to fully load (GitHub uses dynamic loading)
      console.log('[GitHub Actions Extension] Waiting for page to load...');
      await this.waitForJobsToLoad();

      // Find the target job: "Branch Nightly Regression Test / SETUP MO TEST ENV"
      console.log('[GitHub Actions Extension] Looking for target job...');
      console.log('[GitHub Actions Extension] Target job name patterns: ["SETUP MO TEST ENV", "SETUP", "Branch Nightly Regression Test"]');
      
      // Try multiple times as GitHub loads jobs dynamically
      let jobElement = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        if (attempt > 0) {
          console.log(`[GitHub Actions Extension] Retry attempt ${attempt + 1}/5...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        jobElement = this.findTargetJob();
        if (jobElement) {
          console.log('[GitHub Actions Extension] Target job found!');
          break;
        }
      }
      
      if (!jobElement) {
        console.warn('[GitHub Actions Extension] Target job not found after multiple attempts');
        const allJobs = this.getAllJobs();
        console.log(`[GitHub Actions Extension] Found ${allJobs.length} jobs total:`);
        allJobs.forEach((job, index) => {
          console.log(`[GitHub Actions Extension]   ${index + 1}. "${job}"`);
        });
        console.log('[GitHub Actions Extension] Searching for any element containing "SETUP" or "TEST ENV"...');
        this.debugFindJobElements();
        return;
      }
      console.log('[GitHub Actions Extension] Target job found successfully');

      // Find the "Clean TKE ENV" step (note: actual name is "Clean TKE ENV" - all caps)
      console.log('[GitHub Actions Extension] Looking for target step "Clean TKE ENV"...');
      
      // First, try to expand the job if it's collapsed
      await this.expandJobIfNeeded(jobElement);
      
      // Wait a bit for steps to load
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try multiple times as steps may load dynamically
      let stepElement = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) {
          console.log(`[GitHub Actions Extension] Retry step search attempt ${attempt + 1}/3...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        stepElement = this.findTargetStep(jobElement);
        if (stepElement) {
          break;
        }
      }
      
      if (!stepElement) {
        console.warn('[GitHub Actions Extension] Target step "Clean TKE ENV" not found');
        const allSteps = this.getAllSteps(jobElement);
        console.log(`[GitHub Actions Extension] Found ${allSteps.length} steps total:`);
        allSteps.forEach((step, index) => {
          console.log(`[GitHub Actions Extension]   ${index + 1}. "${step}"`);
        });
        console.log('[GitHub Actions Extension] Debugging step elements...');
        this.debugStepElements(jobElement);
        return;
      }
      console.log('[GitHub Actions Extension] ✅ Target step found successfully');

      // Extract namespace from step output
      console.log('[GitHub Actions Extension] Extracting namespace from step output...');
      const namespace = await this.extractNamespaceFromStep(stepElement, runId);
      
      if (namespace) {
        // Store the namespace with workflow run ID
        await this.storeNamespace(runId, namespace);
        console.log(`[GitHub Actions Extension] ✅ Successfully extracted namespace: ${namespace}`);
      } else {
        console.warn('[GitHub Actions Extension] No namespace found in step output');
      }
    } catch (error) {
      console.error('[GitHub Actions Extension] Error processing workflow run page:', error);
      console.error('[GitHub Actions Extension] Error stack:', error.stack);
    }
  }

  async handleWorkflowListPage() {
    console.log('[GitHub Actions Extension] Processing workflow list page...');
    
    // Load stored namespaces and reports immediately (async operation)
    const dataPromise = this.loadStoredData();
    
    // Check if items already exist
    const existingItems = document.querySelectorAll('[data-testid="workflow-run-row"], .Box-row[data-testid], .workflow-run-item');
    const itemsWithLinks = Array.from(document.querySelectorAll('.Box-row, [data-testid="workflow-run-row"]')).filter(
      item => item.querySelector('a[href*="/actions/runs/"]')
    );
    const hasItems = existingItems.length > 0 || itemsWithLinks.length > 0;
    
    if (hasItems) {
      // Items already exist, render immediately without waiting
      const { namespaces, reports } = await dataPromise;
      this.updateFailureReportsCache(reports);
      this.renderNamespacesOnWorkflows(namespaces, reports);
      console.log('[GitHub Actions Extension] Rendered immediately on existing items');
    }
    
    // Only wait if no items found (for dynamically loaded items)
    if (!hasItems) {
      await this.waitForWorkflowList();
    }
    
    // Ensure we have the latest data and render (will skip if already rendered above)
    const { namespaces, reports } = await dataPromise;
    this.updateFailureReportsCache(reports);
    console.log('[GitHub Actions Extension] Loaded stored namespaces:', namespaces);
    console.log(
      `[GitHub Actions Extension] Found ${Object.keys(namespaces).length} stored namespaces`
    );
    console.log(
      `[GitHub Actions Extension] Found ${Object.keys(reports).length} stored failure reports`
    );
    
    // Render namespace information on each workflow item (safe to call multiple times)
    this.renderNamespacesOnWorkflows(namespaces, reports);
    
    // Observe DOM changes to handle dynamically loaded workflows
    this.observeWorkflowList();
    console.log('[GitHub Actions Extension] Workflow list page processing complete');
  }

  findWorkflowItemByRunId(runId) {
    if (!runId) {
      return null;
    }
    const workflowItems = document.querySelectorAll(
      '[data-testid="workflow-run-row"], .Box-row, .workflow-run-item'
    );
    for (const item of workflowItems) {
      // 确保元素在 DOM 中
      if (!document.contains(item)) {
        continue;
      }
      const runLink = item.querySelector('a[href*="/actions/runs/"]');
      if (!runLink) {
        continue;
      }
      const match = runLink.href.match(/\/actions\/runs\/(\d+)/);
      if (match && match[1] === runId) {
        return item;
      }
    }
    return null;
  }

  /**
   * 清理失效的元素引用
   */
  cleanupInvalidReferences() {
    const storedRunIds = Array.from(this.workflowData.keys());
    let cleanedCount = 0;
    let recoveredCount = 0;

    storedRunIds.forEach(runId => {
      const storedItem = this.workflowData.get(runId);
      
      if (!storedItem || !document.contains(storedItem)) {
        // 元素引用失效，尝试重新查找
        const newItem = this.findWorkflowItemByRunId(runId);
        if (newItem && document.contains(newItem)) {
          console.log('[UI-DEBUG] ✓ Recovered reference for runId:', runId);
          this.workflowData.set(runId, newItem);
          recoveredCount++;
          
          // 检查是否需要重新渲染 UI
          const searchRoot = newItem.matches('a') && newItem.parentElement ? newItem.parentElement : newItem;
          const existingControls = searchRoot.querySelector(`.dc-run-controls[data-run-id="${runId}"]`);
          if (!existingControls) {
            // UI 控件缺失，需要重新渲染
            this.loadStoredData().then(({ namespaces, reports }) => {
              const report = reports[runId] || null;
              console.log('[UI-DEBUG] Re-rendering UI for recovered runId:', runId);
              this.renderRunActions(newItem, runId, report);
            });
          }
        } else {
          // 找不到新元素，可能是页面滚动导致元素不在视图中，暂时保留引用
          // 或者元素真的被移除了，但这种情况应该很少
          console.warn('[UI-DEBUG] ⚠️ Cannot recover reference for runId:', runId);
          cleanedCount++;
        }
      }
    });

    if (recoveredCount > 0 || cleanedCount > 0) {
      console.log('[UI-DEBUG] Cleanup completed', {
        recoveredReferences: recoveredCount,
        cleanedReferences: cleanedCount,
        totalChecked: storedRunIds.length
      });
    }
  }

  extractRunId() {
    const match = window.location.href.match(/\/actions\/runs\/(\d+)/);
    return match ? match[1] : null;
  }

  findTargetJob() {
    // Find job with title containing "SETUP MO TEST ENV"
    // The actual job name is: "Branch Nightly Regression Test / SETUP MO TEST ENV"
    // Try multiple selectors and matching strategies
    
    // Based on actual API analysis, the job name is:
    // "Branch Nightly Regression Test / SETUP MO TEST ENV"
    const targetPatterns = [
      'SETUP MO TEST ENV',  // Most specific - exact match
      'SETUP MO TEST',      // Partial match
      '/ SETUP',            // Pattern after slash
      'SETUP.*TEST.*ENV'    // Regex pattern
    ];
    
    // Expanded selectors for GitHub Actions page structure
    const selectors = [
      // Modern GitHub structure
      '[data-testid="workflow-job"]',
      '[data-testid="workflow-job-name"]',
      'h3[data-testid="workflow-job-name"]',
      'summary[data-testid="workflow-job"]',
      'details[data-testid="workflow-job"] summary',
      
      // Timeline structure
      '.TimelineItem',
      '.TimelineItem-body',
      '.TimelineItem-body h3',
      '.TimelineItem-body h4',
      
      // Workflow job structure
      '.workflow-job',
      '.workflow-job h3',
      '.workflow-job summary',
      '.workflow-job-container',
      '.workflow-job-container h3',
      
      // General structure
      'details.summary',
      'summary',
      'h3',
      'h4',
      
      // Link-based (jobs might be links)
      'a[href*="/jobs/"]',
      'a[href*="/job/"]',
      
      // Button-based
      'button[aria-label*="job"]',
      'button[aria-label*="Job"]'
    ];
    
    // Collect all potential job elements
    const allJobCandidates = [];
    
    for (const selector of selectors) {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          const text = el.textContent?.trim() || '';
          // Check if this element or its parents/children contain job-related text
          if (text.length > 0 && text.length < 200) {
            allJobCandidates.push({
              element: el,
              text: text,
              selector: selector
            });
          }
        });
      } catch (e) {
        // Skip invalid selectors
        continue;
      }
    }
    
    console.log(`[GitHub Actions Extension] Found ${allJobCandidates.length} potential job elements`);
    
    // Try to find matching job
    for (const candidate of allJobCandidates) {
      const text = candidate.text.toUpperCase();
      
      // Check each pattern
      for (const pattern of targetPatterns) {
        if (text.includes(pattern.toUpperCase())) {
          console.log(`[GitHub Actions Extension] Matched pattern "${pattern}" in: "${candidate.text}"`);
          
          // Try to find the container element
          const container = candidate.element.closest('.TimelineItem') ||
                           candidate.element.closest('[data-testid="workflow-job"]') ||
                           candidate.element.closest('details') ||
                           candidate.element.closest('.workflow-job-container') ||
                           candidate.element.closest('.TimelineItem-body')?.parentElement ||
                           candidate.element.parentElement?.closest('.TimelineItem') ||
                           candidate.element;
          
          if (container) {
            console.log(`[GitHub Actions Extension] Found job container using selector: ${candidate.selector}`);
            return container;
          }
        }
      }
    }
    
    // If no exact match, try fuzzy matching on all text
    console.log('[GitHub Actions Extension] Trying fuzzy matching...');
    for (const candidate of allJobCandidates) {
      const text = candidate.text.toUpperCase();
      // Look for keywords: SETUP, TEST, ENV, MO
      const keywords = ['SETUP', 'TEST', 'ENV', 'MO', 'BRANCH', 'NIGHTLY'];
      const matchCount = keywords.filter(kw => text.includes(kw)).length;
      
      if (matchCount >= 3) { // At least 3 keywords match
        console.log(`[GitHub Actions Extension] Fuzzy match found (${matchCount} keywords): "${candidate.text}"`);
        const container = candidate.element.closest('.TimelineItem') ||
                         candidate.element.closest('[data-testid="workflow-job"]') ||
                         candidate.element.closest('details') ||
                         candidate.element;
        if (container) {
          return container;
        }
      }
    }
    
    return null;
  }

  async waitForJobsToLoad() {
    // Wait for jobs to appear on the page
    const maxWait = 10000; // 10 seconds
    const checkInterval = 200; // Check every 200ms
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      // Check if any job elements exist
      const hasJobs = document.querySelectorAll(
        '[data-testid="workflow-job"], .TimelineItem, .workflow-job, h3, summary'
      ).length > 0;
      
      if (hasJobs) {
        // Wait a bit more for dynamic content
        await new Promise(resolve => setTimeout(resolve, 500));
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    console.warn('[GitHub Actions Extension] Jobs did not load within timeout');
  }

  debugFindJobElements() {
    // Debug function to find all job-related elements
    console.log('[GitHub Actions Extension] === Debug: Searching for job elements ===');
    
    // Try to find all elements containing "SETUP" or "TEST"
    const allElements = document.querySelectorAll('*');
    const matchingElements = [];
    
    for (const el of allElements) {
      const text = el.textContent?.trim() || '';
      if (text.length > 10 && text.length < 200) {
        const upperText = text.toUpperCase();
        if (upperText.includes('SETUP') || 
            upperText.includes('TEST ENV') || 
            upperText.includes('MO TEST') ||
            upperText.includes('BRANCH NIGHTLY')) {
          matchingElements.push({
            tag: el.tagName,
            text: text.substring(0, 100),
            className: el.className,
            id: el.id,
            testId: el.getAttribute('data-testid'),
            element: el
          });
        }
      }
    }
    
    console.log(`[GitHub Actions Extension] Found ${matchingElements.length} elements containing keywords:`);
    matchingElements.slice(0, 10).forEach((item, index) => {
      console.log(`[GitHub Actions Extension] ${index + 1}. <${item.tag}> "${item.text}"`);
      console.log(`[GitHub Actions Extension]    class: ${item.className}, testid: ${item.testId}`);
    });
    
    console.log('[GitHub Actions Extension] === End Debug ===');
  }

  getAllJobs() {
    // Get all job names for debugging
    const jobs = new Set();
    const selectors = [
      '[data-testid="workflow-job"]',
      '[data-testid="workflow-job-name"]',
      '.TimelineItem-body h3',
      '.TimelineItem-body h4',
      '.workflow-job',
      '.workflow-job h3',
      'h3[data-testid="workflow-job-name"]',
      'summary',
      'details summary',
      'h3',
      'h4'
    ];
    
    selectors.forEach(selector => {
      try {
        document.querySelectorAll(selector).forEach(job => {
          const title = job.textContent?.trim();
          // Filter out very short or very long text
          if (title && title.length > 5 && title.length < 200) {
            // Check if it looks like a job name (contains common patterns)
            if (title.includes('/') || 
                title.includes('Test') || 
                title.includes('Job') ||
                title.includes('Setup') ||
                title.match(/^[A-Z]/)) {
              jobs.add(title);
            }
          }
        });
      } catch (e) {
        // Skip invalid selectors
      }
    });
    
    return Array.from(jobs);
  }

  getAllSteps(jobElement) {
    // Get all step names for debugging
    const steps = [];
    if (!jobElement) return steps;
    
    const stepSelectors = [
      '.TimelineItem-body',
      '.workflow-step',
      '[data-step-name]',
      'summary'
    ];
    
    stepSelectors.forEach(selector => {
      jobElement.querySelectorAll(selector).forEach(step => {
        const title = step.textContent?.trim();
        if (title && title.length < 100) steps.push(title.substring(0, 50));
      });
    });
    
    return [...new Set(steps)];
  }

  findTargetStep(jobElement) {
    // Find step with title "Clean TKE ENV" (note: actual step name is "Clean TKE ENV" - all caps)
    // Based on API analysis: step name is "Clean TKE ENV" (not "Clean TKE Env")
    const stepNamePatterns = [
      'CLEAN TKE ENV',      // Exact match (all caps)
      'Clean TKE ENV',      // Mixed case
      'Clean TKE Env',      // Mixed case (fallback)
      'CLEAN TKE',          // Partial match (all caps)
      'Clean TKE',          // Partial match
      'TKE ENV'             // Even more partial
    ];
    
    // Expanded selectors for GitHub Actions step elements
    const stepSelectors = [
      // Modern GitHub structure
      '[data-testid="workflow-step"]',
      '[data-testid="workflow-step-name"]',
      'summary[data-testid="workflow-step"]',
      'details[data-testid="workflow-step"] summary',
      
      // Timeline structure
      '.TimelineItem',
      '.TimelineItem-body',
      '.TimelineItem-body summary',
      '.TimelineItem summary',
      
      // Step structure
      '.workflow-step',
      '.workflow-step summary',
      '.step',
      '.step summary',
      
      // General structure
      'details summary',
      'summary',
      '[role="button"]',
      'button',
      
      // Link-based
      'a[href*="/step/"]',
      
      // Text-based (fallback - search all elements)
      '*'
    ];
    
    // Collect all potential step elements
    const allStepCandidates = [];
    
    for (const selector of stepSelectors) {
      try {
        const elements = selector === '*' 
          ? Array.from(jobElement.querySelectorAll('*')).filter(el => {
              const text = el.textContent?.trim() || '';
              return text.length > 5 && text.length < 100 && 
                     (text.includes('Clean') || text.includes('TKE') || text.includes('ENV'));
            })
          : jobElement.querySelectorAll(selector);
        
        elements.forEach(el => {
          const text = el.textContent?.trim() || '';
          // Filter out very long text (likely not a step name)
          if (text.length > 0 && text.length < 100) {
            allStepCandidates.push({
              element: el,
              text: text,
              selector: selector
            });
          }
        });
      } catch (e) {
        // Skip invalid selectors
        continue;
      }
    }
    
    console.log(`[GitHub Actions Extension] Found ${allStepCandidates.length} potential step elements`);
    
    // Try to find matching step
    for (const candidate of allStepCandidates) {
      const text = candidate.text.toUpperCase();
      
      // Check each pattern
      for (const pattern of stepNamePatterns) {
        if (text.includes(pattern.toUpperCase())) {
          console.log(`[GitHub Actions Extension] Matched step pattern "${pattern}" in: "${candidate.text}"`);
          console.log(`[GitHub Actions Extension] Using selector: ${candidate.selector}`);
          
          // Try to find the container element
          const container = candidate.element.closest('.TimelineItem') ||
                           candidate.element.closest('[data-testid="workflow-step"]') ||
                           candidate.element.closest('details') ||
                           candidate.element.closest('.workflow-step') ||
                           candidate.element;
          
          return container;
        }
      }
    }
    
    // If no exact match, try fuzzy matching
    console.log('[GitHub Actions Extension] Trying fuzzy matching for step...');
    for (const candidate of allStepCandidates) {
      const text = candidate.text.toUpperCase();
      // Look for keywords: CLEAN, TKE, ENV
      const keywords = ['CLEAN', 'TKE', 'ENV'];
      const matchCount = keywords.filter(kw => text.includes(kw)).length;
      
      if (matchCount >= 2) { // At least 2 keywords match
        console.log(`[GitHub Actions Extension] Fuzzy match found (${matchCount} keywords): "${candidate.text}"`);
        const container = candidate.element.closest('.TimelineItem') ||
                         candidate.element.closest('[data-testid="workflow-step"]') ||
                         candidate.element.closest('details') ||
                         candidate.element;
        if (container) {
          return container;
        }
      }
    }
    
    return null;
  }

  async expandJobIfNeeded(jobElement) {
    // Try to expand the job if it's collapsed
    if (!jobElement) return;
    
    // Look for expand/collapse buttons
    const expandSelectors = [
      'details[open]',
      'summary[aria-expanded="false"]',
      'button[aria-expanded="false"]',
      '.TimelineItem[open]'
    ];
    
    // Check if job is already expanded
    const isExpanded = jobElement.querySelector('details[open]') ||
                      jobElement.matches('[open]') ||
                      jobElement.querySelector('.TimelineItem-body');
    
    if (!isExpanded) {
      console.log('[GitHub Actions Extension] Job appears to be collapsed, attempting to expand...');
      
      // Try to find and click expand button
      const expandButton = jobElement.querySelector('summary') ||
                          jobElement.querySelector('details summary') ||
                          jobElement.querySelector('button[aria-expanded="false"]');
      
      if (expandButton) {
        expandButton.click();
        // Wait for content to load
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  debugStepElements(jobElement) {
    // Debug function to find all step-related elements
    console.log('[GitHub Actions Extension] === Debug: Searching for step elements ===');
    
    // Try to find all elements containing "Clean", "TKE", or "ENV"
    const keywords = ['Clean', 'TKE', 'ENV', 'CLEAN'];
    const matchingElements = [];
    
    // Search within job element
    const allElements = jobElement.querySelectorAll('*');
    
    for (const el of allElements) {
      const text = el.textContent?.trim() || '';
      if (text.length > 5 && text.length < 150) {
        const upperText = text.toUpperCase();
        const hasKeyword = keywords.some(kw => upperText.includes(kw.toUpperCase()));
        
        if (hasKeyword) {
          matchingElements.push({
            tag: el.tagName,
            text: text.substring(0, 100),
            className: el.className,
            id: el.id,
            testId: el.getAttribute('data-testid'),
            parentTag: el.parentElement?.tagName,
            parentClass: el.parentElement?.className
          });
        }
      }
    }
    
    console.log(`[GitHub Actions Extension] Found ${matchingElements.length} elements containing keywords:`);
    matchingElements.slice(0, 15).forEach((item, index) => {
      console.log(`[GitHub Actions Extension] ${index + 1}. <${item.tag}> "${item.text}"`);
      console.log(`[GitHub Actions Extension]    class: ${item.className}`);
      console.log(`[GitHub Actions Extension]    testid: ${item.testId}`);
      console.log(`[GitHub Actions Extension]    parent: <${item.parentTag}> (${item.parentClass})`);
    });
    
    console.log('[GitHub Actions Extension] === End Debug ===');
  }

  async extractNamespaceFromStep(stepElement, runId) {
    // Try to find the step output/logs
    // GitHub typically loads logs dynamically when step is expanded
    
    // Method 1: Try to expand the step and wait for logs to load
    let logText = await this.extractLogsFromPage(stepElement);
    
    // Method 2: If page extraction fails, try GitHub API
    if (!logText.trim()) {
      console.log('Page extraction failed, trying API...');
      logText = await this.fetchStepLogs(runId);
    }

    // Extract namespace using NamespaceExtractor
    if (this.namespaceExtractor) {
      return this.namespaceExtractor.extract(logText);
    } else {
      // Fallback extraction
      return this.extractNamespaceFromText(logText);
    }
  }

  async extractLogsFromPage(stepElement) {
    let logText = '';
    
    // Check if step is already expanded and logs are visible
    const logContainer = stepElement.querySelector(
      '.log-line, .ansi, pre, code, [data-testid="log-line"], .log-viewer, .blob-wrapper'
    );
    
    if (logContainer && logContainer.textContent.trim()) {
      // Logs are already visible
      const logElements = stepElement.querySelectorAll(
        '.log-line, .ansi, pre code, [data-testid="log-line"], .blob-code-inner'
      );
      logElements.forEach(el => {
        const text = el.textContent || '';
        if (text.trim()) {
          logText += text + '\n';
        }
      });
    } else {
      // Try to expand the step
      const expandButton = stepElement.querySelector(
        'details summary, button[aria-expanded="false"], [role="button"]'
      );
      
      if (expandButton) {
        // Click to expand
        expandButton.click();
        
        // Wait for logs to load (GitHub loads logs asynchronously)
        await this.waitForLogs(stepElement);
        
        // Extract logs after expansion
        const logElements = stepElement.querySelectorAll(
          '.log-line, .ansi, pre code, [data-testid="log-line"], .blob-code-inner, .blob-code'
        );
        logElements.forEach(el => {
          const text = el.textContent || '';
          if (text.trim()) {
            logText += text + '\n';
          }
        });
      }
    }
    
    return logText;
  }

  async waitForLogs(stepElement, timeout = 5000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkInterval = setInterval(() => {
        const logElements = stepElement.querySelectorAll(
          '.log-line, .ansi, pre code, [data-testid="log-line"], .blob-code-inner'
        );
        
        if (logElements.length > 0 || (Date.now() - startTime) > timeout) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    });
  }

  async fetchStepLogs(runId) {
    // Send message to background script to fetch logs via GitHub API
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'fetchStepLogs',
        runId: runId,
        jobName: 'SETUP MO TEST ENV',
        stepName: 'Clean TKE ENV'  // Note: actual step name is "Clean TKE ENV" (all caps)
      }, (response) => {
        resolve(response?.logText || '');
      });
    });
  }

  extractNamespaceFromText(text) {
    // Extract namespace from text like:
    // "No resources found in mo-branch-commit-2d3495d51-20251104 namespace."
    const match = text.match(/No resources found in ([a-zA-Z0-9-]+) namespace/i);
    return match ? match[1] : null;
  }

  async storeNamespace(runId, namespace) {
    const data = { runId, namespace, timestamp: Date.now() };
    chrome.storage.local.set({ [`namespace_${runId}`]: data });
  }

  async loadStoredData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const namespaces = {};
        const reports = {};
        Object.keys(items).forEach(key => {
          if (key.startsWith('namespace_')) {
            const runId = key.replace('namespace_', '');
            namespaces[runId] = items[key];
          }
          if (key.startsWith('failureReport_')) {
            const runId = key.replace('failureReport_', '');
            reports[runId] = items[key];
          }
        });
        resolve({ namespaces, reports });
      });
    });
  }

  async waitForWorkflowList() {
    // Check if workflow run items already exist
    const existingItems = document.querySelectorAll('[data-testid="workflow-run-row"], .Box-row[data-testid], .workflow-run-item');
    if (existingItems.length > 0) {
      // Items already exist, no need to wait
      return;
    }

    // Wait for at least one workflow run item to appear (much faster than waiting for container)
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        const workflowItems = document.querySelectorAll('[data-testid="workflow-run-row"], .Box-row[data-testid], .workflow-run-item');
        // Also check for items with run links as fallback
        const itemsWithLinks = Array.from(document.querySelectorAll('.Box-row, [data-testid="workflow-run-row"]')).filter(
          item => item.querySelector('a[href*="/actions/runs/"]')
        );
        
        if (workflowItems.length > 0 || itemsWithLinks.length > 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50); // Check more frequently (50ms instead of 100ms)
      
      // Timeout after 1 second (reduced from 5 seconds)
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 1000);
    });
  }

  renderNamespacesOnWorkflows(namespaceData, reportData = {}) {
    // Find all workflow run items
    const workflowItems = document.querySelectorAll('[data-testid="workflow-run-row"], .Box-row, .workflow-run-item');
    
    console.log('[UI-DEBUG] renderNamespacesOnWorkflows', {
      itemCount: workflowItems.length,
      storedRunIds: Array.from(this.workflowData.keys()),
      timestamp: new Date().toISOString()
    });
    
    workflowItems.forEach(item => {
      // 检查元素是否在 DOM 中
      if (!document.contains(item)) {
        console.warn('[UI-DEBUG] ⚠️ Item not in DOM, skipping', item);
        return;
      }
      
      const runLink = item.querySelector('a[href*="/actions/runs/"]');
      if (!runLink) return;
      
      const runIdMatch = runLink.href.match(/\/actions\/runs\/(\d+)/);
      if (!runIdMatch) return;
      
      const runId = runIdMatch[1];
      
      // 检查存储的元素引用是否失效
      const storedItem = this.workflowData.get(runId);
      if (storedItem && !document.contains(storedItem)) {
        console.warn('[UI-DEBUG] ⚠️ Stored element invalid for runId:', runId);
      }
      
      this.workflowData.set(runId, item);
      const namespaceInfo = namespaceData[runId];
      const report = reportData[runId] || null;
      
      if (namespaceInfo) {
        if (this.uiRenderer) {
          this.uiRenderer.renderNamespace(item, namespaceInfo.namespace);
        } else {
          // Fallback: simple text display
          this.renderNamespaceFallback(item, namespaceInfo.namespace);
        }
      }

      this.renderRunActions(item, runId, report);
    });
  }

  observeWorkflowList() {
    console.log('[UI-DEBUG] Setting up workflow list observer...');
    
    // 防抖，避免频繁触发
    let debounceTimer = null;
    
    const observer = new MutationObserver((mutations) => {
      // 检查是否有 UI 元素被移除
      const uiRemoved = mutations.some(m => {
        return Array.from(m.removedNodes).some(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          return node.matches?.('.dc-run-controls') || node.querySelector?.('.dc-run-controls');
        });
      });
      
      // 检查是否有 workflow items 被移除（可能是 GitHub 更新了 DOM）
      const workflowItemsRemoved = mutations.some(m => {
        return Array.from(m.removedNodes).some(node => {
          if (node.nodeType !== Node.ELEMENT_NODE) return false;
          return node.matches?.('.Box-row, [data-testid="workflow-run-row"]') ||
                 node.querySelector?.('.Box-row, [data-testid="workflow-run-row"]');
        });
      });
      
      if (uiRemoved) {
        console.warn('[UI-DEBUG] ⚠️ UI ELEMENTS REMOVED!', {
          timestamp: new Date().toISOString(),
          mutations: mutations.map(m => ({
            type: m.type,
            target: m.target?.tagName,
            removedNodes: Array.from(m.removedNodes).map(n => ({
              tagName: n.tagName,
              className: n.className,
              hasDCRunControls: n.matches?.('.dc-run-controls') || n.querySelector?.('.dc-run-controls')
            }))
          }))
        });
      }
      
      if (workflowItemsRemoved) {
        console.warn('[UI-DEBUG] ⚠️ Workflow items removed (GitHub DOM update detected)!', {
          timestamp: new Date().toISOString()
        });
        // 清理失效的元素引用
        this.cleanupInvalidReferences();
      }
      
      console.log('[UI-DEBUG] MutationObserver triggered', {
        mutationCount: mutations.length,
        uiRemoved,
        workflowItemsRemoved,
        timestamp: new Date().toISOString()
      });
      
      // 防抖处理，避免频繁渲染
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(() => {
        this.loadStoredData().then(({ namespaces, reports }) => {
          this.updateFailureReportsCache(reports);
          this.renderNamespacesOnWorkflows(namespaces, reports);
        });
      }, 300);
    });

    const workflowList = document.querySelector('.workflow-list, [data-testid="workflow-runs"]');
    if (workflowList) {
      console.log('[UI-DEBUG] Workflow list container found, observing...');
      observer.observe(workflowList, {
        childList: true,
        subtree: true
      });
      // Save observer reference for cleanup
      this.workflowListObserver = observer;
    } else {
      console.warn('[UI-DEBUG] Workflow list container not found!');
    }
    
    // 启动定期 UI 检查
    this.startUIPresenceCheck();
  }

  renderNamespaceFallback(element, namespace) {
    // Simple fallback rendering
    const badge = document.createElement('span');
    badge.textContent = `Namespace: ${namespace}`;
    badge.style.cssText = 'margin-left: 8px; padding: 2px 8px; background: #0969da; color: white; border-radius: 12px; font-size: 12px;';
    const titleElement = element.querySelector('a[href*="/actions/runs/"]');
    if (titleElement) {
      titleElement.parentNode.insertBefore(badge, titleElement.nextSibling);
    }
  }

  updateFailureReportsCache(reportData = {}) {
    if (!this.stateManager) {
      // 如果 stateManager 还没初始化，等待一下
      setTimeout(() => this.updateFailureReportsCache(reportData), 100);
      return;
    }
    this.stateManager.updateFailureReportsCache(reportData);
  }

  async clearFailureReport(runId) {
    if (!runId) {
      return;
    }

    // Clear from state manager
    if (this.stateManager) {
      this.stateManager.setFailureReport(runId, null);
      this.stateManager.setRunState(runId, {
        status: 'idle',
        message: null
      });
    }

    // Clear from storage
    const key = `failureReport_${runId}`;
    await chrome.storage.local.remove(key);

    console.log(`[GitHub Actions Extension] Cleared failure report for run ${runId}`);
  }

  renderRunActions(item, runId, reportFromStorage = null) {
    if (!item || !runId) {
      console.warn('[UI-DEBUG] renderRunActions: invalid params', { item, runId });
      return;
    }

    // 检查元素是否在 DOM 中
    if (!document.contains(item)) {
      console.warn('[UI-DEBUG] ⚠️ renderRunActions: item not in DOM', {
        runId,
        itemTagName: item.tagName,
        itemClassName: item.className
      });
      return;
    }

    console.log('[UI-DEBUG] renderRunActions', {
      runId,
      itemInDOM: document.contains(item),
      timestamp: new Date().toISOString()
    });

    this.injectStyles();

    if (reportFromStorage && this.stateManager) {
      const existing = this.stateManager.getFailureReport(runId);
      if (!existing) {
        this.stateManager.setFailureReport(runId, reportFromStorage);
      }
    }

    const controls = this.getOrCreateRunControls(item, runId);
    const state = this.getRunState(runId);

    const report = (this.stateManager ? this.stateManager.getFailureReport(runId) : null) || reportFromStorage || null;
    if (report && state.status !== 'loading' && this.stateManager) {
      this.stateManager.setFailureReport(runId, report);
    }

    const effectiveState = this.getRunState(runId);
    const isReady = effectiveState.status === 'ready';
    const isLoading = effectiveState.status === 'loading';
    const isError = effectiveState.status === 'error';
    const timelineIsOpen = this.stateManager ? this.stateManager.isTimelineOpen(runId) : false;
    
    // If report exists, treat as ready (even if state hasn't been updated yet)
    const hasReport = report !== null;
    const shouldShowDetails = isReady || hasReport;

    controls.button.disabled = isLoading;
    controls.button.classList.toggle('dc-action-button--loading', isLoading);
    controls.button.classList.toggle('dc-action-button--ready', shouldShowDetails);

    let buttonLabel = 'Analyze';
    if (isLoading) {
      buttonLabel = 'Analyzing...';
    } else if (shouldShowDetails) {
      buttonLabel = timelineIsOpen ? 'Hide Details' : 'Details';
    }
    controls.button.textContent = buttonLabel;

    // Clear existing content
    controls.statusText.textContent = '';
    controls.statusText.classList.remove('dc-status--error', 'dc-status--success');
    
    // Remove existing copy button if any
    const existingCopyBtn = controls.statusText.querySelector('.dc-copy-namespace-btn');
    if (existingCopyBtn) {
      existingCopyBtn.remove();
    }

    if (isLoading) {
      controls.statusText.textContent =
        effectiveState.message || 'Generating failure report...';
    } else if (shouldShowDetails) {
      // Display namespace if available in report
      const namespace = report?.namespace;
      const baseMessage = effectiveState.message || 'Failure report available';
      if (namespace) {
        // Create container for message and namespace with copy button
        const messageText = document.createTextNode(`${baseMessage} | Namespace: `);
        controls.statusText.appendChild(messageText);
        
        // Create namespace span with copy button
        const namespaceContainer = document.createElement('span');
        namespaceContainer.className = 'dc-namespace-container';
        
        const namespaceSpan = document.createElement('span');
        namespaceSpan.textContent = namespace;
        namespaceSpan.className = 'dc-namespace-text';
        
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'dc-copy-namespace-btn';
        copyButton.setAttribute('aria-label', 'Copy namespace');
        copyButton.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25v-7.5Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25h-7.5Z"></path></svg>';
        
        copyButton.onclick = async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(namespace);
            // Visual feedback
            const originalHTML = copyButton.innerHTML;
            copyButton.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
            copyButton.classList.add('dc-copy-success');
            setTimeout(() => {
              copyButton.innerHTML = originalHTML;
              copyButton.classList.remove('dc-copy-success');
            }, 2000);
          } catch (err) {
            console.error('Failed to copy namespace:', err);
            // Fallback for older browsers
            const textArea = document.createElement('textarea');
            textArea.value = namespace;
            textArea.style.position = 'fixed';
            textArea.style.opacity = '0';
            document.body.appendChild(textArea);
            textArea.select();
            try {
              document.execCommand('copy');
              const originalHTML = copyButton.innerHTML;
              copyButton.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"></path></svg>';
              copyButton.classList.add('dc-copy-success');
              setTimeout(() => {
                copyButton.innerHTML = originalHTML;
                copyButton.classList.remove('dc-copy-success');
              }, 2000);
            } catch (fallbackErr) {
              console.error('Fallback copy failed:', fallbackErr);
            }
            document.body.removeChild(textArea);
          }
        };
        
        namespaceContainer.appendChild(namespaceSpan);
        namespaceContainer.appendChild(copyButton);
        controls.statusText.appendChild(namespaceContainer);
      } else {
        controls.statusText.textContent = baseMessage;
      }
      controls.statusText.classList.add('dc-status--success');
    } else if (isError) {
      const message = effectiveState.message || 'Failed to generate failure report';
      controls.statusText.textContent = message;
      controls.statusText.classList.add('dc-status--error');
    } else {
      controls.statusText.textContent = effectiveState.message || '';
    }

    // Show/hide clear button based on report availability
    if (controls.clearButton) {
      controls.clearButton.style.display = (shouldShowDetails && report) ? 'inline-block' : 'none';
    }

    controls.button.onclick = () => {
      this.handleRunActionClick(runId, item);
    };

    // Handle clear button click
    if (controls.clearButton) {
      controls.clearButton.onclick = async (e) => {
        e.stopPropagation();
        await this.clearFailureReport(runId);
        this.renderRunActions(item, runId, null);
      };
    }

    if (isReady && report) {
      this.renderTimeline(controls.timelineContainer, report);
      controls.timelineContainer.hidden = !timelineIsOpen;
      if (timelineIsOpen) {
        controls.timelineContainer.removeAttribute('aria-hidden');
      } else {
        controls.timelineContainer.setAttribute('aria-hidden', 'true');
      }
    } else {
      controls.timelineContainer.hidden = true;
      controls.timelineContainer.setAttribute('aria-hidden', 'true');
    }
  }

  async handleRunActionClick(runId, item) {
    const currentState = this.getRunState(runId);
    if (currentState.status === 'loading') {
      return;
    }

    const existingReport = this.stateManager ? this.stateManager.getFailureReport(runId) : null;
    if (existingReport && currentState.status === 'ready') {
      if (this.stateManager) {
        this.stateManager.toggleTimeline(runId);
      }
      this.renderRunActions(item, runId, existingReport);
      return;
    }

    this.setRunState(runId, { status: 'loading', message: 'Starting analysis...' });
    console.debug('[GitHub Actions Extension] Requesting failure report', { runId });
    this.renderRunActions(item, runId, null);

    try {
      const response = await this.requestFailureReport(runId);
      if (!response) {
        throw new Error('Empty failure report received');
      }
      console.debug('[GitHub Actions Extension] Failure report response received', { runId });
      if (this.stateManager) {
        this.stateManager.setFailureReport(runId, response);
        this.stateManager.toggleTimeline(runId);
      }
      this.renderRunActions(item, runId, response);
    } catch (error) {
      console.error('[GitHub Actions Extension] Failed to generate failure report:', error);
      this.setRunState(runId, {
        status: 'error',
        message: error && error.message ? error.message : 'Failed to generate report'
      });
      this.renderRunActions(item, runId, null);
    }
  }

  getRunState(runId) {
    if (!this.stateManager) {
      return { status: 'idle', message: null };
    }
    return this.stateManager.getRunState(runId);
  }

  setRunState(runId, state) {
    if (!this.stateManager) {
      return;
    }
    this.stateManager.setRunState(runId, state);
  }

  getOrCreateRunControls(item, runId) {
    const searchRoot = item.matches('a') && item.parentElement ? item.parentElement : item;
    const existing = searchRoot.querySelector(`.dc-run-controls[data-run-id="${runId}"]`);
    
    if (existing) {
      // 检查现有元素是否在 DOM 中
      if (!document.contains(existing)) {
        console.warn('[UI-DEBUG] ⚠️ Existing controls not in DOM, will recreate', { runId });
      } else {
        console.log('[UI-DEBUG] Found existing controls', { runId });
      }
      let clearButton = existing.querySelector('.dc-clear-button');
      // If clear button doesn't exist, create it for backward compatibility
      if (!clearButton) {
        const actionBar = existing.querySelector('.dc-action-bar');
        if (actionBar) {
          clearButton = document.createElement('button');
          clearButton.type = 'button';
          clearButton.className = 'dc-clear-button';
          clearButton.textContent = 'Clear Report';
          actionBar.appendChild(clearButton);
        }
      }
      return {
        container: existing,
        button: existing.querySelector('.dc-action-button'),
        statusText: existing.querySelector('.dc-status-text'),
        clearButton: clearButton,
        timelineContainer: existing.querySelector('.dc-timeline')
      };
    }

    const container = document.createElement('div');
    container.className = 'dc-run-controls';
    container.dataset.runId = runId;

    const actionBar = document.createElement('div');
    actionBar.className = 'dc-action-bar';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'dc-action-button';
    button.textContent = 'Analyze';

    const statusText = document.createElement('span');
    statusText.className = 'dc-status-text';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'dc-clear-button';
    clearButton.textContent = 'Clear Report';

    actionBar.appendChild(button);
    actionBar.appendChild(statusText);
    actionBar.appendChild(clearButton);

    const timelineContainer = document.createElement('div');
    timelineContainer.className = 'dc-timeline';
    timelineContainer.hidden = true;
    timelineContainer.setAttribute('aria-hidden', 'true');

    container.appendChild(actionBar);
    container.appendChild(timelineContainer);

    if (item.matches('a') && item.parentElement) {
      item.parentElement.appendChild(container);
    } else {
      item.appendChild(container);
    }

    console.log('[UI-DEBUG] Created new controls', {
      runId,
      containerInDOM: document.contains(container),
      itemInDOM: document.contains(item),
      timestamp: new Date().toISOString()
    });

    return {
      container,
      button,
      statusText,
      clearButton,
      timelineContainer
    };
  }

  async requestFailureReport(runId) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            action: 'generateFailureReport',
            runId
          },
          (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) {
              console.error('[GitHub Actions Extension] requestFailureReport runtime error', lastError);
              reject(new Error(lastError.message || 'Extension messaging failed'));
              return;
            }
            if (!response) {
              console.error('[GitHub Actions Extension] requestFailureReport empty response');
              reject(new Error('No response from background service'));
              return;
            }
            if (response.error) {
              console.error('[GitHub Actions Extension] requestFailureReport error response', response.error);
              reject(new Error(response.error));
              return;
            }
            resolve(response.report);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  async ensureIssueBuilderLoaded() {
    if (this.issueBuilderFn) {
      return true;
    }
    if (this.issueBuilderLoadingPromise) {
      return this.issueBuilderLoadingPromise;
    }
    try {
      const moduleUrl = chrome.runtime?.getURL
        ? chrome.runtime.getURL(this.issueBuilderModulePath)
        : this.issueBuilderModulePath;
      this.issueBuilderLoadingPromise = import(moduleUrl)
        .then((module) => {
          this.issueBuilderFn = module?.buildIssuePayload || null;
          return Boolean(this.issueBuilderFn);
        })
        .catch((error) => {
          console.warn('[GitHub Actions Extension] Failed to load issue builder module:', error);
          return false;
        })
        .finally(() => {
          this.issueBuilderLoadingPromise = null;
        });
      return await this.issueBuilderLoadingPromise;
    } catch (error) {
      console.warn('[GitHub Actions Extension] Issue builder dynamic import failed:', error);
      return false;
    }
  }

  async buildIssueUrl(report, contextId) {
    if (!contextId) {
      return null;
    }
    const ready = await this.ensureIssueBuilderLoaded();
    if (!ready || !this.issueBuilderFn) {
      return null;
    }
    try {
      const payload = await this.issueBuilderFn({
        report,
        contextId
      });
      return payload?.issueUrl || null;
    } catch (error) {
      console.error('[GitHub Actions Extension] Failed to build issue URL:', error);
      return null;
    }
  }

  renderTimeline(container, report) {
    if (!container) {
      return;
    }

    const entries = this.buildTimelineEntries(report);
    container.innerHTML = '';

    if (report?.aiSummary) {
      container.appendChild(this.buildOverallSummaryCard(report.aiSummary));
    }

    if (entries.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'dc-timeline-empty';
      emptyState.textContent = 'No error contexts were detected for this run.';
      container.appendChild(emptyState);
      return;
    }

    entries.forEach((entry) => {
      const entryEl = document.createElement('div');
      entryEl.className = 'dc-timeline-entry';

      const timeEl = document.createElement('div');
      timeEl.className = 'dc-timeline-time';
      timeEl.textContent = this.formatTimestamp(entry.timestamp, entry.fallbackLabel);

      const bodyEl = document.createElement('div');
      bodyEl.className = 'dc-timeline-body';

      const headerEl = document.createElement('div');
      headerEl.className = 'dc-entry-header';
      headerEl.textContent = `${entry.jobName} • ${entry.stepName}`;

      const headerRow = document.createElement('div');
      headerRow.className = 'dc-entry-header-row';
      headerRow.appendChild(headerEl);

      if (entry.stepUrl) {
        const stepLink = document.createElement('a');
        stepLink.href = entry.stepUrl;
        stepLink.target = '_blank';
        stepLink.rel = 'noopener noreferrer';
        stepLink.textContent = 'View step';
        stepLink.className = 'dc-step-link';
        headerRow.appendChild(stepLink);
      }

      bodyEl.appendChild(headerRow);

      if (entry.aiSummary) {
        const inlineSummary = document.createElement('div');
        inlineSummary.className = 'dc-ai-summary-inline';

        if (entry.aiSummary.summary) {
          const inlineBody = document.createElement('div');
          inlineBody.className = 'dc-ai-summary-inline-body';
          inlineBody.textContent = entry.aiSummary.summary;
          inlineSummary.appendChild(inlineBody);
        } else {
          inlineSummary.classList.add('dc-ai-summary-inline--empty');
          inlineSummary.textContent = 'AI summary unavailable.';
        }

        bodyEl.appendChild(inlineSummary);
      }

      const detailsEl = document.createElement('div');
      detailsEl.className = 'dc-entry-details';
      detailsEl.hidden = true;

      const toggleButton = document.createElement('button');
      toggleButton.type = 'button';
      toggleButton.className = 'dc-entry-toggle';
      toggleButton.textContent = 'Show details';
      toggleButton.setAttribute('aria-expanded', 'false');


      const createIcon = (symbol) => {
        const span = document.createElement('span');
        span.className = 'dc-link-icon';
        span.textContent = symbol;
        return span;
      };

      const linkBar = document.createElement('div');
      linkBar.className = 'dc-entry-links dc-entry-links--detail';
      if (entry.logUrl) {
        const logLink = document.createElement('a');
        logLink.href = entry.logUrl;
        logLink.target = '_blank';
        logLink.rel = 'noopener noreferrer';
        logLink.appendChild(createIcon('⬇️'));
        logLink.appendChild(document.createTextNode('Download log'));
        linkBar.appendChild(logLink);
      }
      if (entry.grafanaUrl) {
        const grafanaLink = document.createElement('a');
        grafanaLink.href = entry.grafanaUrl;
        grafanaLink.target = '_blank';
        grafanaLink.rel = 'noopener noreferrer';
        grafanaLink.appendChild(createIcon('📊'));
        grafanaLink.appendChild(document.createTextNode('Open Grafana Explore'));
        linkBar.appendChild(grafanaLink);
      }
      if (entry.contextId) {
        const issueLink = document.createElement('a');
        issueLink.href = '#';
        issueLink.appendChild(createIcon('🐞'));
        issueLink.appendChild(document.createTextNode('Create issue'));
        issueLink.addEventListener('click', async (event) => {
          event.preventDefault();
          if (issueLink.dataset.loading === 'true') {
            return;
          }
          issueLink.dataset.loading = 'true';
          issueLink.classList.add('dc-link--loading');
          try {
            const issueUrl = await this.buildIssueUrl(report, entry.contextId);
            if (issueUrl) {
              window.open(issueUrl, '_blank', 'noopener,noreferrer');
            }
          } catch (error) {
            console.error('[GitHub Actions Extension] Failed to open issue link:', error);
          } finally {
            delete issueLink.dataset.loading;
            issueLink.classList.remove('dc-link--loading');
          }
        });
        linkBar.appendChild(issueLink);
      }
      if (linkBar.childNodes.length > 0) {
        detailsEl.appendChild(linkBar);
      }


      const snippetEl = document.createElement('pre');
      snippetEl.className = 'dc-entry-snippet';
      if (entry.fullSnippet) {
        snippetEl.textContent = entry.fullSnippet;
      } else {
        snippetEl.textContent = 'No log snippet captured for this context.';
        snippetEl.classList.add('dc-entry-snippet--empty');
      }
      detailsEl.appendChild(snippetEl);

      const metadataParts = [];
      if (entry.startLine != null) {
        metadataParts.push(`Start line ${entry.startLine}`);
      }
      if (entry.endLine != null) {
        metadataParts.push(`End line ${entry.endLine}`);
      }
      if (entry.contextId) {
        metadataParts.push(`ID: ${entry.contextId}`);
      }
      if (entry.aiSummary?.model) {
        metadataParts.push(`Model: ${entry.aiSummary.model}`);
      }
      if (entry.aiSummary?.generatedAt) {
        const generated = this.safeFormatDate(entry.aiSummary.generatedAt);
        if (generated) {
          metadataParts.push(`Generated: ${generated}`);
        }
      }
      if (metadataParts.length > 0) {
        const metadataEl = document.createElement('div');
        metadataEl.className = 'dc-entry-metadata';
        metadataEl.textContent = metadataParts.join(' • ');
        detailsEl.appendChild(metadataEl);
      }

      

      toggleButton.addEventListener('click', () => {
        const shouldShow = detailsEl.hidden;
        detailsEl.hidden = !shouldShow;
        toggleButton.textContent = shouldShow ? 'Hide details' : 'Show details';
        toggleButton.setAttribute('aria-expanded', shouldShow ? 'true' : 'false');
        entryEl.classList.toggle('dc-timeline-entry--expanded', shouldShow);
      });

      const actionsEl = document.createElement('div');
      actionsEl.className = 'dc-entry-actions';
      actionsEl.appendChild(toggleButton);

      bodyEl.appendChild(actionsEl);
      bodyEl.appendChild(detailsEl);

      entryEl.appendChild(timeEl);
      entryEl.appendChild(bodyEl);

      container.appendChild(entryEl);
    });
  }

  buildOverallSummaryCard(aiSummary) {
    const card = document.createElement('div');
    card.className = 'dc-overall-summary';

    const header = document.createElement('div');
    header.className = 'dc-summary-header';

    const title = document.createElement('div');
    title.className = 'dc-summary-title';
    title.textContent = 'AI Summary';
    header.appendChild(title);

    const metaParts = [];
    if (aiSummary.provider) {
      metaParts.push(`Provider: ${aiSummary.provider}`);
    }
    if (aiSummary.model) {
      metaParts.push(`Model: ${aiSummary.model}`);
    }
    if (aiSummary.generatedAt) {
      const generated = this.safeFormatDate(aiSummary.generatedAt);
      if (generated) {
        metaParts.push(`Generated: ${generated}`);
      }
    }
    if (aiSummary.status) {
      metaParts.push(`Status: ${aiSummary.status}`);
    }

    if (metaParts.length > 0) {
      const metaEl = document.createElement('div');
      metaEl.className = 'dc-summary-meta';
      metaEl.textContent = metaParts.join(' • ');
      header.appendChild(metaEl);
    }

    card.appendChild(header);

    if (aiSummary.status === 'ok') {
      if (aiSummary.overallSummary) {
        const body = document.createElement('div');
        body.className = 'dc-summary-body';
        body.textContent = aiSummary.overallSummary;
        card.appendChild(body);
      }
      if (aiSummary.additionalNotes) {
        const notes = document.createElement('div');
        notes.className = 'dc-summary-notes';
        notes.textContent = aiSummary.additionalNotes;
        card.appendChild(notes);
      }
    } else if (aiSummary.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'dc-summary-error';
      errorEl.textContent = aiSummary.error;
      card.appendChild(errorEl);
    } else {
      const unavailable = document.createElement('div');
      unavailable.className = 'dc-summary-error';
      unavailable.textContent = 'AI summary is unavailable for this run.';
      card.appendChild(unavailable);
    }

    return card;
  }

  buildTimelineEntries(report) {
    if (!report || !Array.isArray(report.jobs)) {
      return [];
    }

    const entries = [];
    report.jobs.forEach((job) => {
      const steps = Array.isArray(job.steps) ? job.steps : [];
      steps.forEach((step) => {
        const contexts = Array.isArray(step.errorContexts) ? step.errorContexts : [];
        contexts.forEach((context, index) => {
          const timestamp = this.resolveContextTimestamp(context, step, job);
          const fullSnippet = context?.snippet || '';
          const contextId =
            context?.aiSummary?.contextId ||
            context?.cursorSummary?.contextId ||
            context?.contextId ||
            `job-${job?.id ?? 'unknown'}-step-${step?.number ?? index}-context-${index}`;
          entries.push({
            id: contextId,
            contextId,
            jobName: job.name || 'Unknown job',
            stepName: step.name || `Step ${step.number || '?'}`,
            fullSnippet,
            timestamp,
            fallbackLabel: this.buildFallbackTimestampLabel(context, step),
            stepUrl: step.stepUrl || null,
            logUrl: step.logUrl || null,
            grafanaUrl: context.grafanaUrl || step.grafanaUrl || null,
            aiSummary: context.aiSummary || null,
            startLine: context.startLine ?? null,
            endLine: context.endLine ?? null
          });
        });
      });
    });

    entries.sort((a, b) => {
      if (a.timestamp == null && b.timestamp == null) {
        return 0;
      }
      if (a.timestamp == null) {
        return 1;
      }
      if (b.timestamp == null) {
        return -1;
      }
      return a.timestamp - b.timestamp;
    });

    return entries;
  }

  resolveContextTimestamp(context, step, job) {
    if (context.startTimestamp != null) {
      return context.startTimestamp;
    }
    if (context.endTimestamp != null) {
      return context.endTimestamp;
    }
    const stepStart = step.startedAt ? Date.parse(step.startedAt) : NaN;
    if (!Number.isNaN(stepStart)) {
      return stepStart;
    }
    const jobStart = job.startedAt ? Date.parse(job.startedAt) : NaN;
    if (!Number.isNaN(jobStart)) {
      return jobStart;
    }
    return null;
  }

  buildFallbackTimestampLabel(context, step) {
    if (context.startTimestamp != null || context.endTimestamp != null) {
      return null;
    }
    if (step.startedAt) {
      return `Step started at ${step.startedAt}`;
    }
    if (step.completedAt) {
      return `Step completed at ${step.completedAt}`;
    }
    return 'Timestamp unavailable';
  }

  formatTimestamp(timestamp, fallbackLabel) {
    if (timestamp == null) {
      return fallbackLabel || 'Timestamp unavailable';
    }
    try {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) {
        return fallbackLabel || 'Timestamp unavailable';
      }
      return date.toLocaleString();
    } catch (error) {
      return fallbackLabel || 'Timestamp unavailable';
    }
  }

  safeFormatDate(value) {
    if (!value) {
      return null;
    }
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        return null;
      }
      return date.toLocaleString();
    } catch (error) {
      return null;
    }
  }

  injectStyles() {
    if (this.stylesInjected) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'daily-check-content-styles';
    style.textContent = `
      .dc-run-controls {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--color-border-default, rgba(31, 35, 40, 0.15));
        font-size: 12px;
        color: var(--color-fg-default, #24292f);
      }
      .dc-action-bar {
        display: flex;
        align-items: center;
        gap: 12px;
      }
      .dc-action-button {
        border: 1px solid var(--color-border-default, rgba(31, 35, 40, 0.15));
        background: var(--color-canvas-default, #f6f8fa);
        color: var(--color-fg-default, #24292f);
        border-radius: 6px;
        padding: 4px 12px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
      }
      .dc-action-button:hover:not(:disabled) {
        background: var(--color-neutral-muted, #d0d7de);
      }
      .dc-action-button:disabled {
        cursor: not-allowed;
        opacity: 0.6;
      }
      .dc-action-button--ready {
        border-color: var(--color-success-muted, #2da44e);
        color: var(--color-success-fg, #1a7f37);
      }
      .dc-action-button--loading {
        position: relative;
      }
      .dc-status-text {
        font-size: 12px;
        color: var(--color-fg-subtle, #57606a);
      }
      .dc-namespace-container {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .dc-namespace-text {
        font-weight: 500;
      }
      .dc-copy-namespace-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 16px;
        height: 16px;
        padding: 0;
        margin: 0;
        border: none;
        background: transparent;
        color: var(--color-fg-subtle, #57606a);
        cursor: pointer;
        border-radius: 3px;
        transition: background 0.15s ease, color 0.15s ease;
        opacity: 0.7;
      }
      .dc-copy-namespace-btn:hover {
        background: var(--color-neutral-muted, rgba(208, 215, 222, 0.5));
        color: var(--color-fg-default, #24292f);
        opacity: 1;
      }
      .dc-copy-namespace-btn:active {
        transform: scale(0.95);
      }
      .dc-copy-namespace-btn.dc-copy-success {
        color: var(--color-success-fg, #1a7f37);
        opacity: 1;
      }
      .dc-status--success {
        color: var(--color-success-fg, #1a7f37);
      }
      .dc-status--error {
        color: var(--color-danger-fg, #cf222e);
      }
      .dc-clear-button {
        border: 1px solid var(--color-border-default, rgba(31, 35, 40, 0.15));
        background: var(--color-canvas-default, #f6f8fa);
        color: var(--color-fg-default, #24292f);
        border-radius: 6px;
        padding: 4px 12px;
        font-size: 12px;
        cursor: pointer;
        transition: background 0.15s ease, border-color 0.15s ease;
        margin-left: auto;
      }
      .dc-clear-button:hover {
        background: var(--color-neutral-muted, #d0d7de);
        border-color: var(--color-danger-border, #cf222e);
        color: var(--color-danger-fg, #cf222e);
      }
      .dc-timeline {
        margin-top: 12px;
        padding-left: 16px;
        border-left: 2px solid var(--color-border-default, rgba(31, 35, 40, 0.15));
        display: grid;
        gap: 16px;
      }
      .dc-overall-summary {
        border: 1px solid var(--color-border-muted, rgba(31, 35, 40, 0.12));
        border-left: 4px solid var(--color-accent-emphasis, #0969da);
        border-radius: 6px;
        background: var(--color-canvas-subtle, #f6f8fa);
        padding: 12px;
        display: grid;
        gap: 8px;
      }
      .dc-summary-header {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      .dc-summary-title {
        font-weight: 600;
        color: var(--color-fg-default, #24292f);
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .dc-summary-meta {
        font-size: 12px;
        color: var(--color-fg-subtle, #57606a);
      }
      .dc-summary-body {
        font-size: 13px;
        line-height: 1.6;
        color: var(--color-fg-default, #24292f);
      }
      .dc-summary-notes {
        font-size: 12px;
        color: var(--color-fg-muted, #656d76);
        border-top: 1px solid var(--color-border-muted, rgba(31, 35, 40, 0.12));
        padding-top: 6px;
      }
      .dc-summary-error {
        font-size: 13px;
        color: var(--color-danger-fg, #cf222e);
      }
      .dc-timeline-entry {
        position: relative;
        padding-left: 12px;
      }
      .dc-timeline-entry::before {
        content: '';
        position: absolute;
        left: -20px;
        top: 6px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--color-accent-fg, #0969da);
        box-shadow: 0 0 0 2px var(--color-canvas-default, #ffffff);
      }
      .dc-timeline-entry--expanded::before {
        background: var(--color-attention-emphasis, #bf8700);
      }
      .dc-timeline-entry--expanded .dc-timeline-body {
        border-color: var(--color-attention-muted, rgba(135, 94, 0, 0.28));
      }
      .dc-timeline-time {
        font-size: 12px;
        font-weight: 600;
        color: var(--color-fg-muted, #57606a);
        margin-bottom: 4px;
      }
      .dc-timeline-body {
        background: var(--color-canvas-subtle, #f6f8fa);
        border: 1px solid var(--color-border-muted, rgba(31, 35, 40, 0.12));
        border-radius: 6px;
        padding: 8px 12px;
        display: grid;
        gap: 6px;
      }
      .dc-entry-header {
        font-weight: 600;
        color: var(--color-fg-default, #24292f);
      }
      .dc-entry-header-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }
      .dc-step-link {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        font-size: 12px;
        border-radius: 6px;
        border: 1px solid var(--color-border-default, rgba(31, 35, 40, 0.15));
        background: var(--color-canvas-default, #ffffff);
        text-decoration: none;
        color: var(--color-accent-fg, #0969da);
        font-weight: 500;
      }
      .dc-step-link:hover {
        background: var(--color-neutral-muted, #d0d7de);
      }
      .dc-entry-links {
        display: flex;
        gap: 12px;
        font-size: 12px;
        flex-wrap: wrap;
      }
      .dc-entry-links a {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--color-accent-fg, #0969da);
        text-decoration: none;
      }
      .dc-entry-links a:hover {
        text-decoration: underline;
      }
      .dc-entry-links--detail {
        gap: 8px;
      }
      .dc-ai-summary-inline {
        background: var(--color-attention-subtle,rgb(225, 234, 250));
        border: 1px solid var(--color-attention-muted, rgba(135, 94, 0, 0.07));
        border-radius: 6px;
        padding: 8px;
        display: grid;
        gap: 4px;
        font-size: 12px;
        color: var(--color-fg-default, #24292f);
      }
      .dc-ai-summary-inline--empty {
        background: var(--color-canvas-subtle,rgb(223, 232, 241));
        border-color: var(--color-border-muted, rgba(31, 35, 40, 0.04));
        color: var(--color-fg-subtle, #57606a);
        font-style: italic;
      }
      .dc-ai-summary-inline-title {
        font-weight: 600;
        font-size: 12px;
        color: var(--color-fg-default, #24292f);
      }
      .dc-ai-summary-inline-body {
        font-size: 13px;
        line-height: 1.5;
      }
      .dc-entry-snippet {
        margin: 0;
        font-size: 12px;
        padding: 8px;
        background: var(--color-canvas-default, #ffffff);
        border: 1px solid var(--color-border-muted, rgba(31, 35, 40, 0.12));
        border-radius: 6px;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 240px;
        overflow: auto;
      }
      .dc-entry-snippet--empty {
        font-style: italic;
        color: var(--color-fg-subtle, #57606a);
      }
      .dc-link-icon {
        font-size: 14px;
        line-height: 1;
      }
      .dc-entry-links a.dc-link--loading {
        opacity: 0.6;
        pointer-events: none;
      }
      .dc-entry-actions {
        display: flex;
        justify-content: flex-end;
      }
      .dc-entry-toggle {
        border: none;
        background: none;
        color: var(--color-accent-fg, #0969da);
        font-size: 12px;
        cursor: pointer;
        padding: 0;
      }
      .dc-entry-toggle:hover {
        text-decoration: underline;
      }
      .dc-entry-details {
        margin-top: 8px;
        padding-top: 8px;
        border-top: 1px solid var(--color-border-muted, rgba(31, 35, 40, 0.12));
        display: grid;
        gap: 8px;
      }
      .dc-entry-details[hidden] {
        display: none;
      }
      .dc-ai-summary-detail {
        background: var(--color-attention-subtle, #fff5b1);
        border: 1px solid var(--color-attention-muted, rgba(135, 94, 0, 0.4));
        border-radius: 6px;
        padding: 8px;
        display: grid;
        gap: 4px;
      }
      .dc-ai-summary-details {
        font-size: 12px;
        color: var(--color-fg-muted, #656d76);
      }
      .dc-entry-metadata {
        font-size: 11px;
        color: var(--color-fg-subtle, #57606a);
      }
      .dc-timeline-empty {
        font-size: 12px;
        color: var(--color-fg-subtle, #57606a);
      }
    `;

    document.head.appendChild(style);
    this.stylesInjected = true;
  }

  registerProgressListener() {
    if (this.progressListenerRegistered || !chrome?.runtime?.onMessage) {
      return;
    }

    const ensurePort = () => {
      try {
        if (this.progressPort) {
          return;
        }
        const port = chrome.runtime.connect({ name: 'failureReportProgress' });
        this.progressPort = port;
        this.progressPort.onDisconnect.addListener(() => {
          this.progressPort = null;
          console.debug('[GitHub Actions Extension] Progress port disconnected');
        });
        this.progressPort.onMessage.addListener((message) => {
          if (!message || message.action !== 'failureReportProgress') {
            return;
          }
          console.debug('[GitHub Actions Extension] Progress event received via port', message);
          this.handleFailureReportProgress(message);
        });
        console.debug('[GitHub Actions Extension] Progress port established');
      } catch (error) {
        console.warn('[GitHub Actions Extension] Failed to open progress port:', error);
      }
    };

    ensurePort();

    const handler = (message) => {
      if (!message || message.action !== 'failureReportProgress') {
        return;
      }
      console.debug('[GitHub Actions Extension] Progress event received', message);
      this.handleFailureReportProgress(message);
    };

    chrome.runtime.onMessage.addListener(handler);

    this.progressListenerRegistered = true;
  }

  handleFailureReportProgress(message) {
    if (!message) {
      return;
    }

    const { runId, payload, timestamp } = message;
    if (!runId || !payload) {
      return;
    }

    // 更新最后接收时间戳
    if (timestamp) {
      this.lastProgressTimestamp.set(runId, timestamp);
    }

    const type = payload.type || 'status';
    const label = payload.label || payload.meta?.label || payload.meta?.name || null;
    let stateUpdate;

    if (type === 'phaseError' || type === 'error') {
      stateUpdate = {
        status: 'error',
        message: payload.error || label || 'Failed to generate failure report',
        error: payload.error || label || 'Unknown error',
        progress: payload
      };
    } else if (type === 'complete') {
      const summary = payload.reportSummary || {};
      const contextCount = typeof summary.errorContextCount === 'number' ? summary.errorContextCount : null;
      const summaryMessage =
        label ||
        (contextCount != null
          ? `Failure report ready (${contextCount} error contexts)`
          : 'Failure report available');
      stateUpdate = {
        status: 'ready',
        message: summaryMessage,
        progress: payload
      };
    } else {
      stateUpdate = {
        status: 'loading',
        message: label || 'Analyzing failure report...',
        progress: payload
      };
    }

    this.setRunState(runId, stateUpdate);

    let item = this.workflowData.get(runId);
    if (!item || !document.contains(item)) {
      const refreshed = this.findWorkflowItemByRunId(runId);
      if (refreshed) {
        this.workflowData.set(runId, refreshed);
        item = refreshed;
      } else {
        item = null;
      }
    }
    const report = this.stateManager ? this.stateManager.getFailureReport(runId) : null;
    if (item) {
      this.renderRunActions(item, runId, report);
    }
  }

  /**
   * 启动进度轮询（从 chrome.storage 读取备份消息）
   */
  startProgressPolling() {
    if (this.progressPollInterval) {
      return;
    }

    // 每 3 秒轮询一次 storage 中的进度消息
    this.progressPollInterval = setInterval(() => {
      this.pollProgressFromStorage().catch(err => {
        console.warn('[GitHub Actions Extension] Progress polling error:', err);
      });
    }, 3000);

    // 立即轮询一次
    this.pollProgressFromStorage().catch(err => {
      console.warn('[GitHub Actions Extension] Initial progress polling error:', err);
    });
  }

  /**
   * 停止进度轮询
   */
  stopProgressPolling() {
    if (this.progressPollInterval) {
      clearInterval(this.progressPollInterval);
      this.progressPollInterval = null;
    }
  }

  /**
   * 启动定期 UI 存在性检查
   */
  startUIPresenceCheck() {
    if (this.uiPresenceCheckInterval) {
      return;
    }

    console.log('[UI-DEBUG] Starting UI presence check (every 5s)...');
    
    this.uiPresenceCheckInterval = setInterval(() => {
      this.checkUIPresence();
    }, 5000); // 每 5 秒检查一次
  }

  /**
   * 停止 UI 存在性检查
   */
  stopUIPresenceCheck() {
    if (this.uiPresenceCheckInterval) {
      clearInterval(this.uiPresenceCheckInterval);
      this.uiPresenceCheckInterval = null;
      console.log('[UI-DEBUG] Stopped UI presence check');
    }
  }

  /**
   * 检查 UI 元素是否存在
   */
  checkUIPresence() {
    const storedRunIds = Array.from(this.workflowData.keys());
    
    if (storedRunIds.length === 0) {
      return; // 没有存储的 runId，跳过检查
    }

    let missingCount = 0;
    let invalidRefCount = 0;
    let recoveredCount = 0;

    storedRunIds.forEach(runId => {
      const storedItem = this.workflowData.get(runId);
      
      // 检查存储的元素引用是否有效
      if (!storedItem) {
        invalidRefCount++;
        console.warn('[UI-DEBUG] ⚠️ No stored item for runId:', runId);
        // 尝试重新查找元素
        const newItem = this.findWorkflowItemByRunId(runId);
        if (newItem) {
          console.log('[UI-DEBUG] ✓ Recovered item for runId:', runId);
          this.workflowData.set(runId, newItem);
          recoveredCount++;
          // 继续检查 UI 控件
        } else {
          return; // 找不到元素，跳过
        }
      }

      const itemToCheck = this.workflowData.get(runId);
      if (!document.contains(itemToCheck)) {
        invalidRefCount++;
        console.warn('[UI-DEBUG] ⚠️ Stored item not in DOM for runId:', runId, {
          storedItemTagName: itemToCheck.tagName,
          storedItemClassName: itemToCheck.className
        });
        
        // 尝试重新查找元素
        const newItem = this.findWorkflowItemByRunId(runId);
        if (newItem && document.contains(newItem)) {
          console.log('[UI-DEBUG] ✓ Found new item in DOM for runId:', runId);
          this.workflowData.set(runId, newItem);
          recoveredCount++;
          // 更新 itemToCheck 为新的元素
          const updatedItem = newItem;
          
          // 检查 UI 控件是否存在
          const searchRoot = updatedItem.matches('a') && updatedItem.parentElement ? updatedItem.parentElement : updatedItem;
          const existingControls = searchRoot.querySelector(`.dc-run-controls[data-run-id="${runId}"]`);
          
          if (!existingControls) {
            missingCount++;
            console.warn('[UI-DEBUG] ⚠️ UI controls missing for runId (after recovery):', runId);
            
            // 尝试重新渲染
            this.loadStoredData().then(({ namespaces, reports }) => {
              const report = reports[runId] || null;
              console.log('[UI-DEBUG] Attempting to re-render UI for runId:', runId);
              this.renderRunActions(updatedItem, runId, report);
            });
          }
        } else {
          console.warn('[UI-DEBUG] ⚠️ Cannot find new item for runId:', runId);
        }
        return;
      }

      // 检查 UI 控件是否存在
      const searchRoot = itemToCheck.matches('a') && itemToCheck.parentElement ? itemToCheck.parentElement : itemToCheck;
      const existingControls = searchRoot.querySelector(`.dc-run-controls[data-run-id="${runId}"]`);
      
      if (!existingControls) {
        missingCount++;
        console.warn('[UI-DEBUG] ⚠️ UI controls missing for runId:', runId, {
          storedItemInDOM: document.contains(itemToCheck),
          searchRootInDOM: document.contains(searchRoot)
        });
        
        // 尝试重新渲染
        this.loadStoredData().then(({ namespaces, reports }) => {
          const report = reports[runId] || null;
          console.log('[UI-DEBUG] Attempting to re-render UI for runId:', runId);
          this.renderRunActions(itemToCheck, runId, report);
        });
      }
    });

    if (missingCount > 0 || invalidRefCount > 0) {
      console.warn('[UI-DEBUG] ⚠️ UI presence check found issues', {
        missingControls: missingCount,
        invalidReferences: invalidRefCount,
        recoveredItems: recoveredCount,
        totalChecked: storedRunIds.length,
        timestamp: new Date().toISOString()
      });
    } else {
      console.debug('[UI-DEBUG] ✓ UI presence check passed', {
        checkedRunIds: storedRunIds.length,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 从 chrome.storage 轮询进度消息
   */
  async pollProgressFromStorage() {
    // 获取所有正在加载的 runId
    const activeRunIds = Array.from(this.runStates.keys()).filter(runId => {
      const state = this.runStates.get(runId);
      return state && state.status === 'loading';
    });

    if (activeRunIds.length === 0) {
      return;
    }

    // 检查每个 runId 的进度消息
    for (const runId of activeRunIds) {
      try {
        const key = `progress_${runId}`;
        const result = await chrome.storage.local.get(key);
        const progressList = result[key] || [];

        if (progressList.length === 0) {
          continue;
        }

        // 获取最后已知的时间戳
        const lastTimestamp = this.lastProgressTimestamp.get(runId) || 0;

        // 处理新的消息
        for (const item of progressList) {
          const itemTimestamp = item.timestamp || 0;
          if (itemTimestamp > lastTimestamp) {
            // 这是一个新消息，处理它
            this.handleFailureReportProgress({
              action: 'failureReportProgress',
              runId,
              payload: item.payload,
              timestamp: itemTimestamp
            });
          }
        }

        // 更新最后时间戳
        if (progressList.length > 0) {
          const latest = progressList[progressList.length - 1];
          const latestTimestamp = latest.timestamp || 0;
          if (latestTimestamp > lastTimestamp) {
            this.lastProgressTimestamp.set(runId, latestTimestamp);
          }
        }
      } catch (error) {
        console.warn(`[GitHub Actions Extension] Failed to poll progress for runId ${runId}:`, error);
      }
    }
  }
}

// Fallback implementation if modules fail to load
async function initFallback() {
  // Check if extension is enabled before initializing fallback
  const result = await chrome.storage.local.get(['extensionEnabled']);
  const isEnabled = result.extensionEnabled !== false;
  
  if (!isEnabled) {
    console.log('[GitHub Actions Extension] Extension is disabled, skipping fallback initialization');
    return;
  }
  
  console.warn('Using fallback implementation');
  // Simple fallback that still tries to extract namespace
  extensionInstance = new GitHubActionsExtension(null, null, null);
  await extensionInstance.init();
}

