import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import policy from "../../agents/security/policy.json";
import { createExecutionErrorResult, createFailedResult, createPassedResult } from "../../src/playwright-wrapper/contract/resultSchema";
import { assessSecurity, securityTool } from "../../src/playwright-wrapper/security/assessSecurity";

const revision = "a".repeat(40);
const grant = () => ({ PW_AGENT_JOB_ID: randomUUID(), PW_AGENT_REVISION: revision });
const target = { ...policy.target, grep: null };
const artifacts = { testResultsJson: "native.json", htmlReport: null, testResultsXml: null, traceFiles: [] };
const body = (id: string, outcome: string) => Buffer.from(id + ":" + outcome).toString("base64");

function nativeReport() {
  return {
    config: { workers: 1, projects: [{ id: "security", name: "security", retries: 0, repeatEach: 1 }] },
    errors: [], stats: { expected: policy.checks.length, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ file: policy.target.spec, specs: policy.checks.map(({ id, title }) => ({
      file: policy.target.spec, title, tests: [{
        projectId: "security", projectName: "security", expectedStatus: "passed", status: "expected",
        results: [{ retry: 0, workerIndex: 0, parallelIndex: 0, status: "passed", errors: [] as { message: string }[],
          attachments: [{ name: "security-contract-v1", contentType: "text/plain", body: body(id, "passed") }] }],
      }],
    })) }],
  };
}

type Native = ReturnType<typeof nativeReport>;

function failedAttempt(report: Native, index: number, observed: boolean) {
  report.stats.expected--;
  report.stats.unexpected++;
  const test = report.suites[0].specs[index].tests[0];
  test.status = "unexpected";
  const [attempt] = test.results;
  attempt.status = "failed";
  attempt.errors.push({ message: observed ? "Contract assertion failed." : "Fixture did not start." });
  if (observed) attempt.attachments[0].body = body(policy.checks[index].id, "failed");
  else attempt.attachments = [];
}

function nativeRun(report: Native) {
  fs.writeFileSync(artifacts.testResultsJson, JSON.stringify(report));
  const result = { command: "fixture", target, artifacts };
  return report.stats.unexpected ? createFailedResult({ ...result, exitCode: 1 }) : createPassedResult({ ...result, exitCode: 0 });
}
const assess = (report: Native) => assessSecurity(securityTool.name, {}, grant(), () => nativeRun(report), () => revision);

let originalCwd: string;
test.beforeEach(({}, info) => {
  originalCwd = process.cwd();
  fs.mkdirSync(info.outputDir, { recursive: true });
  process.chdir(info.outputDir);
});
test.afterEach(() => process.chdir(originalCwd));

test("runs only the policy target once and identifies its evidence", () => {
  const env = grant();
  const report = nativeReport();
  let calls = 0;
  const run = (request: unknown) => {
    calls++;
    expect(request).toEqual(policy.target);
    return nativeRun(report);
  };
  const finding = assessSecurity(securityTool.name, {}, env, run, () => revision);
  expect(finding).toMatchObject({
    schemaVersion: 1, policyVersion: policy.version, jobId: env.PW_AGENT_JOB_ID, revision,
    status: "checks_passed", nativeStatus: "passed", checks: policy.checks.map(({ id }) => ({ id, status: "passed" })),
    report: { path: artifacts.testResultsJson, sha256: createHash("sha256").update(JSON.stringify(report)).digest("hex") },
  });
  expect(assessSecurity(securityTool.name, {}, env, run, () => revision)).toMatchObject({ status: "denied", nativeStatus: null, report: null });
  expect(calls).toBe(1);
});

