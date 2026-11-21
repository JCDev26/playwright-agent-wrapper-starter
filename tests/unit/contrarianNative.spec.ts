import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import performancePolicy from "../../agents/performance/policy.json";
import securityPolicy from "../../agents/security/policy.json";
import { verifyNativeFindings, type NativeFile } from "../../src/playwright-wrapper/contrarian/nativeChecks";
import { readObservation } from "../../src/playwright-wrapper/performance/evidence";
import { summarizePerformance, summarizeSecurity } from "../../src/playwright-wrapper/reporting/specialistSummaries";
import type { ReportingResult } from "../../src/playwright-wrapper/reporting/summarizeEvidence";

const job = { jobId: "11111111-1111-1111-1111-111111111111", revision: "c".repeat(40) };
const metadata = { agentJobId: job.jobId, agentRevision: job.revision };
const mainRevision = "a".repeat(40);
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
type Outcome = "passed" | "failed" | "inconclusive";

function securityBytes(first: Outcome) {
  const hasUnexpected = first !== "passed";
  const specs = securityPolicy.checks.map(({ id, title }, index) => {
    const outcome = index === 0 ? first : "passed";
    const passed = outcome === "passed";
    return { title, file: securityPolicy.target.spec, tests: [{
      projectName: "security", projectId: "security", expectedStatus: "passed", status: passed ? "expected" : "unexpected",
      results: [{ status: passed ? "passed" : "failed", workerIndex: 0, parallelIndex: 0, retry: 0,
        errors: passed ? [] : [{ message: "Fixture error or assertion." }],
        attachments: outcome === "inconclusive" ? [] : [{ name: "security-contract-v1", contentType: "text/plain",
          body: Buffer.from(id + ":" + outcome).toString("base64") }] }],
    }] };
  });
  return Buffer.from(JSON.stringify({ config: { metadata, workers: 1, projects: [{ id: "security", name: "security", retries: 0, repeatEach: 1 }] },
    suites: [{ file: securityPolicy.target.spec, specs }], errors: [],
    stats: { expected: specs.length - Number(hasUnexpected), unexpected: Number(hasUnexpected), flaky: 0, skipped: 0 } }));
}

function timing(revision: string, medianMs: number, changes: object = {}) {
  const data = { revision, harnessRevision: job.revision, medianMs, samplesMs: Array(performancePolicy.sampleCount).fill(medianMs),
    initialTasks: performancePolicy.initialTasks, metric: performancePolicy.metric, unit: "ms",
    browserEngine: "chromium", browser: "fixture", node: "22", playwright: "1.65.1", platform: "linux", architecture: "x64",
    osRelease: "fixture", runnerClass: "fixture", benchmarkHash: "b".repeat(64), conditions: "loopback", project: "performance", ...changes };
  const body = Buffer.from(JSON.stringify(data)).toString("base64");
  const native = { config: { metadata, workers: 1 }, errors: [], stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [{ specs: [{ file: performancePolicy.target.spec, tests: [{ status: "expected", projectName: "performance",
      expectedStatus: "passed", results: [{ status: "passed", workerIndex: 0, retry: 0, errors: [],
        attachments: [{ name: "task-timing.json", contentType: "application/json", body }] }] }] }] }] };
  return Buffer.from(JSON.stringify(native));
}

