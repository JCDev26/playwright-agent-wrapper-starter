import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { getEventListeners } from "node:events";
import { test, expect } from "@playwright/test";
import { runPlaywrightTarget } from "../../src/playwright-wrapper/execution/runPlaywrightTarget";
import type { PlaywrightRunResult, ProcessCleanup } from "../../src/playwright-wrapper/contract/resultSchema";
import { playwrightReport } from "../support/playwrightReport";
import { wrapperFixture } from "../support/wrapperFixture";
import { rememberDescendants } from "../../src/playwright-wrapper/execution/processTree";
import { toRunReport } from "../../src/reporting/playwright-run-report";

test.describe.configure({ timeout: 45_000 });

const live = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
const stopFixture = (pids: number[]) => {
  for (const pid of pids) { try { process.kill(pid, "SIGKILL"); } catch { /* Already gone. */ } }
};
const waitFor = async (predicate: () => boolean) => {
  await expect.poll(predicate, { timeout: 10_000 }).toBe(true);
};

for (const options of [
  { timeoutMs: 0 }, { timeoutMs: Infinity }, { timeoutMs: 900_001 }, { timeoutMs: 1.5 },
  { cleanupTimeoutMs: 99 }, { cleanupTimeoutMs: 10_001 },
]) {
  test("invalid operational bounds never spawn: " + JSON.stringify(options), async () => {
    let spawned = false;
    const result = await runPlaywrightTarget({ project: "smoke" }, options, {
      runProcess: async () => { spawned = true; throw new Error("must not spawn"); },
    });
    expect(spawned).toBe(false);
    expect(result).toMatchObject({ status: "execution_error", error: { code: "INVALID_RUN_OPTIONS" },
      execution: { termination: "not-started", cleanup: { status: "not-started" } } });
  });
}

test("pre-aborted calls do not launch and do not retain abort listeners", async () => {
  const controller = new AbortController();
  controller.abort();
  let launched = false;
  const result = await runPlaywrightTarget({ project: "smoke" }, { signal: controller.signal }, {
    runProcess: async () => { launched = true; throw new Error("must not spawn"); },
  });
  expect(launched).toBe(false);
  expect(result).toMatchObject({ ok: false, status: "execution_error", error: { code: "RUN_CANCELLED" },
    execution: { termination: "cancelled", pid: null } });
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});

test("the deadline covers stuck preparation without launching", async () => {
  const began = performance.now();
  const result = await runPlaywrightTarget({ project: "smoke" }, { timeoutMs: 200 }, {
    resolveCliScriptPath: () => new Promise<string>(() => {}),
  });
  expect(result).toMatchObject({ ok: false, error: { code: "RUN_TIMEOUT" }, execution: { pid: null } });
  expect(performance.now() - began).toBeLessThan(1500);
});

