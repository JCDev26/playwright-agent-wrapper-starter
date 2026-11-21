import { mkdirSync } from "node:fs";
import path from "node:path";
import policy from "../../../agents/performance/policy.json";
import { runPlaywrightTarget } from "../execution/runPlaywrightTarget";
import { differingFields, readObservation, type Observation } from "./evidence";
import { cleanRevision } from "./revision";

export const tool = {
  name: policy.action,
  description: "Assess the governed task-board benchmark against the operator-pinned baseline.",
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
  let baseline: Pick<Observation, "revision" | "sha256" | "medianMs"> | undefined;
  let limitMs: number | undefined;
  type Status = "denied" | "insufficient_evidence" | "within_budget" | "regression_reproduced";
  const result = (status: Status, reason: string) => ({
    policyVersion: policy.version, status, reason, baseline, limitMs, runs,
  });
  if (name !== tool.name || args === null || typeof args !== "object" ||
      Array.isArray(args) || Object.keys(args).length !== 0)
    return result("denied", "Only the registered assessment with empty arguments is permitted.");

  const job = env.PW_AGENT_JOB_ID;
  const file = env.PW_AGENT_BASELINE_FILE;
  const pin = env.PW_AGENT_BASELINE_SHA256;
  if (!job || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(job))
    return result("denied", "A host-issued job UUID is required.");
  const approvedRevision = env.PW_AGENT_REVISION;
  if (!approvedRevision || !/^[0-9a-f]{40}$/.test(approvedRevision) || revision() !== approvedRevision)
    return result("denied", "The clean checkout must match the candidate revision authorized by the host.");
  if (!file || !path.isAbsolute(file) || !pin || !/^[0-9a-f]{64}$/.test(pin))
    return result("insufficient_evidence", "The host must bind an absolute baseline file and its approved SHA-256.");

  let reference: Observation;
  try {
    reference = readObservation(file, pin);
    baseline = { revision: reference.revision, sha256: reference.sha256, medianMs: reference.medianMs };
  } catch {
    return result("insufficient_evidence", "The pinned baseline is unavailable, invalid, or lacks clean revision evidence.");
  }

  // Atomic across simultaneous clients and server restarts in this workspace. Keep the claim after a crash.
  const ledger = path.resolve("artifacts", "performance-agent-jobs");
  try {
    mkdirSync(ledger, { recursive: true });
    mkdirSync(path.join(ledger, job));
  } catch (error) {
    return result("denied", (error as NodeJS.ErrnoException).code === "EEXIST"
      ? "This host-issued job has already been consumed." : "The wrapper could not reserve the job.");
  }
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
    if (observation.revision !== approvedRevision || revision() !== approvedRevision)
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
