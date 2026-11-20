// Dependency-free bootstrap: a missing TS runner should be a local setup diagnostic.
const { runDoctor } = require('./doctor.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const health = runDoctor({ profile: 'unit' });
if (health.status !== 'ready') {
  process.stderr.write(JSON.stringify(health, null, 2) + '\n');
  process.exitCode = 2;
} else {
  const child = spawnSync(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'),
    path.resolve('src/playwright-wrapper/execution/runPlaywrightTargetCli.ts'), ...process.argv.slice(2)],
  { stdio: 'inherit', shell: false, windowsHide: true });
  if (child.error) process.stderr.write(child.error.message + '\n');
  process.exitCode = child.error || child.status === null ? 2 : child.status;
}