for (const mode of ["timeout", "cancel", "normal"] as const) {
  test(mode + " reaps an observed detached grandchild and preserves terminal cause", async ({}, info) => {
    const pidFile = info.outputPath("owned-pids.json");
    const script = info.outputPath("native-fixture.cjs");
    fs.writeFileSync(script, [
      "const fs = require('node:fs');",
      "const { spawn } = require('node:child_process');",
      "const grandchild = spawn(process.execPath, ['-e', \"process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)\"], { detached:true, windowsHide:true, stdio:'ignore' });",
      "grandchild.unref();",
      "fs.writeFileSync(" + JSON.stringify(pidFile) + ", JSON.stringify([process.pid, grandchild.pid]));",
      // Valid-looking output written early must never override timeout/cancellation.
      "fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, " + JSON.stringify(JSON.stringify(playwrightReport())) + ");",
      mode === "normal" ? "setTimeout(()=>process.exit(0), 2000);" : "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);",
    ].join("\n"));
    const controller = new AbortController();
    const began = performance.now();
    const pending = runPlaywrightTarget({ project: "smoke" },
      { signal: controller.signal, timeoutMs: mode === "timeout" ? 3000 : 15_000, cleanupTimeoutMs: 5000 },
      { resolveCliScriptPath: () => script });
    let pids: number[] = [];
    try {
      await waitFor(() => fs.existsSync(pidFile));
      pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
      if (mode === "cancel") {
        // Allow an OS snapshot to observe the grandchild; separate groups are intentional.
        await new Promise(resolve => setTimeout(resolve, 1200));
        controller.abort();
      }
      const result = await pending;
      expect(result.execution?.cleanup).toMatchObject({ status: "verified" });
      expect(result.execution!.cleanup.observedDescendants).toBeGreaterThanOrEqual(1);
      if (mode === "normal") expect(result).toMatchObject({ ok: true, status: "passed", exitCode: 0 });
      else expect(result).toMatchObject({ ok: false, status: "execution_error",
        error: { code: mode === "timeout" ? "RUN_TIMEOUT" : "RUN_CANCELLED" } });
      await waitFor(() => pids.every(pid => !live(pid)));
      expect(performance.now() - began).toBeLessThan((mode === "timeout" ? 3000 : 15_000) + 5000 + 1000);
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
      const frozen = JSON.stringify(result);
      controller.abort();
      expect(JSON.stringify(result)).toBe(frozen);
    } finally {
      controller.abort();
      await pending;
      if (!pids.length && fs.existsSync(pidFile)) pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
      stopFixture(pids);
    }
  });
}

for (const failed of [false, true]) {
test("cleanup uncertainty preserves native judgment: failed=" + failed, async () => {
  const cleanup: ProcessCleanup = { scope: "observed-process-tree", status: "incomplete",
    observedDescendants: 1, detail: "Fixture cleanup deadline exceeded." };
  const result = await runPlaywrightTarget({ project: "smoke" }, {}, {
    resolveCliScriptPath: () => "/fake/cli.js",
    runProcess: async (_command, _args, options) => {
      fs.writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE!, JSON.stringify(playwrightReport(failed)));
      return { pid: null, status: failed ? 1 : 0, signal: null, cleanup };
    },
  });
  expect(result).toMatchObject({ ok: false, status: "execution_error", exitCode: failed ? 1 : 0,
    error: { code: "PROCESS_CLEANUP_FAILED" }, execution: { cleanup, nativeJudgment: failed ? "failed" : "passed" } });
  const report = toRunReport(result, { taskId: "cleanup", repository: "example/project", commit: "a".repeat(40),
    observedAt: new Date().toISOString(), environment: { platform: "test", toolVersions: {}, capabilities: ["node"] } });
  expect(report.technical).toBe(failed ? "failed" : "inconclusive");
  expect(report.native.error?.code).toBe("PROCESS_CLEANUP_FAILED");
});
}

test("a completion/abort race returns cancellation once, not a native pass", async () => {
  const controller = new AbortController();
  const result = await runPlaywrightTarget({ project: "smoke" }, { signal: controller.signal }, {
    resolveCliScriptPath: () => "/fake/cli.js",
    runProcess: async (_command, _args, options) => {
      fs.writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE!, JSON.stringify(playwrightReport()));
      controller.abort();
      return { pid: null, status: 0, signal: null,
        cleanup: { scope: "observed-process-tree", status: "verified", observedDescendants: 0 } };
    },
  });
  expect(result).toMatchObject({ status: "execution_error", error: { code: "RUN_CANCELLED" } });
  expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
});

test("process birth identities prevent adopting a reused parent PID", () => {
  const known = new Map([[10, { pid: 10, parent: 1, born: "100" }]]);
  rememberDescendants(10, known, [
    { pid: 10, parent: 1, born: "200" },
    { pid: 20, parent: 10, born: "201" },
  ]);
  expect([...known.keys()]).toEqual([10]);
  const empty = new Map();
  rememberDescendants(10, empty, [{ pid: 10, parent: 1, born: "200" }]);
  expect(empty.size).toBe(0);
});

