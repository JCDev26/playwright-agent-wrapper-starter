import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runDoctor } from "../../scripts/doctor.cjs";
import { runPlaywrightTarget } from "../../src/playwright-wrapper/execution/runPlaywrightTarget";
import { wrapperFixture } from "../support/wrapperFixture";
const testProfile = require("../../scripts/test-profile.cjs") as (args: string[]) => "unit" | "smoke";

function fixture(root: string) {
  fs.mkdirSync(root, { recursive: true });
  const pkg = { engines: { node: ">=22.12.0" }, devDependencies: { "@playwright/test": "1.59.1", tsx: "4.0.0", typescript: "5.0.0" } };
  const versions = { ...pkg.devDependencies, playwright: "1.59.1", "playwright-core": "1.59.1" };
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(pkg));
  fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: {
    "": pkg, ...Object.fromEntries(Object.entries(versions).map(([name, version]) => [`node_modules/${name}`, { version }])),
  } }));
  for (const [name, version] of Object.entries(versions)) {
    fs.mkdirSync(path.join(root, "node_modules", name), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", name, "package.json"), JSON.stringify({ version }));
  }
  for (const file of ["playwright/cli.js", "tsx/dist/cli.mjs", "typescript/bin/tsc"]) {
    const target = path.join(root, "node_modules", file);
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, "");
  }
  fs.writeFileSync(path.join(root, "playwright.config.ts"), "");
  return root;
}

test("unsupported Node stops before dependency or browser work", ({}, info) => {
  const result = runDoctor({ cwd: info.outputPath("absent") }, { nodeVersion: "20.19.0", spawnSync: () => { throw new Error("must not launch"); } });
  expect(result.status).toBe("blocked");
  expect(result.checks.at(-1)).toMatchObject({ name: "node", category: "environment", status: "failed" });
});

test("standalone doctor works without installed dependencies and returns exit 2 JSON", ({}, info) => {
  const cwd = fixture(info.outputPath("fixture"));
  fs.rmSync(path.join(cwd, "node_modules"), { recursive: true });
  const child = spawnSync(process.execPath, [path.resolve("scripts/doctor.cjs")], { cwd, encoding: "utf8" });
  expect(child.status).toBe(2);
  expect(JSON.parse(child.stdout).checks.at(-1)).toMatchObject({ name: "dependencies", category: "dependency", status: "failed" });
});

for (const mode of ["lock", "version", "config", "artifacts"] as const) {
  test(`classifies ${mode} problem and does not start browser`, ({}, info) => {
    const cwd = fixture(info.outputPath("fixture"));
    if (mode === "lock") fs.writeFileSync(path.join(cwd, "package-lock.json"), "{}");
    if (mode === "version") fs.writeFileSync(path.join(cwd, "node_modules/playwright/package.json"), '{"version":"0.0.0"}');
    if (mode === "config") fs.unlinkSync(path.join(cwd, "playwright.config.ts"));
    if (mode === "artifacts") fs.writeFileSync(path.join(cwd, "artifacts"), "not a directory");
    const result = runDoctor({ cwd }, { spawnSync: () => { throw new Error("must not launch"); } });
    expect(result.status).toBe("blocked");
    expect(result.checks.at(-1)?.category).toBe(mode === "version" ? "dependency" : mode === "artifacts" ? "environment" : "configuration");
  });
}

test("unit profile makes browser non-coverage explicit and cleans its own probe", ({}, info) => {
  const cwd = fixture(info.outputPath("fixture"));
  const result = runDoctor({ cwd, profile: "unit" }, { spawnSync: () => { throw new Error("must not launch"); } });
  expect(result.status).toBe("ready");
  expect(result.checks.at(-1)?.status).toBe("not-checked");
  expect(fs.readdirSync(path.join(cwd, "artifacts"))).toEqual([]);
});