function fixture() {
  const files = new Map<NativeFile, Buffer>();
  const report: ReportingResult = { ...job, schemaVersion: 1, policyVersion: 1, manifestSha256: "d".repeat(64),
    status: "passed", coverage: "complete", reason: "outcomes_checked", knownFailures: [], incompleteSources: [],
    suite: null, security: null, performance: null };
  const baseline = timing(mainRevision, 10);
  const anchors = { mainRevision, acceptanceRun: "123", baselineSha256: digest(baseline) };
  files.set("baseline-native.json", baseline);
  function setSecurity(actual: Outcome, claimed: Outcome) {
    const bytes = securityBytes(actual);
    files.set("security-native.json", bytes);
    report.security = summarizeSecurity({ schemaVersion: 1, policyVersion: securityPolicy.version, ...job,
      status: claimed === "passed" ? "checks_passed" : claimed === "failed" ? "checks_failed" : "insufficient_evidence",
      nativeStatus: claimed === "passed" ? "passed" : "failed", reason: "fixture",
      checks: securityPolicy.checks.map(({ id }, i) => ({ id, status: i === 0 ? claimed : "passed" })),
      report: { path: "display-only", sha256: digest(bytes) } }, job);
  }
  function setPerformance(decision: string, runs: [Buffer, number][]) {
    report.performance = summarizePerformance({ schemaVersion: 1, policyVersion: performancePolicy.version, ...job,
      status: decision, reason: "fixture", limitMs: 13,
      baseline: { revision: mainRevision, harnessRevision: job.revision, sha256: digest(baseline), medianMs: 10,
        initialTasks: performancePolicy.initialTasks, acceptanceRun: anchors.acceptanceRun },
      runs: runs.map(([bytes, medianMs], index) => {
        files.set(index === 0 ? "candidate-1-native.json" : "candidate-2-native.json", bytes);
        return { status: "passed", revision: job.revision, sha256: digest(bytes), medianMs, report: "display-only" };
      }) }, job);
  }
  setSecurity("passed", "passed");
  setPerformance("within_budget", [[timing(job.revision, 13), 13]]);
  const read = (name: NativeFile) => {
    const bytes = files.get(name);
    if (!bytes) throw new Error("Fixture snapshot is missing.");
    return bytes;
  };
  const review = () => verifyNativeFindings(report, read, "required", anchors);
  return { files, report, read, anchors, review, setSecurity, setPerformance };
}

test("checks native inputs in memory and includes the budget boundary", () => {
  const f = fixture();
  expect(f.review()).toEqual({ failures: [], concerns: [] });
  expect(readObservation(f.read("baseline-native.json"), f.anchors.baselineSha256).medianMs).toBe(10);
  expect(() => readObservation(Buffer.alloc(2 * 1024 * 1024 + 1))).toThrow("Invalid report size");
  expect(() => readObservation(timing(job.revision, 13, { samplesMs: Array(10).fill(20) }))).toThrow("Inconsistent median");
});

test("can read historical timing samples while requiring job metadata for a new verdict", () => {
  const f = fixture();
  const raw = JSON.parse(timing(job.revision, 12).toString("utf8"));
  delete raw.config.metadata;
  const legacy = Buffer.from(JSON.stringify(raw));
  expect(readObservation(legacy).medianMs).toBe(12);
  f.setPerformance("within_budget", [[legacy, 12]]);
  expect(f.review()).toEqual({ failures: [], concerns: ["native_job_mismatch", "performance_native_unverified"] });
});

test("challenges Security receipts in both directions and preserves only bound native failures", () => {
  const f = fixture();
  f.setSecurity("failed", "passed");
  expect(f.review()).toEqual({ failures: ["security"], concerns: ["security_receipt_mismatch"] });
  f.setSecurity("passed", "failed");
  expect(f.review()).toEqual({ failures: [], concerns: ["security_receipt_mismatch"] });
  f.files.set("security-native.json", securityBytes("failed"));
  expect(f.review()).toEqual({ failures: [], concerns: ["security_native_unverified"] });
  f.setSecurity("inconclusive", "inconclusive");
  expect(f.review()).toEqual({ failures: [], concerns: ["security_checks_incomplete"] });
});

test("recomputes two independent comparable overruns even if a receipt suppresses them", () => {
  const f = fixture();
  const first = timing(job.revision, 15);
  const second = timing(job.revision, 16);
  f.setPerformance("regression_reproduced", [[first, 15], [second, 16]]);
  expect(f.review()).toEqual({ failures: ["performance"], concerns: [] });
  f.setPerformance("insufficient_evidence", [[first, 11], [second, 12]]);
  expect(f.review()).toEqual({ failures: ["performance"], concerns: ["performance_receipt_mismatch"] });
  f.setPerformance("regression_reproduced", [[first, 15], [timing(job.revision, 12), 16]]);
  expect(f.review()).toEqual({ failures: [], concerns: ["performance_receipt_mismatch", "performance_comparison_incomplete"] });
  f.setPerformance("within_budget", [[first, 12]]);
  expect(f.review()).toEqual({ failures: [], concerns: ["performance_receipt_mismatch", "performance_comparison_incomplete"] });
});