test("same-cwd simultaneous native pass/fail runs isolate every artifact", async ({}, info) => {
  const fixture = wrapperFixture(info);
  fixture.spec("fail.spec.ts", 'test("fails", async ({}, info) => { await info.attach("owned", {body:"failure"}); expect(1).toBe(2); });');
  fixture.spec("pass.spec.ts", 'test("passes", async ({}, info) => { await info.attach("owned", {body:"success"}); expect(1).toBe(1); });');
  fs.mkdirSync(path.join(fixture.cwd, "artifacts"), { recursive: true });
  const stale = path.join(fixture.cwd, "artifacts", "test-results.json");
  fs.writeFileSync(stale, JSON.stringify(playwrightReport(true)));
  const requests = ["pass", "fail"].map(name => fixture.start([
    "--project", "smoke", "--spec", "tests/smoke/" + name + ".spec.ts", "--workers", "1",
  ]));
  const children = await Promise.all(requests.map(run => run.done));
  // Preserve the observing layer's output before an exit assertion can stop the test.
  // A CLI 2 alone cannot distinguish validation, preparation, launch or cleanup failure.
  await info.attach("simultaneous-wrapper-cli-results", {
    body: Buffer.from(JSON.stringify(children, null, 2)), contentType: "application/json",
  });
  expect(children.map(child => child.status)).toEqual([0, 1]);
  const results = children.map(child => JSON.parse(child.stdout) as PlaywrightRunResult);
  expect(results.map(result => result.status)).toEqual(["passed", "failed"]);
  expect(results[0]!.execution!.runId).not.toBe(results[1]!.execution!.runId);
  for (const result of results) {
    const root = result.execution!.artifactRoot!;
    for (const file of [result.artifacts.htmlReport, result.artifacts.testResultsJson, result.artifacts.testResultsXml]) {
      expect(file).not.toBeNull();
      expect(file!.startsWith(root + "/")).toBe(true);
      expect(fs.existsSync(path.join(fixture.cwd, file!))).toBe(true);
    }
    const report = fixture.report(result);
    expect(report.stats.unexpected).toBe(result.status === "failed" ? 1 : 0);
    expect(report.config.projects.every((project: { outputDir: string }) =>
      project.outputDir.replaceAll("\\", "/").includes(root + "/test-results"))).toBe(true);
    expect(result.execution!.source).toEqual({ revision: null, workingTree: "unknown" });
    for (const trace of result.artifacts.traceFiles) expect(trace.startsWith(root + "/test-results/")).toBe(true);
    if (result.status === "failed") expect(result.artifacts.traceFiles.length).toBeGreaterThan(0);
  }
  expect(fs.readFileSync(stale, "utf8")).toBe(JSON.stringify(playwrightReport(true)));
});