for (const kind of ["dependency", "environment"] as const) {
  test(`browser probe preserves ${kind} classification`, ({}, info) => {
    const result = runDoctor({ cwd: fixture(info.outputPath("fixture")) }, {
      spawnSync: () => ({ status: 2, stdout: JSON.stringify({ kind, detail: "native reason" }) }),
    });
    expect(result.status).toBe("blocked");
    expect(result.checks.at(-1)).toMatchObject({ name: "chromium-launch", category: kind, status: "failed" });
  });
}

test("unknown/timed-out launch is blocked, never a product failure", ({}, info) => {
  const result = runDoctor({ cwd: fixture(info.outputPath("fixture")) }, {
    spawnSync: () => ({ status: null, error: new Error("ETIMEDOUT") }),
  });
  expect(result.status).toBe("blocked");
  expect(result.checks.at(-1)).toMatchObject({ category: "environment", detail: "environment: ETIMEDOUT" });
});

test("wrapper fails preflight without launching target or advertising old artifacts", () => {
  let launched = false;
  const health = runDoctor({}, { nodeVersion: "20.0.0" });
  const result = runPlaywrightTarget({ project: "smoke" }, { doctor: () => health,
    spawnSync: () => { launched = true; return { status: 0 }; } });
  expect(launched).toBe(false);
  expect(result).toMatchObject({ ok: false, status: "execution_error", command: null, exitCode: null,
    error: { code: "PREFLIGHT_FAILED" }, preflight: { status: "blocked" },
    artifacts: { htmlReport: null, testResultsJson: null, testResultsXml: null, traceFiles: [] } });
});

test("invalid request is rejected before doctor", () => {
  const result = runPlaywrightTarget({ project: "not-allowed" }, { doctor: () => { throw new Error("must not run"); } });
  expect(result.status).toBe("validation_error");
  expect(result.preflight).toBeUndefined();
});

test("doctor exception is an honest preflight error", () => {
  const result = runPlaywrightTarget({ project: "smoke" }, { doctor: () => { throw new Error("probe crashed"); } });
  expect(result).toMatchObject({ status: "execution_error", error: { code: "PREFLIGHT_FAILED" } });
});

test("unit selection stays browser-free with ordinary runner flags", () => {
  expect(testProfile(["--project=unit", "--grep", "doctor", "--workers=1"])).toBe("unit");
  expect(testProfile(["--project", "unit", "--reporter=line"])).toBe("unit");
  expect(testProfile([])).toBe("smoke");
  expect(testProfile(["--project=unit", "--project=smoke"])).toBe("smoke");
  expect(testProfile(["--project=u*"])).toBe("smoke");
});

test("dependency-free wrapper bootstrap has clean stdout when setup is blocked", ({}, info) => {
  const cwd = fixture(info.outputPath("fixture"));
  fs.rmSync(path.join(cwd, "node_modules"), { recursive: true });
  const child = spawnSync(process.execPath, [path.resolve("scripts/wrapper.cjs"), "--project", "smoke"], { cwd, encoding: "utf8" });
  expect(child.status).toBe(2);
  expect(child.stdout).toBe("");
  expect(JSON.parse(child.stderr)).toMatchObject({ status: "blocked" });
});

test("real CLI blocks missing browser before target code runs", ({}, info) => {
  const local = wrapperFixture(info);
  const marker = path.join(local.cwd, "target-executed");
  local.spec("example.spec.ts", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran'); test('must not run', () => {});`);
  const child = local.run(["--project", "smoke"], { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(local.cwd, "empty-browser-cache") });
  expect(child.status).toBe(2);
  expect(JSON.parse(child.stdout)).toMatchObject({ status: "execution_error", exitCode: null,
    error: { code: "PREFLIGHT_FAILED" }, preflight: { status: "blocked" } });
  expect(JSON.parse(child.stdout).preflight.checks.at(-1)).toMatchObject({ category: "dependency", status: "failed" });
  expect(fs.existsSync(marker)).toBe(false);
  expect(fs.readdirSync(path.join(local.cwd, "artifacts"))).toEqual([]);
});
