import path from "node:path";
import policy from "../../../agents/performance/policy.json";
import { authorizeAgentRequest, claimAgentJob } from "../agents/governance";
import { runPlaywrightTarget } from "../execution/runPlaywrightTarget";
import { differingFields, readObservation, type Observation } from "./evidence";
import { cleanRevision } from "./revision";

export const tool = {
  name: policy.action,
  description: "Assess task submission against the last CI-accepted main revision at the job's cutoff.",
  inputSchema: { type: "object" as const, properties: {}, additionalProperties: false as const },
};

interface RunEvidence {
  status: string;
  report: string | null;
  errorCode?: string;
  revision?: string;
  sha256?: string;
  medianMs?: number;
}

export function assessPerformance(name: unknown, args: unknown, env = process.env,
  run = runPlaywrightTarget, revision = cleanRevision) {
  const runs: RunEvidence[] = [];
  let baseline: (Pick<Observation, "revision" | "sha256" | "medianMs" | "initialTasks" | "harnessRevision"> & { acceptanceRun: string }) | undefined;
  let limitMs: number | undefined;
  const grant = authorizeAgentRequest(tool.name, name, args, env, revision);
  type Status = "denied" | "insufficient_evidence" | "within_budget" | "regression_reproduced";
  const result = (status: Status, reason: string) => ({
    schemaVersion: 1, policyVersion: policy.version, jobId: grant.ok ? grant.jobId : null,
    revision: grant.ok ? grant.revision : null, status, reason, baseline, limitMs, runs,
  });
  if (!grant.ok) return result("denied", grant.reason);

  const approvedRevision = grant.revision;
  const file = env.PW_AGENT_BASELINE_FILE;
  const pin = env.PW_AGENT_BASELINE_SHA256;
  const mainRevision = env.PW_AGENT_MAIN_REVISION;
  const acceptanceRun = env.PW_AGENT_MAIN_CI_RUN;
  if (!file || !path.isAbsolute(file) || !pin || !/^[0-9a-f]{64}$/.test(pin) ||
      !mainRevision || !/^[0-9a-f]{40}$/.test(mainRevision) || !acceptanceRun || !/^[1-9][0-9]*$/.test(acceptanceRun))
    return result("insufficient_evidence", "Prepare a baseline from accepted main for this job.");

  let reference: Observation;
  try {
    reference = readObservation(file, pin);
    if (reference.revision !== mainRevision || reference.harnessRevision !== approvedRevision)
      return result("insufficient_evidence", "Baseline evidence must identify accepted main and the approved comparison harness.");
    baseline = { revision: reference.revision, sha256: reference.sha256, medianMs: reference.medianMs,
      initialTasks: reference.initialTasks, harnessRevision: reference.harnessRevision, acceptanceRun };
  } catch {
    return result("insufficient_evidence", "The pinned baseline is unavailable, invalid, or lacks clean revision evidence.");
  }

  const claimError = claimAgentJob("performance", grant.jobId);
  if (claimError) return result("denied", claimError);
  limitMs = reference.medianMs + Math.max(policy.minimumAllowanceMs, reference.medianMs * policy.relativeAllowance);
  for (let index = 0; index < 2; index++) {
    if (revision() !== approvedRevision) return result("denied", "The authorized checkout changed before execution.");
    const native = run({ ...policy.target });
    const report = native.artifacts.testResultsJson;
    const evidence: RunEvidence = { status: native.status, report, errorCode: native.error?.code };
    runs.push(evidence);
    if (!native.ok || native.status !== "passed" || !report)
      return result("insufficient_evidence", "The wrapper did not obtain a passing benchmark. Inspect its native judgment.");

    let observation: Observation;
    try { observation = readObservation(report); }
    catch { return result("insufficient_evidence", "The candidate lacks valid measurements or clean revision evidence."); }
    Object.assign(evidence, { sha256: observation.sha256, medianMs: observation.medianMs, revision: observation.revision });
    const mismatch = differingFields(reference, observation);
    if (mismatch.length) return result("insufficient_evidence", "Non-comparable fields: " + mismatch.join(", "));
    if (observation.revision !== approvedRevision || observation.harnessRevision !== approvedRevision || revision() !== approvedRevision)
      return result("insufficient_evidence", "The measured revision does not match the host authorization.");
    if (observation.sha256 === reference.sha256 ||
        (index === 1 && (observation.sha256 === runs[0].sha256 || observation.revision !== runs[0].revision)))
      return result("insufficient_evidence", "Independent evidence at a consistent candidate revision is required.");
    if (observation.medianMs <= limitMs) {
      return index === 0 ? result("within_budget", "The measured median is within the comparison budget.")
        : result("insufficient_evidence", "The confirmation run did not reproduce the initial overrun.");
    }
  }
  return result("regression_reproduced", "Two comparable, independent candidate runs exceeded the comparison budget.");
}
