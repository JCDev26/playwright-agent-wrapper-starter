import { createHash } from "node:crypto";
import { realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import performancePolicy from "../agents/performance/policy.json";
import reportingPolicy from "../agents/reporting/policy.json";
import securityPolicy from "../agents/security/policy.json";
import { jobDirectory } from "../src/playwright-wrapper/agents/governance";
import { EvidenceIssue, fields, isDigest, maxNativeBytes, parseEvidenceJson, parseManifest, readEvidenceBytes,
  readPinnedBytes, readPinnedJson, readWrapperReport, record, requireEvidence, requireJob, reviewNativePins,
  type Job, type NativeFile } from "../src/playwright-wrapper/reporting/pinnedEvidence";

type Mode = "required" | "initial-enrollment";
function attempt<T>(source: string, collect: () => T): T | undefined {
  try { return collect(); }
  catch (error) {
    const reason = error instanceof EvidenceIssue ? error.message : "capture_failed";
    console.error("Could not capture " + source + " (" + reason + ").");
  }
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function checkSummary(value: unknown, job: Job, manifestPin: string) {
  const summary = record(value);
  requireJob(summary, job);
  requireEvidence(summary.schemaVersion === 1 && summary.policyVersion === reportingPolicy.version &&
    summary.manifestSha256 === manifestPin && ["passed", "failed", "inconclusive", "denied"].some(status => summary.status === status),
    "invalid_reporting_summary");
}

// Operator only. Sources come from host bindings or the current job's pinned receipts.
export function captureReviewInputs(job: Job, mode: Mode, env: NodeJS.ProcessEnv) {
  const root = realpathSync.native(process.cwd());
  const directory = jobDirectory("reporting", job.jobId);
  // Claim before reading or copying. A retry or concurrent caller cannot bless old destination bytes.
  writeFileSync(path.join(directory, "review-inputs.claim"), mode + "\n", { flag: "wx", mode: 0o600 });
  const result: Record<string, string> = { PW_AGENT_REVIEW_PERFORMANCE: mode };
  const cap = reportingPolicy.maxFindingBytes;
  // Preserve the preparer's actual anchors even if the selected enrollment mode contradicts them.
  if (env.PW_AGENT_MAIN_REVISION && /^[0-9a-f]{40}$/.test(env.PW_AGENT_MAIN_REVISION))
    result.PW_AGENT_MAIN_REVISION = env.PW_AGENT_MAIN_REVISION;
  if (env.PW_AGENT_MAIN_CI_RUN && /^[1-9][0-9]{0,31}$/.test(env.PW_AGENT_MAIN_CI_RUN))
    result.PW_AGENT_MAIN_CI_RUN = env.PW_AGENT_MAIN_CI_RUN;
  if (isDigest(env.PW_AGENT_BASELINE_SHA256)) result.PW_AGENT_BASELINE_SHA256 = env.PW_AGENT_BASELINE_SHA256;

  function copy(name: NativeFile, reference: unknown, pin?: unknown) {
    requireEvidence(pin === undefined || isDigest(pin), "invalid_native_pin");
    const bytes = readWrapperReport(root, reference, name === "baseline-native.json" ? "baseline" : "receipt");
    const digest = sha256(bytes);
    requireEvidence(pin === undefined || pin === digest, "digest_mismatch");
    writeFileSync(path.join(jobDirectory("reporting", job.jobId), name), bytes, { flag: "wx", mode: 0o600 });
    readPinnedBytes(root, job, name, digest, maxNativeBytes);
    result[reviewNativePins[name]] = digest;
  }

  const manifestPin = env.PW_AGENT_REPORT_MANIFEST_SHA256;
  const manifest = attempt("manifest", () => {
    requireEvidence(isDigest(manifestPin), "manifest_pin_required");
    return parseManifest(readPinnedJson(root, job, "manifest.json", manifestPin, reportingPolicy.maxManifestBytes), job);
  });
  if (manifest && manifestPin) {
    attempt("summary", () => {
      const bytes = readEvidenceBytes(root, job, "summary.json", cap);
      checkSummary(parseEvidenceJson(bytes), job, manifestPin);
      result.PW_AGENT_REVIEW_SUMMARY_SHA256 = sha256(bytes);
    });
  }
  const security = manifest?.security;
  if (security) {
    attempt("security-native", () => {
      const receipt = record(readPinnedJson(root, job, "security.json", security.sha256, cap));
      requireJob(receipt, job);
      requireEvidence(receipt.schemaVersion === 1 && receipt.policyVersion === securityPolicy.version &&
        ["checks_passed", "checks_failed", "insufficient_evidence", "denied"].some(status => receipt.status === status),
        "invalid_security_receipt");
      const report = fields(receipt.report, ["path", "sha256"]);
      requireEvidence(isDigest(report.sha256), "native_pin_required");
      copy("security-native.json", report.path, report.sha256);
    });
  }
  if (mode === "required") {
    if (isDigest(env.PW_AGENT_BASELINE_SHA256)) {
      attempt("baseline-native", () => copy("baseline-native.json", env.PW_AGENT_BASELINE_FILE, env.PW_AGENT_BASELINE_SHA256));
    }
    const enrolled = manifest?.performance.sha256;
    if (enrolled) {
      attempt("performance receipt", () => {
        const receipt = record(readPinnedJson(root, job, "performance.json", enrolled, cap));
        requireJob(receipt, job);
        requireEvidence(receipt.schemaVersion === 1 && receipt.policyVersion === performancePolicy.version &&
          ["within_budget", "regression_reproduced", "insufficient_evidence", "denied"].some(status => receipt.status === status) &&
          Array.isArray(receipt.runs) && receipt.runs.length <= 2, "invalid_performance_receipt");
        for (const [i, value] of receipt.runs.entries()) {
          const name = i === 0 ? "candidate-1-native.json" : "candidate-2-native.json";
          attempt(name, () => {
            const run = record(value);
            requireEvidence(["passed", "failed", "execution_error", "validation_error"].some(status => run.status === status),
              "invalid_native_status");
            copy(name, run.report, run.sha256);
          });
        }
      });
    }
  } else if (manifest && !manifest.performance.expected) {
    attempt("enrollment-native", () => {
      const receipt = record(parseEvidenceJson(readEvidenceBytes(root, job, "enrollment-receipt.json", cap)));
      const target = fields(receipt.target, ["project", "spec", "grep", "workers", "headed"]);
      const benchmark = performancePolicy.target;
      requireEvidence(receipt.ok === true && receipt.status === "passed" && receipt.exitCode === 0 &&
        receipt.error === undefined && target.project === benchmark.project && target.spec === benchmark.spec &&
        (target.grep === null || target.grep === benchmark.grep) && target.workers === benchmark.workers &&
        target.headed === benchmark.headed, "invalid_enrollment_receipt");
      copy("enrollment-native.json", record(receipt.artifacts).testResultsJson);
    });
  }
  return result;
}
