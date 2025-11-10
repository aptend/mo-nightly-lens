// Content script for GitHub Actions pages
// This script runs on GitHub Actions pages and extracts workflow information

// Load modules and initialize extension
console.log('[GitHub Actions Extension] Content script loaded');

async function bootstrapRuntime() {
  const runtimeModule = await import(chrome.runtime.getURL('modules/adapters/browser/runtime/index.js'));
  const namespaceModule = await import(chrome.runtime.getURL('modules/namespace/index.js'));
  const progressModule = await import(
    chrome.runtime.getURL('modules/core/runtime/progress-channel.js')
  );
  const stylesModule = await import(chrome.runtime.getURL('modules/adapters/browser/ui/styles.js'));
  const controlsModule = await import(
    chrome.runtime.getURL('modules/adapters/browser/ui/run-controls.js')
  );
  const timelineModule = await import(
    chrome.runtime.getURL('modules/adapters/browser/ui/failure-timeline.js')
  );

  let issueModule = null;
  try {
    issueModule = await import(
      chrome.runtime.getURL('modules/adapters/browser/issues/context-issue-builder.js')
    );
  } catch (error) {
    console.warn('[GitHub Actions Extension] Issue builder module unavailable', error);
  }

  const { createBrowserRuntime } = runtimeModule;

  const runtime = createBrowserRuntime({
    NamespaceExtractor: namespaceModule?.NamespaceExtractor,
    UIRenderer: namespaceModule?.UIRenderer,
    progressModule,
    issueModule,
    timelineModule,
    stylesModule,
    controlsModule
  });

  await runtime.init();

  return runtime;
}

(async () => {
  try {
    await bootstrapRuntime();
  } catch (error) {
    console.error('[GitHub Actions Extension] Failed to initialize runtime', error);
  }
})();

