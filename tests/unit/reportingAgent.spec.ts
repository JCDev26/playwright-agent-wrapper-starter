import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import reportingPolicy from "../../agents/reporting/policy.json";
import securityPolicy from "../../agents/security/policy.json";
import { reportingTool, summarizeEvidence } from "../../src/playwright-wrapper/reporting/summarizeEvidence";

const revision = "1".repeat(40);
const unsafeText = "Untrusted words <script>never echo</script>";
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function nativeTest(projectName: string, status = "expected", attempts = ["passed"], expectedStatus = "passed") {
  return { projectName, status, expectedStatus, results: attempts.map((status, retry) => ({
    retry, status, workerIndex: 0, errors: [], stdout: [{ text: unsafeText }],
    attachments: [{ name: unsafeText, path: "https://example.invalid/ignored" }],
  })) };
}

function suite(tests = reportingPolicy.suiteProjects.map(project => nativeTest(project))) {
  const stats: Record<string, number> = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  for (const { status } of tests) stats[status]++;
  return { suites: [{ specs: [], suites: [{ specs: [{ title: unsafeText, tests }] }] }], stats, errors: [] as unknown[] };
}

function fixture(outputDir: string) {
  const root = path.join(outputDir, randomUUID());
  const jobId = randomUUID();
  const directory = path.join(root, "artifacts", "reporting", jobId);
  fs.mkdirSync(directory, { recursive: true });
  const env = { PW_AGENT_JOB_ID: jobId, PW_AGENT_REVISION: revision, PW_AGENT_REPORT_MANIFEST_SHA256: "" };
  const base = { schemaVersion: 1, jobId, revision };
  function write(name: string, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value));
    fs.writeFileSync(path.join(directory, name + ".json"), bytes);
    return digest(bytes);
  }
  function security(overrides = {}) {
    return write("security", { ...base, policyVersion: securityPolicy.version, status: "checks_passed",
      nativeStatus: "passed", reason: unsafeText, report: { path: unsafeText, sha256: "a".repeat(64) },
      checks: securityPolicy.checks.map(({ id }) => ({ id, status: "passed" })), ...overrides });
  }
  const baseline = { revision: "2".repeat(40), harnessRevision: revision, acceptanceRun: "394765",
    medianMs: 10, initialTasks: 50, sha256: "a".repeat(64) };
  const run = { status: "passed", report: unsafeText, medianMs: 12, revision, sha256: "b".repeat(64) };
  function performance(overrides = {}) {
    return write("performance", { ...base, policyVersion: 2, status: "within_budget", reason: unsafeText,
      baseline, limitMs: 13, runs: [run], ...overrides });
  }
  const manifest = { ...base, suite: { sha256: write("suite", suite()), exitCode: 0 },
    security: { sha256: security() }, performance: { expected: true, sha256: performance() } };
  function seal(overrides = {}) {
    env.PW_AGENT_REPORT_MANIFEST_SHA256 = write("manifest", { ...manifest, ...overrides });
  }
  seal();
  const summarize = () => summarizeEvidence(reportingTool.name, {}, env, () => revision, root);
  return { root, directory, env, baseline, run, write, security, performance, manifest, seal, summarize };
}

test("accepts only the empty registered request with an authorized clean checkout", ({}, info) => {
  const f = fixture(info.outputDir);
  for (const [name, args] of [["send-report", {}], [reportingTool.name, null], [reportingTool.name, []],
    ...["file", "url", "revision", "policy", "approve", "publish", "command", "env"].map(key =>
      [reportingTool.name, { [key]: unsafeText }])] as const) {
    const denied = summarizeEvidence(name, args, f.env, () => { throw new Error("unexpected checkout read"); }, f.root);
    expect(denied).toMatchObject({ status: "denied", suite: null, manifestSha256: null });
  }
  expect(summarizeEvidence(reportingTool.name, {}, f.env, () => null, f.root).status).toBe("denied");
  let probes = 0;
  expect(summarizeEvidence(reportingTool.name, {}, f.env, () => ++probes === 1 ? revision : null, f.root))
    .toMatchObject({ status: "denied", reason: "checkout_changed", suite: null });
});

test("returns repeatable, read-only projections without replaying prose, paths or attachments", ({}, info) => {
  const f = fixture(info.outputDir);
  const fileState = () => fs.readdirSync(f.directory).sort().map(name => {
    const file = path.join(f.directory, name);
    return [name, digest(fs.readFileSync(file)), fs.statSync(file).mtimeMs];
  });
  const before = fileState();
  const summary = f.summarize();
  expect(summary).toMatchObject({ status: "passed", coverage: "complete", knownFailures: [], incompleteSources: [],
    suite: { status: "passed", counts: { expected: 5, unexpected: 0 }, missingProjects: [] },
    security: { decision: "checks_passed", evidence: "host_attested_finding" },
    performance: { decision: "within_budget", limitMs: 13, baseline: { medianMs: 10, initialTasks: 50 } } });
  expect(JSON.stringify(summary)).not.toContain(unsafeText);
  expect(f.summarize()).toEqual(summary);
  expect(fileState()).toEqual(before);
  expect(fs.readdirSync(path.join(f.root, "artifacts"))).toEqual(["reporting"]);
});

