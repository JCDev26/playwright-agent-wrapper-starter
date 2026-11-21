import performancePolicy from "../../../agents/performance/policy.json";
import securityPolicy from "../../../agents/security/policy.json";
import { fields, isDigest, requireEvidence, requireJob, type Job, type Lane } from "./pinnedEvidence";

const nativeStatuses = ["passed", "failed", "execution_error", "validation_error"] as const;
function oneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === "string" && options.some(option => option === value);
}
function boundedText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 4096;
}
function revision(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
}
function milliseconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function summarizeSecurity(value: unknown, job: Job) {
  const obj = fields(value, ["schemaVersion", "policyVersion", "jobId", "revision", "status",
    "reason", "checks", "nativeStatus", "report"]);
  requireJob(obj, job);
  requireEvidence(obj.schemaVersion === 1 && obj.policyVersion === securityPolicy.version &&
    boundedText(obj.reason) && Array.isArray(obj.checks) && obj.checks.length === securityPolicy.checks.length &&
    (obj.nativeStatus === null || oneOf(obj.nativeStatus, nativeStatuses)), "invalid_security_finding");
  let nativeReportSha256: string | null = null;
  if (obj.report !== null) {
    const link = fields(obj.report, ["path", "sha256"]);
    requireEvidence(boundedText(link.path) && isDigest(link.sha256), "invalid_report_reference");
    nativeReportSha256 = link.sha256;
  }
  const claimed = obj.checks.map(item => fields(item, ["id", "status"]));
  const checks = securityPolicy.checks.map(({ id }) => {
    const check = claimed.find(entry => entry.id === id);
    requireEvidence(check && oneOf(check.status, ["passed", "failed", "inconclusive"] as const),
      "invalid_security_checks");
    return { id, status: check.status };
  });
  const failed = checks.some(check => check.status === "failed");
  const partial = checks.some(check => check.status === "inconclusive");
  if (checks.some(check => check.status !== "inconclusive"))
    requireEvidence(obj.report !== null && (obj.nativeStatus === "passed" || obj.nativeStatus === "failed"));
  if (failed) requireEvidence(obj.nativeStatus === "failed");
  const decision = obj.status;
  let status: Lane["status"] = "inconclusive";
  switch (decision) {
    case "checks_passed":
      requireEvidence(!partial && !failed && obj.nativeStatus === "passed");
      status = "passed";
      break;
    case "checks_failed":
      requireEvidence(failed && obj.nativeStatus === "failed");
      status = "failed";
      break;
    case "insufficient_evidence": requireEvidence(partial && !failed); break;
    case "denied":
      requireEvidence(obj.nativeStatus === null && obj.report === null && checks.every(c => c.status === "inconclusive"));
      break;
    default: requireEvidence(false, "unknown_security_decision");
  }
  return { status, reason: decision, knownFailure: failed, partial,
    evidence: "host_attested_finding" as const, decision, nativeStatus: obj.nativeStatus, nativeReportSha256, checks };
}

function performanceBaseline(value: unknown, job: Job) {
  const data = fields(value, ["revision", "sha256", "medianMs", "initialTasks", "harnessRevision", "acceptanceRun"]);
  requireEvidence(revision(data.revision) && isDigest(data.sha256) && milliseconds(data.medianMs) &&
    data.initialTasks === performancePolicy.initialTasks && data.harnessRevision === job.revision &&
    typeof data.acceptanceRun === "string" && /^[1-9][0-9]{0,31}$/.test(data.acceptanceRun), "invalid_baseline");
  return { revision: data.revision, harnessRevision: job.revision, sha256: data.sha256, medianMs: data.medianMs, initialTasks: data.initialTasks,
    acceptanceRun: data.acceptanceRun };
}

function performanceRun(value: unknown) {
  const run = fields(value, ["status", "report"], ["errorCode", "revision", "sha256", "medianMs"]);
  requireEvidence(oneOf(run.status, nativeStatuses) && (run.report === null || boundedText(run.report)) &&
    (run.errorCode === undefined || boundedText(run.errorCode)), "invalid_performance_run");
  if (run.sha256 === undefined && run.medianMs === undefined && run.revision === undefined)
    return { nativeStatus: run.status, measurement: null };
  requireEvidence(run.status === "passed" && run.report !== null && isDigest(run.sha256) &&
    revision(run.revision) && milliseconds(run.medianMs), "invalid_performance_measurement");
  return { nativeStatus: run.status, measurement: { sha256: run.sha256, revision: run.revision, medianMs: run.medianMs } };
}

export function summarizePerformance(value: unknown, job: Job) {
  const obj = fields(value, ["schemaVersion", "policyVersion", "jobId", "revision", "status", "reason", "runs"],
    ["baseline", "limitMs"]);
  requireJob(obj, job);
  requireEvidence(obj.schemaVersion === 1 && obj.policyVersion === performancePolicy.version &&
    boundedText(obj.reason) && Array.isArray(obj.runs) && obj.runs.length <= 2, "invalid_performance_finding");
  const baseline = obj.baseline === undefined ? null : performanceBaseline(obj.baseline, job);
  const limitMs = obj.limitMs;
  if (limitMs !== undefined) {
    requireEvidence(baseline && milliseconds(limitMs) && limitMs === baseline.medianMs +
      Math.max(performancePolicy.minimumAllowanceMs, baseline.medianMs * performancePolicy.relativeAllowance),
      "inconsistent_budget");
  }
  const runs = obj.runs.map(performanceRun);
  if (runs.length > 0) requireEvidence(baseline && limitMs !== undefined, "missing_performance_context");
  const decision = obj.status;
  let status: Lane["status"] = "inconclusive";
  if (decision === "within_budget" || decision === "regression_reproduced") {
    const passing = decision === "within_budget";
    requireEvidence(baseline && milliseconds(limitMs) && runs.length === (passing ? 1 : 2), "incomplete_comparison");
    const digests = new Set([baseline.sha256]);
    for (const { measurement } of runs) {
      requireEvidence(measurement && measurement.revision === job.revision && !digests.has(measurement.sha256) &&
        (passing ? measurement.medianMs <= limitMs : measurement.medianMs > limitMs), "inconsistent_comparison");
      digests.add(measurement.sha256);
    }
    status = passing ? "passed" : "failed";
  } else {
    requireEvidence(decision === "insufficient_evidence" || decision === "denied", "unknown_performance_decision");
  }
  return { status, reason: decision, knownFailure: decision === "regression_reproduced",
    partial: status === "inconclusive", evidence: "host_attested_finding" as const, decision, baseline,
    limitMs: typeof limitMs === "number" ? limitMs : null, runs };
}
