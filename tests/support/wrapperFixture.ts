import fs from "node:fs";
import path from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import type { TestInfo } from "@playwright/test";
import type { PlaywrightRunResult } from "../../src/playwright-wrapper/contract/resultSchema";

const repo = process.cwd();

/** Isolated cwd: child runs cannot overwrite the parent suite's reports/specs. */
export function wrapperFixture(info: TestInfo) {
  const cwd = info.outputPath("fixture");
  fs.mkdirSync(path.join(cwd, "tests", "smoke"), { recursive: true });
  // Test-only package adapters: no symlink privilege or full install per fixture.
  // Native execution resolves the actual installed packages; reports/config stay isolated.
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  for (const name of [...Object.keys(pkg.devDependencies), "playwright", "playwright-core"]) {
    fs.mkdirSync(path.join(cwd, "node_modules", name), { recursive: true });
    fs.copyFileSync(path.join(repo, "node_modules", name, "package.json"), path.join(cwd, "node_modules", name, "package.json"));
  }
  fs.writeFileSync(path.join(cwd, "node_modules", "playwright", "cli.js"),
    `require(${JSON.stringify(path.join(repo, "node_modules", "playwright", "cli.js"))});`);
  fs.writeFileSync(path.join(cwd, "node_modules", "playwright", "index.js"),
    `module.exports = require(${JSON.stringify(path.join(repo, "node_modules", "playwright"))});`);
  for (const file of ["tsx/dist/cli.mjs", "typescript/bin/tsc"]) {
    fs.mkdirSync(path.dirname(path.join(cwd, "node_modules", file)), { recursive: true });
    fs.copyFileSync(path.join(repo, "node_modules", file), path.join(cwd, "node_modules", file));
  }
  for (const file of ["package.json", "package-lock.json"]) fs.copyFileSync(path.join(repo, file), path.join(cwd, file));
  // Use the repository's actual config, resolving only its import from this cwd.
  const config = fs.readFileSync(path.join(repo, "playwright.config.ts"), "utf8")
    .replace('"@playwright/test"', JSON.stringify(require.resolve("@playwright/test")));
  fs.writeFileSync(path.join(cwd, "playwright.config.ts"), config);
  function spec(name: string, body: string) {
    fs.writeFileSync(path.join(cwd, "tests", "smoke", name),
      `const { test, expect } = require(${JSON.stringify(require.resolve("@playwright/test"))});\n${body}`);
  }
  spec("example.spec.ts", 'test("passes", () => { expect(1).toBe(1); });');
  const wrapperArgs = [
    path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"),
    path.join(repo, "src", "playwright-wrapper", "execution", "runPlaywrightTargetCli.ts"),
  ];
  function run(args: string[], env: NodeJS.ProcessEnv = process.env) {
    return spawnSync(process.execPath, [...wrapperArgs, ...args], { cwd, encoding: "utf8", shell: false, env });
  }
  async function concurrentRequest(specPath: string) {
    const args = [...wrapperArgs, "--project", "smoke", "--spec", specPath, "--workers", "1"];
    try {
      const child = await promisify(execFile)(process.execPath, args, { cwd, encoding: "utf8", windowsHide: true });
      return { exit: 0, result: JSON.parse(child.stdout) as PlaywrightRunResult };
    } catch (error) {
      const child = error as { code?: number; stdout?: string };
      if (child.code !== 1 || !child.stdout) throw error;
      return { exit: 1, result: JSON.parse(child.stdout) as PlaywrightRunResult };
    }
  }
  function request(specPath: string, extra: string[] = []) {
    const child = run(["--project", "smoke", "--spec", specPath, "--workers", "1", ...extra]);
    if (child.error) throw child.error;
    if (!child.stdout.trim()) throw new Error(child.stderr);
    return { child, result: JSON.parse(child.stdout) as PlaywrightRunResult };
  }
  function report(result: PlaywrightRunResult) {
    return JSON.parse(fs.readFileSync(path.join(cwd, result.artifacts.testResultsJson!), "utf8"));
  }
  return { cwd, spec, run, request, report, concurrentRequest };
}
