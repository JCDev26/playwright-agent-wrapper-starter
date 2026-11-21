import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import benchmark from "../../agents/performance/policy.json";
import { captureReviewInputs } from "../../scripts/capture-review-inputs";
import { readPinnedBytes, readWrapperReport, type InputFile } from "../../src/playwright-wrapper/reporting/pinnedEvidence";

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const revision = "1".repeat(40);
let cwd: string;
test.beforeEach(({}, info) => {
  cwd = process.cwd();
  fs.mkdirSync(info.outputDir, { recursive: true });
  process.chdir(info.outputDir);
});
test.afterEach(() => process.chdir(cwd));

function fixture(expected = true) {
  const job = { jobId: randomUUID(), revision };
  const directory = path.resolve("artifacts", "reporting", job.jobId);
  fs.mkdirSync(directory, { recursive: true });
  const env: NodeJS.ProcessEnv = {};
  function write(name: InputFile, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value) + "\n");
    fs.writeFileSync(path.join(directory, name), bytes);
    return sha256(bytes);
  }
  function native() {
    const folder = fs.mkdtempSync(path.resolve("artifacts", "wrapper-result-"));
    const bytes = Buffer.from(JSON.stringify({ observation: randomUUID(), attachment: "<script>data</script>" }) + "\r\n");
    const absolute = path.join(folder, "results.json");
    fs.writeFileSync(absolute, bytes);
    return { sha256: sha256(bytes), absolute, path: path.relative(process.cwd(), absolute).split(path.sep).join("/") };
  }
  const securityReport = native();
  const candidate = native();
  const confirmation = native();
  const baseline = native();
  const security = { ...job, schemaVersion: 1, policyVersion: 1, status: "checks_passed",
    report: { path: securityReport.path, sha256: securityReport.sha256 } };
  const runs: { status: string; report: string; sha256?: string }[] = [
    { status: "passed", report: candidate.path, sha256: candidate.sha256 },
    { status: "passed", report: confirmation.path, sha256: confirmation.sha256 }];
  const performance = { ...job, schemaVersion: 1, policyVersion: 2, status: "regression_reproduced", runs };
  env.PW_AGENT_BASELINE_FILE = baseline.absolute;
  env.PW_AGENT_BASELINE_SHA256 = baseline.sha256;
  env.PW_AGENT_MAIN_REVISION = "2".repeat(40);
  env.PW_AGENT_MAIN_CI_RUN = "73";
  const lane = { status: "missing", reason: "not_enrolled", partial: true, knownFailure: false };
  function seal() {
    const manifest = { ...job, schemaVersion: 1, suite: null, security: { sha256: write("security.json", security) },
      performance: { expected, sha256: expected ? write("performance.json", performance) : null } };
    const manifestSha256 = write("manifest.json", manifest);
    env.PW_AGENT_REPORT_MANIFEST_SHA256 = manifestSha256;
    const summary = { ...job, schemaVersion: 1, policyVersion: 1, manifestSha256, status: "inconclusive",
      coverage: "partial", reason: "incomplete_evidence", knownFailures: [], incompleteSources: ["suite", "security"],
      suite: lane, security: lane, performance: lane };
    return write("summary.json", summary);
  }
  const summaryPin = seal();
  return { job, directory, env, write, native, security, performance, securityReport, candidate, confirmation, baseline, seal,
    summaryPin, capture: () => captureReviewInputs(job, expected ? "required" : "initial-enrollment", env) };
}

test("pins the exact independently captured bytes and refuses a second capture", () => {
  const f = fixture();
  const pins = f.capture();
  expect(pins).toEqual({ PW_AGENT_REVIEW_PERFORMANCE: "required", PW_AGENT_REVIEW_SUMMARY_SHA256: f.summaryPin,
    PW_AGENT_REVIEW_SECURITY_SHA256: f.securityReport.sha256, PW_AGENT_REVIEW_BASELINE_SHA256: f.baseline.sha256,
    PW_AGENT_REVIEW_CANDIDATE_1_SHA256: f.candidate.sha256, PW_AGENT_REVIEW_CANDIDATE_2_SHA256: f.confirmation.sha256,
    PW_AGENT_MAIN_REVISION: f.env.PW_AGENT_MAIN_REVISION, PW_AGENT_MAIN_CI_RUN: "73", PW_AGENT_BASELINE_SHA256: f.baseline.sha256 });
  for (const [name, observation] of [["security-native.json", f.securityReport], ["baseline-native.json", f.baseline],
    ["candidate-1-native.json", f.candidate], ["candidate-2-native.json", f.confirmation]] as const) {
    expect(readPinnedBytes(process.cwd(), f.job, name, observation.sha256, 16384)).toEqual(fs.readFileSync(observation.absolute));
  }
  expect(() => f.capture()).toThrow();
});

