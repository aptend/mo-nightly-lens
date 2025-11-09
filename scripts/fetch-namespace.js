#!/usr/bin/env node

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith('--')) {
      const name = key.slice(2);
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[name] = value;
    }
  }
  return args;
}

async function main() {
  const { fetchNamespaceForLatestRun } = await import('../modules/namespace/fetch-latest.js');
  const args = parseArgs(process.argv);

  const options = {
    repo: args.repo,
    workflow: args.workflow
  };

  try {
    const result = await fetchNamespaceForLatestRun(options);

    console.log('✅ Namespace extraction succeeded');
    console.log('');
    console.log('Run:');
    console.log(`  ID: ${result.run.id}`);
    console.log(`  Workflow: ${options.workflow || result.run.name || '(unknown)'}`);
    console.log(`  Name: ${result.run.name || '(unknown)'}`);
    console.log(`  Status: ${result.run.status}`);
    console.log(`  Conclusion: ${result.run.conclusion}`);
    if (result.run.htmlUrl) {
      console.log(`  URL: ${result.run.htmlUrl}`);
    }

    console.log('');
    console.log('Job:');
    console.log(`  ID: ${result.job.id}`);
    console.log(`  Name: ${result.job.name}`);
    console.log(`  Status: ${result.job.status}`);
    console.log(`  Conclusion: ${result.job.conclusion}`);

    console.log('');
    console.log('Step:');
    console.log(`  Number: ${result.step.number}`);
    console.log(`  Name: ${result.step.name}`);
    console.log(`  Status: ${result.step.status}`);
    console.log(`  Conclusion: ${result.step.conclusion}`);

    console.log('');
    if (result.namespace) {
      console.log(`Namespace: ${result.namespace}`);
    } else {
      console.log('Namespace: (not found in log)');
    }
    if (result.grafanaUrl) {
      console.log(`Grafana: ${result.grafanaUrl}`);
    }
  } catch (error) {
    console.error('❌ Namespace extraction failed');
    console.error(error.message);
    process.exit(1);
  }
}

main();

