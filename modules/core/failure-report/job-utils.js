function isFailure(conclusion) {
  return (conclusion || '').toLowerCase() === 'failure';
}

export function filterFailingJobs(jobs = []) {
  return jobs.filter((job) => isFailure(job.conclusion));
}

export function filterFailingSteps(steps = []) {
  return steps.filter((step) => isFailure(step.conclusion));
}


