import { buildGrafanaUrl, NamespaceExtractor } from '../namespace/index.js';

const NAMESPACE_JOB_KEYWORDS = ['setup mo test env'];
const NAMESPACE_STEP_KEYWORDS = ['clean tke env'];

function normalize(value) {
  return (value || '').trim().toLowerCase();
}

function matchesAnyKeyword(text, keywords) {
  const normalized = normalize(text);
  return keywords.some((keyword) => normalized.includes(keyword));
}

let cachedNamespaceExtractor = null;
function getNamespaceExtractor() {
  if (!cachedNamespaceExtractor) {
    cachedNamespaceExtractor = new NamespaceExtractor();
  }
  return cachedNamespaceExtractor;
}

export async function resolveNamespace({
  jobs,
  fetchJobDetails,
  getStepLog
}) {
  if (!Array.isArray(jobs) || jobs.length === 0) {
    return null;
  }

  const targetJob = jobs.find((job) => matchesAnyKeyword(job.name, NAMESPACE_JOB_KEYWORDS));
  if (!targetJob) {
    return null;
  }

  const jobDetails = await fetchJobDetails(targetJob.id);
  const targetStep = (jobDetails.steps || []).find((step) =>
    matchesAnyKeyword(step.name, NAMESPACE_STEP_KEYWORDS)
  );

  if (!targetStep) {
    return null;
  }

  const stepResult = await getStepLog(targetJob.id, targetStep.number);
  const extractor = getNamespaceExtractor();
  const namespace = extractor.extract(stepResult.log);

  return {
    namespace: namespace || null,
    logUrl: stepResult.logUrl || null,
    grafanaUrl: namespace ? buildGrafanaUrl(namespace) : null
  };
}