test("withholds stale summaries, changed or unbound receipts and preexisting destinations independently", () => {
  const f = fixture();
  f.security.revision = "c".repeat(40);
  f.performance.runs[0].sha256 = "d".repeat(64);
  f.seal();
  f.write("summary.json", { jobId: randomUUID(), status: "passed" });
  f.write("baseline-native.json", { old: "preexisting bytes" });
  const pins = f.capture();
  expect(pins.PW_AGENT_REVIEW_SUMMARY_SHA256).toBeUndefined();
  expect(pins.PW_AGENT_REVIEW_SECURITY_SHA256).toBeUndefined();
  expect(pins.PW_AGENT_REVIEW_BASELINE_SHA256).toBeUndefined();
  expect(pins.PW_AGENT_REVIEW_CANDIDATE_1_SHA256).toBeUndefined();
  expect(pins.PW_AGENT_REVIEW_CANDIDATE_2_SHA256).toBe(f.confirmation.sha256);
  expect(fs.readFileSync(path.join(f.directory, "baseline-native.json"), "utf8")).toContain("preexisting bytes");
});

test("checks receipt pins even if another verifiable source remains available", () => {
  const f = fixture();
  fs.appendFileSync(path.join(f.directory, "security.json"), " ");
  fs.unlinkSync(path.join(f.directory, "summary.json"));
  const pins = f.capture();
  expect(pins.PW_AGENT_REVIEW_SUMMARY_SHA256).toBeUndefined();
  expect(pins.PW_AGENT_REVIEW_SECURITY_SHA256).toBeUndefined();
  expect(pins.PW_AGENT_REVIEW_BASELINE_SHA256).toBe(f.baseline.sha256);
  expect(pins.PW_AGENT_REVIEW_CANDIDATE_1_SHA256).toBe(f.candidate.sha256);
});

test("keeps a current failed native run even when its specialist could not produce a measurement digest", () => {
  const f = fixture();
  f.performance.status = "insufficient_evidence";
  f.performance.runs = [{ status: "failed", report: f.candidate.path }];
  f.seal();
  const pins = f.capture();
  expect(pins.PW_AGENT_REVIEW_CANDIDATE_1_SHA256).toBe(f.candidate.sha256);
  expect(pins.PW_AGENT_REVIEW_CANDIDATE_2_SHA256).toBeUndefined();
});

test("pins disputed claims for review and withholds unrecognized or cross-manifest summaries", () => {
  for (const change of ["disputed", "extra_field", "unknown_status", "other_manifest"]) {
    const f = fixture();
    const summary = JSON.parse(fs.readFileSync(path.join(f.directory, "summary.json"), "utf8"));
    if (change === "disputed") summary.status = "passed";
    if (change === "extra_field") summary.suite.approval = true;
    if (change === "unknown_status") summary.status = "celebrated";
    if (change === "other_manifest") summary.manifestSha256 = "f".repeat(64);
    const digest = f.write("summary.json", summary);
    const pins = f.capture();
    expect(pins.PW_AGENT_REVIEW_SUMMARY_SHA256).toBe(["disputed", "extra_field"].includes(change) ? digest : undefined);
    expect(pins.PW_AGENT_REVIEW_SECURITY_SHA256).toBe(f.securityReport.sha256);
  }
});

test("rejects alias paths, arbitrary filenames, links and stale manifest pins", () => {
  const f = fixture();
  for (const reference of [f.candidate.absolute, "../" + f.candidate.path, f.candidate.path.replace("artifacts/", "artifacts/./"),
    f.candidate.path.replaceAll("/", "\\"), f.candidate.path.replace("results.json", "trace.zip"), "https://example.invalid/ignored"])
    expect(() => readWrapperReport(process.cwd(), reference, "receipt")).toThrow();
  expect(() => readWrapperReport(process.cwd(), f.candidate.path, "baseline")).toThrow();
  fs.linkSync(f.candidate.absolute, path.resolve("alias.json"));
  expect(() => readWrapperReport(process.cwd(), f.candidate.path, "receipt")).toThrow();
  const sealed = f.env.PW_AGENT_REPORT_MANIFEST_SHA256;
  f.env.PW_AGENT_REPORT_MANIFEST_SHA256 = "f".repeat(64);
  expect(f.env.PW_AGENT_REPORT_MANIFEST_SHA256).not.toBe(sealed);
  const pins = f.capture();
  expect(pins.PW_AGENT_REVIEW_SECURITY_SHA256).toBeUndefined();
  expect(pins.PW_AGENT_REVIEW_SUMMARY_SHA256).toBeUndefined();
  expect(pins.PW_AGENT_REVIEW_BASELINE_SHA256).toBe(f.baseline.sha256);
});

test("captures an explicitly scheduled standalone enrollment and validates its target and success", () => {
  for (const change of [{}, { target: { ...benchmark.target, workers: 2 } }, { status: "failed", exitCode: 1 },
    { artifacts: { testResultsJson: "artifacts/reporting/another.json" } }]) {
    const f = fixture(false);
    f.write("enrollment-receipt.json", { ok: true, status: "passed", exitCode: 0, target: { ...benchmark.target, grep: null },
      artifacts: { testResultsJson: f.candidate.path }, ...change });
    const pins = f.capture();
    expect(pins.PW_AGENT_REVIEW_ENROLLMENT_SHA256).toBe(Object.keys(change).length ? undefined : f.candidate.sha256);
    expect(pins.PW_AGENT_REVIEW_SECURITY_SHA256).toBe(f.securityReport.sha256);
    expect(pins.PW_AGENT_REVIEW_CANDIDATE_1_SHA256).toBeUndefined();
  }
});
