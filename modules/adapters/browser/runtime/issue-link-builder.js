export function createIssueLinkBuilder({ initialBuilder, modulePath }) {
  let builder = typeof initialBuilder === 'function' ? initialBuilder : null;
  let loadingPromise = null;

  async function ensureBuilderLoaded() {
    if (builder) {
      return true;
    }
    if (loadingPromise) {
      return loadingPromise;
    }
    if (!modulePath) {
      return false;
    }
    loadingPromise = (async () => {
      try {
        const moduleUrl = chrome?.runtime?.getURL
          ? chrome.runtime.getURL(modulePath)
          : modulePath;
        const module = await import(moduleUrl);
        builder = typeof module?.buildIssuePayload === 'function' ? module.buildIssuePayload : null;
        return Boolean(builder);
      } catch (error) {
        console.warn('[BrowserRuntime] Failed to load issue builder module', error);
        return false;
      } finally {
        loadingPromise = null;
      }
    })();
    return loadingPromise;
  }

  return async function buildIssueUrl(report, contextId) {
    if (!contextId) {
      return null;
    }
    if (!builder) {
      const loaded = await ensureBuilderLoaded();
      if (!loaded) {
        return null;
      }
    }
    try {
      const payload = await builder({ report, contextId });
      return payload?.issueUrl || null;
    } catch (error) {
      console.warn('[BrowserRuntime] Failed to build issue URL', error);
      return null;
    }
  };
}
