import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { TestInfo } from "@playwright/test";
import type { PlaywrightRunResult } from "../../src/playwright-wrapper/contract/resultSchema";

const repo = process.cwd();

/** Isolated cwd: child runs cannot overwrite the parent suite's reports/specs. */
export function wrapperFixture(info: TestInfo) {
  const cwd = info.outputPath("fixture");
  fs.mkdirSync(path.join(cwd, "tests", "smoke"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "node_modules", "playwright"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "node_modules", "playwright", "cli.js"),
    `require(${JSON.stringify(path.join(repo, "node_modules", "playwright", "cli.js"))});`);
  // Use the repository's actual config, resolving only its import from this cwd.
  const config = fs.readFileSync(path.join(repo, "playwright.config.ts"), "utf8")
    .replace('"@playwright/test"', JSON.stringify(require.resolve("@playwright/test")));
  fs.writeFileSync(path.join(cwd, "playwright.config.ts"), config);
  function spec(name: string, body: string) {
    fs.writeFileSync(path.join(cwd, "tests", "smoke", name),
      `const { test, expect } = require(${JSON.stringify(require.resolve("@playwright/test"))});\n${body}`);
  }
  spec("example.spec.ts", 'test("passes", () => { expect(1).toBe(1); });');
  function run(args: string[]) {
    return spawnSync(process.execPath, [
      path.join(repo, "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(repo, "src", "playwright-wrapper", "execution", "runPlaywrightTargetCli.ts"),
      ...args,
    ], { cwd, encoding: "utf8", shell: false, env: process.env });
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
  return { cwd, spec, run, request, report };
}
