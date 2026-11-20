// Gate the test runner without npm pre-script stdout contaminating machine output.
const { runDoctor } = require('./doctor.cjs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const testProfile = require('./test-profile.cjs');
const args = process.argv.slice(2);
const profile = testProfile(args);
const result = runDoctor({ profile, headed: args.includes('--headed') });
process.stderr.write(JSON.stringify(result, null, 2) + '\n');
if (result.status === 'blocked') process.exitCode = 2;
else {
  const child = spawnSync(process.execPath, [path.resolve('node_modules/playwright/cli.js'), 'test', ...args], {
    stdio: 'inherit', shell: false, windowsHide: true,
  });
  if (child.error) process.stderr.write(child.error.message + '\n');
  process.exitCode = child.error || child.status === null ? 2 : child.status;
}