test("preserves verified failures alongside a missing lane and an incompletely observed check", ({}, info) => {
  const f = fixture(info.outputDir);
  const tests = reportingPolicy.suiteProjects.map(p => nativeTest(p));
  tests.push(nativeTest("smoke", "unexpected", ["failed"]));
  const checks = securityPolicy.checks.map(({ id }, i) => ({ id, status: ["failed", "inconclusive", "passed"][i] }));
  f.seal({ suite: { sha256: f.write("suite", suite(tests)), exitCode: 1 },
    security: { sha256: f.security({ status: "checks_failed", nativeStatus: "failed", checks }) },
    performance: { expected: true, sha256: null } });
  expect(f.summarize()).toMatchObject({ status: "failed", coverage: "partial", knownFailures: ["suite", "security"],
    incompleteSources: ["security", "performance"], suite: { counts: { unexpected: 1 } },
    security: { decision: "checks_failed", checks }, performance: { status: "missing" } });
});

test("keeps missing, unscheduled and stale inputs distinct", ({}, info) => {
  const f = fixture(info.outputDir);
  fs.renameSync(path.join(f.directory, "suite.json"), path.join(f.directory, "unenrolled.json"));
  f.seal({ security: { sha256: f.security({ revision: "f".repeat(40) }) },
    performance: { expected: false, sha256: null } });
  expect(f.summarize()).toMatchObject({ status: "inconclusive", knownFailures: [], incompleteSources: ["suite", "security"],
    suite: { status: "missing", reason: "file_missing" }, security: { status: "invalid", reason: "job_or_revision_mismatch" },
    performance: { status: "not_scheduled" } });
});

test("rejects unpinned, replaced, stale or overbroad enrollment before reading any findings", ({}, info) => {
  const f = fixture(info.outputDir);
  for (const pin of ["", "not-a-digest", "c".repeat(64)]) {
    f.env.PW_AGENT_REPORT_MANIFEST_SHA256 = pin;
    expect(f.summarize()).toMatchObject({ status: "inconclusive", incompleteSources: ["manifest"], security: null });
  }
  for (const overrides of [{ jobId: randomUUID() }, { revision: "c".repeat(40) }, { schemaVersion: 0 },
    { approved: true }, { suite: { ...f.manifest.suite, path: "../another-job" } },
    { performance: { expected: false, sha256: "a".repeat(64) } }]) {
    f.seal(overrides);
    expect(f.summarize()).toMatchObject({ status: "inconclusive", knownFailures: [], suite: null });
  }
});

test("detects swapped bytes, malformed JSON and unknown finding fields", ({}, info) => {
  const f = fixture(info.outputDir);
  fs.appendFileSync(path.join(f.directory, "suite.json"), "\n");
  const bytes = Buffer.from([0xc0, 0xff]);
  fs.writeFileSync(path.join(f.directory, "security.json"), bytes);
  f.seal({ security: { sha256: digest(bytes) }, performance: { expected: true, sha256: f.performance({ approved: true }) } });
  expect(f.summarize()).toMatchObject({ status: "inconclusive", knownFailures: [],
    suite: { reason: "digest_mismatch" }, security: { reason: "invalid_json" }, performance: { reason: "invalid_schema" } });
});

test("rejects junctions above enrolled files, hard links and oversized artifacts", ({}, info) => {
  const f = fixture(info.outputDir);
  const directory = path.join(f.root, "artifacts", "reporting");
  const moved = path.join(info.outputDir, "external-reporting");
  fs.renameSync(directory, moved);
  fs.symlinkSync(moved, directory, "junction");
  expect(f.summarize()).toMatchObject({ status: "inconclusive", reason: "unsafe_artifact_path", suite: null });
  const g = fixture(info.outputDir);
  fs.linkSync(path.join(g.directory, "security.json"), path.join(g.root, "other.json"));
  fs.truncateSync(path.join(g.directory, "performance.json"), reportingPolicy.maxFindingBytes + 1);
  expect(g.summarize()).toMatchObject({ security: { reason: "unsafe_artifact_path" },
    performance: { reason: "invalid_artifact_size" } });
});