test("CLI timeout covers hanging configuration and cannot reuse a stale pass", async ({}, info) => {
  const fixture = wrapperFixture(info);
  fs.writeFileSync(path.join(fixture.cwd, "playwright.config.ts"), "while(true) {}");
  fs.mkdirSync(path.join(fixture.cwd, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(fixture.cwd, "artifacts", "test-results.json"), JSON.stringify(playwrightReport()));
  const began = performance.now();
  const child = await fixture.start(["--project", "smoke", "--timeout-ms", "1500", "--cleanup-timeout-ms", "4000"]).done;
  expect(child.status).toBe(2);
  const result = JSON.parse(child.stdout);
  expect(result).toMatchObject({ ok: false, status: "execution_error", error: { code: "RUN_TIMEOUT" },
    execution: { termination: "timeout", timeoutMs: 1500, cleanupTimeoutMs: 4000 } });
  expect(performance.now() - began).toBeLessThan(6500);
  expect(result.artifacts.testResultsJson).toBeNull();
});

test("CLI signal cancellation keeps JSON and exit 2 on POSIX", async ({}, info) => {
  test.skip(process.platform === "win32", "Node kill(SIGTERM) force-terminates Windows processes; it does not emulate a console signal.");
  const fixture = wrapperFixture(info);
  const marker = path.join(fixture.cwd, "running");
  fs.writeFileSync(path.join(fixture.cwd, "playwright.config.ts"),
    "require('node:fs').writeFileSync(" + JSON.stringify(marker) + ", 'ready'); while(true) {}");
  const pending = fixture.start(["--project", "smoke", "--timeout-ms", "15000"]);
  await waitFor(() => fs.existsSync(marker));
  pending.child.kill("SIGTERM");
  const child = await pending.done;
  expect(child.status).toBe(2);
  expect(JSON.parse(child.stdout)).toMatchObject({ error: { code: "RUN_CANCELLED" } });
});


test("cancelling one same-cwd run leaves the other invocation alive", async ({}, info) => {
  const script = info.outputPath("concurrent-native.cjs");
  const record = info.outputPath("concurrent-pids.jsonl");
  const release = info.outputPath("allow-completion");
  fs.writeFileSync(script, [
    "const fs = require('node:fs');",
    "fs.appendFileSync(" + JSON.stringify(record) + ", JSON.stringify({pid:process.pid,slow:process.argv.includes('--grep'),root:process.env.PLAYWRIGHT_JSON_OUTPUT_FILE}) + '\\n');",
    "process.on('SIGTERM',()=>{});",
    "if(process.argv.includes('--grep')) setInterval(()=>{},1000);",
    "else setInterval(()=>{ if(fs.existsSync(" + JSON.stringify(release) + ")) { fs.writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, " + JSON.stringify(JSON.stringify(playwrightReport())) + "); process.exit(0); } }, 50);",
  ].join("\n"));
  const controller = new AbortController();
  const deps = { resolveCliScriptPath: () => script };
  const cancelled = runPlaywrightTarget({ project: "smoke", grep: "slow" }, { signal: controller.signal, timeoutMs: 20_000 }, deps);
  const completed = runPlaywrightTarget({ project: "smoke" }, { timeoutMs: 20_000 }, deps);
  let rows: {pid: number; slow: boolean; root: string}[] = [];
  try {
    await waitFor(() => {
      if (!fs.existsSync(record)) return false;
      rows = fs.readFileSync(record, "utf8").trim().split("\n").map(line => JSON.parse(line));
      return rows.length === 2;
    });
    await new Promise(resolve => setTimeout(resolve, 1000));
    controller.abort();
    const stopped = await cancelled;
    expect(stopped.error?.code).toBe("RUN_CANCELLED");
    expect(stopped.execution!.cleanup.status).toBe("verified");
    expect(live(rows.find(row => !row.slow)!.pid)).toBe(true);
    fs.writeFileSync(release, "complete");
    const success = await completed;
    expect(success.status).toBe("passed");
    expect(success.execution!.artifactRoot).not.toBe(stopped.execution!.artifactRoot);
    expect(success.artifacts.testResultsJson).not.toBe(stopped.artifacts.testResultsJson);
  } finally {
    controller.abort();
    fs.writeFileSync(release, "complete");
    await Promise.all([cancelled, completed]);
    stopFixture(rows.map(row => row.pid));
  }
});

test("the cleanup budget expires without converting incomplete output to a pass", async ({}, info) => {
  const script = info.outputPath("budget.cjs");
  fs.writeFileSync(script, "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);");
  const started = performance.now();
  const result = await runPlaywrightTarget({ project: "smoke" },
    { timeoutMs: 500, cleanupTimeoutMs: 100 }, { resolveCliScriptPath: () => script });
  expect(result).toMatchObject({ ok: false, status: "execution_error", error: { code: "RUN_TIMEOUT" },
    execution: { timeoutMs: 500, cleanupTimeoutMs: 100 } });
  expect(["incomplete", "unverified"]).toContain(result.execution!.cleanup.status);
  expect(performance.now() - started).toBeLessThan(1600);
  if (result.execution!.pid) await waitFor(() => !live(result.execution!.pid!));
});

test("unavailable artifact scanning is still bounded by the whole invocation deadline", async () => {
  const result = await runPlaywrightTarget({ project: "smoke" }, { timeoutMs: 500 }, {
    resolveCliScriptPath: () => "/fake/cli.js",
    runProcess: async (_command, _args, options) => {
      fs.writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE!, JSON.stringify(playwrightReport()));
      return { status: 0, signal: null, pid: null,
        cleanup: { scope: "observed-process-tree", status: "verified", observedDescendants: 0 } };
    },
    collectArtifacts: () => new Promise(() => {}),
  });
  expect(result).toMatchObject({ ok: false, error: { code: "RUN_TIMEOUT" } });
});