test("rejects overrides and unauthorized revisions before execution or consuming the job", () => {
  const env = grant();
  const never = () => { throw new Error("Unexpected execution."); };
  for (const args of [{ url: "https://example.invalid" }, { project: "smoke" }, { retries: 1 }, { spec: "other.spec.ts" }, null, []])
    expect(assessSecurity(securityTool.name, args, env, never, () => revision)).toMatchObject({ status: "denied", jobId: null });
  expect(assessSecurity("different-action", {}, env, never, () => revision).status).toBe("denied");
  expect(assessSecurity(securityTool.name, {}, env, never, () => null).status).toBe("denied");
  expect(assessSecurity(securityTool.name, {}, {}, never, () => revision).status).toBe("denied");
  expect(fs.existsSync("artifacts")).toBe(false);
});

test("retains a proven contract failure alongside an unrelated fixture failure", () => {
  const native = nativeReport();
  failedAttempt(native, 0, true);
  failedAttempt(native, 1, false);
  expect(assess(native)).toMatchObject({ status: "checks_failed", nativeStatus: "failed", checks: [
    { id: "literal-task-title", status: "failed" }, { id: "invalid-update-preserves-task", status: "inconclusive" },
    { id: "task-api-no-store", status: "passed" },
  ] });
});

test("preserves native failure when the contract could not be observed", () => {
  const native = nativeReport();
  failedAttempt(native, 0, false);
  expect(assess(native)).toMatchObject({ status: "insufficient_evidence", nativeStatus: "failed",
    report: { path: artifacts.testResultsJson }, checks: [{ status: "inconclusive" }, { status: "passed" }, { status: "passed" }] });
});

test("rejects wrong scope, unexpected or duplicate cases, and mismatched native totals", () => {
  const changes: ((native: Native) => void)[] = [
    r => { r.config.workers = 2; }, r => { r.config.projects[0].retries = 1; },
    r => { r.suites[0].specs[0].file = "tests/smoke/example.spec.ts"; },
    r => { r.suites[0].specs[0].tests[0].projectName = "smoke"; },
    r => { r.suites[0].specs[0].title = r.suites[0].specs[1].title; },
    r => { r.suites[0].specs[0].title = "an unregistered check"; },
    r => { r.suites[0].specs.pop(); r.stats.expected--; }, r => { r.stats.skipped++; },
  ];
  for (const change of changes) {
    const native = nativeReport();
    change(native);
    expect(assess(native)).toMatchObject({ status: "insufficient_evidence", checks: policy.checks.map(({ id }) => ({ id, status: "inconclusive" })) });
  }
});

test("requires exactly one first attempt and its own inline assertion observation", () => {
  const changes: ((native: Native) => void)[] = [
    r => { const results = r.suites[0].specs[0].tests[0].results; results.push({ ...results[0], retry: 1 }); },
    r => { r.suites[0].specs[0].tests[0].results[0].attachments[0].body = body("another-check", "passed"); },
    r => { const marker = r.suites[0].specs[0].tests[0].results[0].attachments[0]; Object.assign(marker, { path: "unused.txt" }); },
    r => { r.suites[0].specs[0].tests[0].expectedStatus = "failed"; },
  ];
  for (const change of changes) {
    const native = nativeReport();
    change(native);
    expect(assess(native)).toMatchObject({ status: "insufficient_evidence", nativeStatus: "passed",
      checks: [{ status: "inconclusive" }, { status: "passed" }, { status: "passed" }] });
  }
});

test("retains a native preflight error and declines evidence from a changed checkout", () => {
  const blocked = assessSecurity(securityTool.name, {}, grant(), () => createExecutionErrorResult({
    target, command: null, exitCode: null, code: "PREFLIGHT_FAILED", detail: "Missing Chromium.",
    artifacts: { ...artifacts, testResultsJson: null },
  }), () => revision);
  expect(blocked).toMatchObject({ status: "insufficient_evidence", nativeStatus: "execution_error", report: null });
  let checkout: string | null = revision;
  const changed = assessSecurity(securityTool.name, {}, grant(), () => {
    checkout = null;
    return nativeRun(nativeReport());
  }, () => checkout);
  expect(changed).toMatchObject({ status: "insufficient_evidence", nativeStatus: "passed", checks: policy.checks.map(({ id }) => ({ id, status: "inconclusive" })) });
});