test("counts skips, retries and expected failures using Playwright outcomes", ({}, info) => {
  const f = fixture(info.outputDir);
  const tests = reportingPolicy.suiteProjects.map(p => nativeTest(p));
  tests.push(nativeTest("smoke", "expected", ["failed"], "failed"), nativeTest("unit", "flaky", ["failed", "passed"]),
    nativeTest("mobile-ios", "skipped", ["skipped"], "skipped"));
  f.seal({ suite: { sha256: f.write("suite", suite(tests)), exitCode: 0 } });
  expect(f.summarize()).toMatchObject({ status: "passed", coverage: "partial", incompleteSources: ["suite"],
    suite: { status: "passed", counts: { expected: 6, skipped: 1, flaky: 1, unexpected: 0 } } });
  f.seal({ suite: { sha256: f.write("suite", suite(tests.filter(t => t.projectName !== "mobile-android"))), exitCode: 0 } });
  expect(f.summarize()).toMatchObject({ status: "inconclusive", suite: { missingProjects: ["mobile-android"] } });
});

test("retains known test failures when a runner error interrupts other coverage", ({}, info) => {
  const f = fixture(info.outputDir);
  const report = suite([nativeTest("smoke", "unexpected", ["failed"]), nativeTest("integration", "skipped", ["interrupted"])]);
  report.errors.push({ message: unsafeText });
  f.seal({ suite: { sha256: f.write("suite", report), exitCode: 1 } });
  expect(f.summarize()).toMatchObject({ status: "failed", coverage: "partial", knownFailures: ["suite"],
    suite: { status: "inconclusive", counts: { unexpected: 1 }, runnerErrors: 1, interruptedAttempts: 1 } });
});

test("invalidates contradictory attempts, counts or exit codes and keeps all-skipped runs incomplete", ({}, info) => {
  const f = fixture(info.outputDir);
  const wrongTotals = suite();
  wrongTotals.stats.expected++;
  for (const [value, exitCode] of [[suite([nativeTest("unit", "expected", ["failed"])]), 0], [wrongTotals, 0],
    [suite(), 1], [suite([nativeTest("untrusted-project")]), 0]] as const) {
    f.seal({ suite: { sha256: f.write("suite", value), exitCode } });
    expect(f.summarize()).toMatchObject({ status: "inconclusive", suite: { status: "invalid" } });
  }
  f.seal({ suite: { sha256: f.write("suite", suite([nativeTest("unit", "skipped", [], "skipped")])), exitCode: 0 } });
  expect(f.summarize()).toMatchObject({ status: "inconclusive", suite: { counts: { skipped: 1 },
    missingProjects: reportingPolicy.suiteProjects } });
});

test("requires two independent overruns of the policy budget to report a performance regression", ({}, info) => {
  const f = fixture(info.outputDir);
  const first = { ...f.run, medianMs: 16 };
  const second = { ...first, medianMs: 14, sha256: "c".repeat(64) };
  const bind = (overrides: object) => f.seal({ performance: { expected: true,
    sha256: f.performance({ status: "regression_reproduced", runs: [first, second], ...overrides }) } });
  bind({});
  expect(f.summarize()).toMatchObject({ status: "failed", coverage: "complete", knownFailures: ["performance"],
    performance: { decision: "regression_reproduced", limitMs: 13 } });
  for (const overrides of [{ runs: [first] }, { runs: [first, first] }, { runs: [first, f.run] },
    { runs: [first, { ...second, revision: "f".repeat(40) }] }, { limitMs: 11 },
    { baseline: { ...f.baseline, initialTasks: 1 } }]) {
    bind(overrides);
    expect(f.summarize()).toMatchObject({ status: "inconclusive", performance: { status: "invalid" } });
  }
});

test("reports native specialist failures separately from confirmed security or performance findings", ({}, info) => {
  const f = fixture(info.outputDir);
  const checks = securityPolicy.checks.map(({ id }) => ({ id, status: "inconclusive" }));
  f.seal({ security: { sha256: f.security({ status: "insufficient_evidence", nativeStatus: "failed", checks }) },
    performance: { expected: true, sha256: f.performance({ status: "insufficient_evidence",
      runs: [{ status: "failed", report: unsafeText }] }) } });
  expect(f.summarize()).toMatchObject({ status: "inconclusive", knownFailures: [], incompleteSources: ["security", "performance"],
    security: { decision: "insufficient_evidence", nativeStatus: "failed" },
    performance: { decision: "insufficient_evidence", runs: [{ nativeStatus: "failed", measurement: null }] } });
});

test("rejects an incomplete or contradictory security receipt as a source of passing checks", ({}, info) => {
  const f = fixture(info.outputDir);
  const ids = securityPolicy.checks.map(({ id }) => ({ id, status: "passed" }));
  for (const overrides of [{ checks: [ids[0], ids[0], ids[2]] }, { checks: ids.slice(1) },
    { checks: ids.map(c => ({ ...c, status: "inconclusive" })) }, { report: null }, { nativeStatus: "failed" },
    { status: "checks_failed", nativeStatus: "failed" }]) {
    f.seal({ security: { sha256: f.security(overrides) } });
    expect(f.summarize()).toMatchObject({ status: "inconclusive", security: { status: "invalid" } });
  }
});
