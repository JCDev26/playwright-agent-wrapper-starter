import { test, expect } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assessPerformance, tool } from "../../src/playwright-wrapper/performance/assessPerformance";
import policy from "../../agents/performance/policy.json";
import { createPassedResult } from "../../src/playwright-wrapper/contract/resultSchema";

function report(file: string, medianMs = 10, overrides = {}) {
  const data = {
    metric: policy.metric, unit: "ms", samplesMs: Array(10).fill(medianMs), medianMs,
    browserEngine: "chromium", browser: "123", platform: "linux", architecture: "x64",
    osRelease: "1", node: "22", playwright: "1.65.1", runnerClass: "fixture-runner",
    benchmarkHash: "a".repeat(64), project: "performance", conditions: "one warm-up", revision: "1".repeat(40),
    ...overrides,
  };
  const body = Buffer.from(JSON.stringify(data)).toString("base64");
  const native = {
    config: { workers: 1 }, errors: [], stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ file: policy.target.spec, tests: [{
      projectName: "performance", expectedStatus: "passed", status: "expected",
      results: [{ status: "passed", workerIndex: 0, retry: 0, errors: [],
        attachments: [{ name: "task-timing.json", contentType: "application/json", body }] }],
    }] }] }],
  };
  const bytes = JSON.stringify({ ...native, id: randomUUID() });
  fs.writeFileSync(file, bytes);
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const baseline = path.resolve("baseline.json");
  const env = { PW_AGENT_JOB_ID: randomUUID(), PW_AGENT_REVISION: "1".repeat(40),
    PW_AGENT_BASELINE_FILE: baseline, PW_AGENT_BASELINE_SHA256: report(baseline) };
  let calls = 0;
  function assess(medians: number[], overrides = {}) {
    return assessPerformance(tool.name, {}, env, target => {
      expect(target).toEqual(policy.target);
      const file = path.resolve("candidate-" + calls + ".json");
      expect(calls).toBeLessThan(medians.length);
      report(file, medians[calls++], overrides);
      return createPassedResult({ command: "fixture", target: { ...policy.target, grep: null }, exitCode: 0,
        artifacts: { htmlReport: null, testResultsXml: null, testResultsJson: file, traceFiles: [] } });
    }, () => env.PW_AGENT_REVISION);
  }
  return { env, assess, calls: () => calls };
}

let originalCwd: string;
test.beforeEach(({}, info) => {
  originalCwd = process.cwd();
  fs.mkdirSync(info.outputDir, { recursive: true });
  process.chdir(info.outputDir);
});
test.afterEach(() => process.chdir(originalCwd));

test("rejects unknown tools and overrides before consuming a job or running tests", () => {
  const { env } = fixture();
  for (const [name, args] of [
    ["set-baseline", {}], [tool.name, { command: "other" }], [tool.name, { project: "smoke" }],
    [tool.name, { budget: 100 }], [tool.name, { env: {} }], [tool.name, { baseline: "other" }],
    [tool.name, null], [tool.name, []],
  ] as const) {
    expect(assessPerformance(name, args, env, () => { throw new Error("unauthorized execution"); }).status).toBe("denied");
  }
  expect(fs.existsSync("artifacts")).toBe(false);
});

test("a changed baseline or missing host grant cannot start a run", () => {
  const { env } = fixture();
  const never = () => { throw new Error("unexpected execution"); };
  expect(assessPerformance(tool.name, {}, { ...env, PW_AGENT_JOB_ID: "../another" }, never).status).toBe("denied");
  fs.appendFileSync(env.PW_AGENT_BASELINE_FILE, " ");
  expect(assessPerformance(tool.name, {}, env, never, () => null).status).toBe("denied");
  expect(assessPerformance(tool.name, {}, env, never, () => env.PW_AGENT_REVISION).status).toBe("insufficient_evidence");
});

for (const [medians, expected] of [
  [[13], "within_budget"], [[16, 15], "regression_reproduced"], [[16, 11], "insufficient_evidence"],
] as const) {
  test("evaluates " + medians.join(",") + " ms and refuses a replay", () => {
    const f = fixture();
    expect(f.assess([...medians])).toMatchObject({ status: expected, limitMs: 13 });
    expect(f.calls()).toBe(medians.length);
    expect(f.assess([]).status).toBe("denied");
  });
}

test("compares the same browser and runner, and requires verifiable samples and revision", () => {
  for (const override of [
    { browser: "different" }, { runnerClass: "other" }, { benchmarkHash: "b".repeat(64) },
    { samplesMs: [1] }, { medianMs: 999 }, { revision: null },
  ]) {
    const f = fixture();
    expect(f.assess([10], override).status).toBe("insufficient_evidence");
    expect(f.calls()).toBe(1);
  }
});

test("preserves a failed native judgment as insufficient timing evidence", () => {
  const { env } = fixture();
  const finding = assessPerformance(tool.name, {}, env, () => ({
    ok: true, status: "failed", target: { ...policy.target, grep: null }, command: "fixture", exitCode: 1,
    artifacts: { testResultsJson: "native.json", htmlReport: null, testResultsXml: null, traceFiles: [] },
    summary: { message: "assertion failed", nextReviewPoint: "native evidence" },
  }), () => env.PW_AGENT_REVISION);
  expect(finding).toMatchObject({ status: "insufficient_evidence", runs: [{ status: "failed", report: "native.json" }] });
});