test("native expected-failure, retry and per-test timeout judgments remain authoritative", async ({}, info) => {
  const fixture = wrapperFixture(info);
  const config = path.join(fixture.cwd, "playwright.config.ts");
  fs.writeFileSync(config, fs.readFileSync(config, "utf8").replace("retries: process.env.CI ? 1 : 0", "retries: 1"));
  fixture.spec("expected.spec.ts", 'test("expected failure", () => { test.fail(); expect(1).toBe(2); });');
  fixture.spec("unexpected.spec.ts", 'test("unexpected pass", () => { test.fail(); expect(1).toBe(1); });');
  fixture.spec("retry.spec.ts", 'test("retry accepted", ({}, info) => { expect(info.retry).toBe(1); });');
  fixture.spec("timed.spec.ts", 'test("native test timeout", async () => { test.setTimeout(100); await new Promise(()=>{}); });');
  for (const [name, status, code] of [
    ["expected", "passed", 0], ["unexpected", "failed", 1], ["retry", "passed", 0], ["timed", "failed", 1],
  ] as const) {
    const child = await fixture.start(["--project", "smoke", "--spec", "tests/smoke/" + name + ".spec.ts", "--workers", "1"]).done;
    expect(child.status, child.stderr).toBe(code);
    const result = JSON.parse(child.stdout);
    expect(result).toMatchObject({ ok: true, status, exitCode: code, execution: { termination: "completed" } });
  }
});

test("fresh JSON emitted before a stuck reporter cannot establish a completed invocation", async ({}, info) => {
  const fixture = wrapperFixture(info);
  const reporter = path.join(fixture.cwd, "hang-reporter.cjs");
  fs.writeFileSync(reporter, "module.exports = class { onEnd() { setInterval(()=>{},1000); return new Promise(()=>{}); } };");
  const config = path.join(fixture.cwd, "playwright.config.ts");
  fs.writeFileSync(config, fs.readFileSync(config, "utf8").replace(
    '["junit", { outputFile: "artifacts/test-results.xml" }],',
    '["junit", { outputFile: "artifacts/test-results.xml" }], ["./hang-reporter.cjs"],'));
  const child = await fixture.start(["--project", "smoke", "--timeout-ms", "2500"]).done;
  expect(child.status).toBe(2);
  const result = JSON.parse(child.stdout);
  expect(result).toMatchObject({ ok: false, error: { code: "RUN_TIMEOUT" } });
  const native = JSON.parse(fs.readFileSync(path.join(fixture.cwd, result.execution.artifactRoot, "results.json"), "utf8"));
  expect(native.stats.expected).toBe(1);
  expect(result.execution!.termination).toBe("timeout");
});

test("a launch exception stays primary and avoids unbounded optional artifact work", async () => {
  let scanned = false;
  const result = await runPlaywrightTarget({ project: "smoke" }, { timeoutMs: 500 }, {
    resolveCliScriptPath: () => "/fake/cli.js",
    runProcess: async () => { throw new Error("launch rejected"); },
    collectArtifacts: () => { scanned = true; return new Promise(() => {}); },
  });
  expect(scanned).toBe(false);
  expect(result).toMatchObject({ error: { code: "PROCESS_LAUNCH_FAILED", detail: "launch rejected" } });
});
