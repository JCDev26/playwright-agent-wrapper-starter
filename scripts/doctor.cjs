#!/usr/bin/env node
// Deliberately uses only Node built-ins: this must work before npm dependencies do.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runDoctor({ cwd = process.cwd(), profile = 'smoke', headed = false } = {}, deps = {}) {
  const checks = [];
  const check = (name, category, detail, action) => {
    try { action(); checks.push({ name, category, status: 'passed', detail }); return true; }
    catch (error) {
      checks.push({ name, category: error.category ?? category, status: 'failed', detail: error.message });
      return false;
    }
  };
  const finish = () => ({ schemaVersion: 1, status: checks.some(c => c.status === 'failed') ? 'blocked' : 'ready',
    profile, checkedAt: new Date().toISOString(), checks,
    limits: 'Local prerequisite observations only. No tests or app/config validation performed; no network, install, repair, or approval. Readiness can change after this check.' });
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  if (!check('profile', 'configuration', `Selected ${profile} prerequisites.`, () => {
    assert(['unit', 'smoke', 'mobile-android', 'mobile-ios', 'performance', 'security', 'all-browsers'].includes(profile), 'Unknown prerequisite profile.');
  })) return finish();
  if (!check('node', 'environment', `Node ${deps.nodeVersion ?? process.versions.node}.`, () => {
    const [major, minor] = (deps.nodeVersion ?? process.versions.node).split('.').map(Number);
    assert(major > 22 || (major === 22 && minor >= 12), 'Node >=22.12.0 is required. Select a supported Node version.');
  })) return finish();
  let pkg, lock;
  if (!check('manifest', 'configuration', 'Package manifest and lockfile agree on direct dependencies.', () => {
    pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    lock = JSON.parse(fs.readFileSync(path.join(cwd, 'package-lock.json'), 'utf8'));
    assert(pkg.engines?.node === '>=22.12.0', 'Doctor Node policy and package engines differ; review doctor before running.');
    assert(Object.keys(pkg.devDependencies ?? {}).length > 0, 'No declared development dependencies.');
    assert(JSON.stringify(Object.entries(pkg.devDependencies).sort()) ===
      JSON.stringify(Object.entries(lock.packages?.['']?.devDependencies ?? {}).sort()),
    'Manifest and lockfile differ. Review dependency changes, then regenerate the lockfile.');
  })) return finish();
  if (!check('dependencies', 'dependency', 'Direct dependencies and Playwright runtime match the lockfile.', () => {
    for (const name of [...Object.keys(pkg.devDependencies), 'playwright', 'playwright-core']) {
      const installedPath = path.join(cwd, 'node_modules', name, 'package.json');
      assert(fs.existsSync(installedPath), `Missing ${name}. Run npm ci after reviewing the lockfile.`);
      const installed = JSON.parse(fs.readFileSync(installedPath, 'utf8'));
      assert(installed.version === lock.packages?.[`node_modules/${name}`]?.version,
        `${name} does not match the lockfile. Run npm ci after reviewing dependency changes.`);
    }
    for (const file of ['playwright/cli.js', 'tsx/dist/cli.mjs', 'typescript/bin/tsc']) {
      assert(fs.statSync(path.join(cwd, 'node_modules', file)).isFile(), `Missing ${file}. Run npm ci.`);
    }
  })) return finish();
  if (!check('config-file', 'configuration', 'playwright.config.ts is present (not evaluated).', () => {
    assert(fs.statSync(path.join(cwd, 'playwright.config.ts')).isFile(), 'playwright.config.ts must be a file.');
  })) return finish();
  if (!check('artifact-write', 'environment', 'Temporary artifact write/read/remove probe succeeded.', () => {
    const root = path.join(cwd, 'artifacts');
    fs.mkdirSync(root, { recursive: true });
    const probe = fs.mkdtempSync(path.join(root, '.doctor-'));
    try {
      fs.writeFileSync(path.join(probe, 'probe'), 'doctor', { flag: 'wx' });
      assert(fs.readFileSync(path.join(probe, 'probe'), 'utf8') === 'doctor', 'Artifact readback failed.');
    } finally { fs.rmSync(probe, { recursive: true }); }
  })) return finish();
  if (profile === 'unit') {
    checks.push({ name: 'chromium-launch', category: 'capability', status: 'not-checked', detail: 'Unit profile does not require or certify a browser.' });
    return finish();
  }
  const engines = profile === 'all-browsers' ? ['chromium', 'webkit']
    : [profile === 'mobile-ios' ? 'webkit' : 'chromium'];
  for (const engine of engines) {
    check(`${engine}-launch`, 'capability', `Installed ${engine} launched and closed (${headed ? 'headed' : 'headless'}).`, () => {
      // No app URLs or external services. A bounded child catches missing binaries and OS launch errors.
      const script = `const { ${engine}: browserType } = require(${JSON.stringify(path.join(cwd, 'node_modules', 'playwright'))});
        (async () => {
          let browser; try { browser = await browserType.launch({ headless: ${!headed}, timeout: 10000 }); }
          finally { if (browser) await browser.close(); }
        })().catch(error => { const missing = /Executable doesn't exist/.test(error.message);
          console.log(JSON.stringify({kind:missing ? 'dependency' : 'environment',
            detail:missing ? 'Compatible ${engine} is missing. Install with: npx playwright install ${engine}' : error.message})); process.exitCode = 2; });`;
      const result = (deps.spawnSync ?? spawnSync)(process.execPath, ['-e', script], {
        cwd, shell: false, windowsHide: true, encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024,
        env: process.env,
      });
      if (result.error || result.status !== 0) {
        let reason;
        try { reason = JSON.parse(result.stdout.trim()); } catch { /* preserve uncertainty */ }
        const category = reason?.kind === 'dependency' ? 'dependency' : 'environment';
        const message = reason?.detail ?? result.error?.message ?? `${engine} probe did not complete. Check local browser/OS permissions and dependencies.`;
        const error = new Error(`${category}: ${message}`);
        error.category = category;
        throw error;
      }
    });
  }
  return finish();
}

module.exports = { runDoctor };
if (require.main === module) {
  const args = process.argv.slice(2);
  const valid = args.length === 0 || (args.length === 2 && args[0] === '--profile');
  const result = runDoctor({ profile: valid ? (args[1] ?? 'smoke') : 'invalid' });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.status === 'ready' ? 0 : 2;
}