test("requires externally anchored accepted main and receipts linked to the actual snapshots", () => {
  const f = fixture();
  for (const override of [{ mainRevision: job.revision }, { acceptanceRun: "" }, { baselineSha256: "f".repeat(64) }]) {
    expect(verifyNativeFindings(f.report, f.read, "required", { ...f.anchors, ...override })).toEqual({
      failures: [], concerns: ["performance_baseline_unverified"],
    });
  }
  expect(verifyNativeFindings(f.report, f.read, "required", { ...f.anchors, acceptanceRun: "124" }).concerns).toEqual(["performance_receipt_mismatch"]);
  f.files.set("candidate-1-native.json", timing(job.revision, 16));
  expect(f.review()).toEqual({ failures: [], concerns: ["performance_native_unverified"] });
});

test("refuses an unbound revision, substituted harness, different runner or reused confirmation", () => {
  const f = fixture();
  const first = timing(job.revision, 16);
  for (const second of [first, timing(mainRevision, 18), timing(job.revision, 18, { harnessRevision: mainRevision }),
    timing(job.revision, 18, { runnerClass: "another-runner" })]) {
    f.setPerformance("insufficient_evidence", [[first, 16], [second, 18]]);
    expect(f.review()).toEqual({ failures: [], concerns: ["performance_measurements_incomparable"] });
  }
});

test("permits first enrollment only with unscheduled Reporting and a complete native measurement on the candidate harness", () => {
  const f = fixture();
  const enrollment = () => verifyNativeFindings(f.report, f.read, "initial-enrollment", {});
  f.files.set("enrollment-native.json", timing(job.revision, 12));
  expect(enrollment()).toEqual({ failures: [], concerns: ["performance_mode_mismatch"] });
  f.report.performance = { status: "not_scheduled", reason: "not_scheduled_by_host", knownFailure: false, partial: false };
  expect(enrollment()).toEqual({ failures: [], concerns: [] });
  expect(f.review()).toEqual({ failures: [], concerns: ["performance_mode_mismatch"] });
  for (const native of [timing(mainRevision, 12), timing(job.revision, 12, { harnessRevision: mainRevision }), Buffer.from("missing")]) {
    f.files.set("enrollment-native.json", native);
    expect(enrollment()).toEqual({ failures: [], concerns: ["performance_enrollment_unverified"] });
  }
});

test("rejects re-sealed native evidence from another job on the same revision, including first enrollment", () => {
  const staleJob = "22222222-2222-2222-2222-222222222222";
  function stale(bytes: Buffer) {
    const raw = JSON.parse(bytes.toString("utf8"));
    raw.config.metadata.agentJobId = staleJob;
    return Buffer.from(JSON.stringify(raw));
  }
  for (const name of ["security-native.json", "baseline-native.json", "candidate-1-native.json", "candidate-2-native.json"] as const) {
    const f = fixture();
    f.setSecurity("failed", "failed");
    f.setPerformance("regression_reproduced", [[timing(job.revision, 15), 15], [timing(job.revision, 16), 16]]);
    const replay = stale(f.read(name));
    f.files.set(name, replay);
    // A newly sealed receipt and operator digest attest to these exact bytes, which still name the old job.
    const pin = digest(replay);
    if (name === "security-native.json") {
      f.report.security!.nativeReportSha256 = pin;
    } else if (name === "baseline-native.json") {
      f.report.performance!.baseline!.sha256 = f.anchors.baselineSha256 = pin;
    } else {
      const index = name === "candidate-1-native.json" ? 0 : 1;
      f.report.performance!.runs![index].measurement!.sha256 = pin;
    }
    const verdict = f.review();
    expect(verdict.concerns).toContain("native_job_mismatch");
    expect(verdict.failures).toEqual(name === "security-native.json" ? ["performance"] : ["security"]);
  }
  const f = fixture();
  f.report.performance = { status: "not_scheduled", reason: "not_scheduled_by_host", knownFailure: false, partial: false };
  f.files.set("enrollment-native.json", stale(timing(job.revision, 12)));
  expect(verifyNativeFindings(f.report, f.read, "initial-enrollment", {})).toEqual({
    failures: [], concerns: ["native_job_mismatch", "performance_enrollment_unverified"],
  });
});
