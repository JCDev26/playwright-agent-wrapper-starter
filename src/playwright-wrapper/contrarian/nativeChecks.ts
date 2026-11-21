import { createHash } from "node:crypto";
import performancePolicy from "../../../agents/performance/policy.json";
import { jobIdPattern } from "../agents/governance";
import { differingFields, readObservation, type Observation } from "../performance/evidence";
import { isDigest, maxNativeBytes, parseEvidenceJson, type NativeFile } from "../reporting/pinnedEvidence";
import type { ReportingResult } from "../reporting/summarizeEvidence";
import { readSecurityEvidence } from "../security/evidence";
import { requireNativeJob } from "./nativeJob";

export type { NativeFile };
type ReadNative = (name: NativeFile) => Buffer;
type Anchors = { mainRevision?: string; acceptanceRun?: string; baselineSha256?: string };
type Failure = "security" | "performance";

function securityObservation(bytes: Buffer) {
  try { return { nativeStatus: "passed", checks: readSecurityEvidence(bytes, "passed") }; }
  catch { return { nativeStatus: "failed", checks: readSecurityEvidence(bytes, "failed") }; }
}

function checkSecurity(receipt: ReportingResult["security"], read: ReadNative, concerns: Set<string>): boolean {
  let observed: ReturnType<typeof securityObservation>;
  try {
    if (!isDigest(receipt?.nativeReportSha256)) throw new Error();
    const bytes = read("security-native.json");
    if (createHash("sha256").update(bytes).digest("hex") !== receipt.nativeReportSha256) throw new Error();
    observed = securityObservation(bytes);
  } catch {
    concerns.add("security_native_unverified");
    return false;
  }
  const failure = observed.checks.some(check => check.status === "failed");
  const incomplete = observed.checks.some(check => check.status === "inconclusive");
  const decision = failure ? "checks_failed" : incomplete ? "insufficient_evidence" : "checks_passed";
  if (incomplete) concerns.add("security_checks_incomplete");
  const claims = receipt.checks ?? [];
  if (decision !== receipt.decision || receipt.nativeStatus !== observed.nativeStatus ||
      claims.length !== observed.checks.length || observed.checks.some((actual, index) =>
        actual.id !== claims[index].id || actual.status !== claims[index].status))
    concerns.add("security_receipt_mismatch");
  return failure;
}

function checkComparison(report: ReportingResult, read: ReadNative, anchors: Anchors, concerns: Set<string>): boolean {
  const receipt = report.performance;
  if (receipt?.status === "not_scheduled") {
    concerns.add("performance_mode_mismatch");
    return false;
  }
  const reference = receipt?.baseline;
  let baseline: Observation;
  try {
    if (!reference || !isDigest(anchors.baselineSha256) || reference.sha256 !== anchors.baselineSha256 ||
        !anchors.mainRevision || !/^[a-f0-9]{40}$/.test(anchors.mainRevision) ||
        !anchors.acceptanceRun || !/^[1-9][0-9]{0,31}$/.test(anchors.acceptanceRun)) throw new Error();
    baseline = readObservation(read("baseline-native.json"), anchors.baselineSha256);
    if (baseline.revision !== anchors.mainRevision || baseline.harnessRevision !== report.revision) throw new Error();
  } catch {
    concerns.add("performance_baseline_unverified");
    return false;
  }

  const limitMs = baseline.medianMs + Math.max(performancePolicy.minimumAllowanceMs, baseline.medianMs * performancePolicy.relativeAllowance);
  if (reference.acceptanceRun !== anchors.acceptanceRun || reference.revision !== baseline.revision ||
      reference.harnessRevision !== baseline.harnessRevision || reference.initialTasks !== baseline.initialTasks ||
      reference.medianMs !== baseline.medianMs || receipt.limitMs !== limitMs)
    concerns.add("performance_receipt_mismatch");

  const runs = receipt.runs;
  const candidateFiles = ["candidate-1-native.json", "candidate-2-native.json"] as const;
  if (!runs?.length || runs.length > candidateFiles.length) {
    concerns.add("performance_comparison_incomplete");
    return false;
  }
  const digests = new Set([baseline.sha256]);
  const observations: Observation[] = [];
  for (const [index, run] of runs.entries()) {
    const claim = run.measurement;
    let candidate: Observation;
    try {
      if (!claim || !isDigest(claim.sha256)) throw new Error();
      candidate = readObservation(read(candidateFiles[index]), claim.sha256);
    } catch {
      concerns.add("performance_native_unverified");
      return false;
    }
    if (candidate.revision !== report.revision || candidate.harnessRevision !== report.revision ||
        digests.has(candidate.sha256) || differingFields(baseline, candidate).length) {
      concerns.add("performance_measurements_incomparable");
      return false;
    }
    if (run.nativeStatus !== "passed" || claim.medianMs !== candidate.medianMs || claim.revision !== candidate.revision)
      concerns.add("performance_receipt_mismatch");
    observations.push(candidate);
    digests.add(candidate.sha256);
  }

  const passed = observations.length === 1 && observations[0].medianMs <= limitMs;
  const failure = observations.length === 2 && observations.every(run => run.medianMs > limitMs);
  const decision = passed ? "within_budget" : failure ? "regression_reproduced" : "insufficient_evidence";
  if (!passed && !failure) concerns.add("performance_comparison_incomplete");
  if (receipt.decision !== decision) concerns.add("performance_receipt_mismatch");
  return failure;
}

/** Native snapshots come from the host's pinned job directory. Receipts cannot select a path. */
export function verifyNativeFindings(report: ReportingResult, read: ReadNative,
  performanceMode: "required" | "initial-enrollment", anchors: Anchors): { failures: Failure[]; concerns: string[] } {
  const concerns = new Set<string>();
  const failures: Failure[] = [];
  const { jobId, revision } = report;
  if (!jobId || !jobIdPattern.test(jobId) || !revision || !/^[a-f0-9]{40}$/.test(revision))
    return { failures, concerns: ["native_job_unbound"] };
  const bounded: ReadNative = name => {
    const bytes = read(name);
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxNativeBytes) throw new Error("Invalid native snapshot.");
    const raw = parseEvidenceJson(bytes);
    try { requireNativeJob(raw, jobId, revision); }
    catch (error) { concerns.add("native_job_mismatch"); throw error; }
    return bytes;
  };

  if (checkSecurity(report.security, bounded, concerns)) failures.push("security");
  if (performanceMode === "required") {
    if (checkComparison(report, bounded, anchors, concerns)) failures.push("performance");
  } else if (performanceMode === "initial-enrollment") {
    if (report.performance?.status !== "not_scheduled" || anchors.mainRevision || anchors.acceptanceRun || anchors.baselineSha256)
      concerns.add("performance_mode_mismatch");
    try {
      const enrollment = readObservation(bounded("enrollment-native.json"));
      if (enrollment.revision !== report.revision || enrollment.harnessRevision !== report.revision) throw new Error();
    } catch { concerns.add("performance_enrollment_unverified"); }
  } else concerns.add("performance_mode_mismatch");
  return { failures, concerns: [...concerns] };
}
