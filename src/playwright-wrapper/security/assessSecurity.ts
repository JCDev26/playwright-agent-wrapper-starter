import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import policy from "../../../agents/security/policy.json";
import { authorizeAgentRequest, claimAgentJob } from "../agents/governance";
import type { PlaywrightRunStatus } from "../contract/resultSchema";
import { runPlaywrightTarget } from "../execution/runPlaywrightTarget";
import { cleanRevision } from "../performance/revision";
import { readSecurityEvidence, type SecurityCheck } from "./evidence";

export const securityTool = {
  name: policy.action,
  description: "Check the authorized local task board's rendering, update validation and cache behavior.",
  inputSchema: { type: "object" as const, properties: {}, additionalProperties: false as const },
};

export interface SecurityFinding {
  schemaVersion: 1;
  policyVersion: number;
  jobId: string | null;
  revision: string | null;
  status: "checks_passed" | "checks_failed" | "insufficient_evidence" | "denied";
  reason: string;
  checks: SecurityCheck[];
  nativeStatus: PlaywrightRunStatus | null;
  report: { path: string; sha256: string } | null;
}

export function assessSecurity(name: unknown, args: unknown, env = process.env,
  run = runPlaywrightTarget, revision = cleanRevision): SecurityFinding {
  const finding: SecurityFinding = {
    schemaVersion: 1, policyVersion: policy.version, jobId: null, revision: null, nativeStatus: null, report: null,
    status: "insufficient_evidence", reason: "The wrapper did not obtain completed security checks.",
    checks: policy.checks.map(({ id }) => ({ id, status: "inconclusive" })),
  };
  const denied = (reason: string): SecurityFinding => ({ ...finding, status: "denied", reason });
  const grant = authorizeAgentRequest(securityTool.name, name, args, env, revision);
  if (!grant.ok) return denied(grant.reason);
  finding.jobId = grant.jobId;
  finding.revision = grant.revision;
  const denial = claimAgentJob("security", grant.jobId);
  if (denial) return denied(denial);
  if (revision() !== grant.revision) return denied("The authorized checkout changed before execution.");

  let native: ReturnType<typeof run>;
  try { native = run({ ...policy.target }); }
  catch { return { ...finding, reason: "The wrapper could not complete the security run." }; }
  finding.nativeStatus = native.status;
  const file = native.artifacts.testResultsJson;
  try {
    let bytes: Buffer | undefined;
    if (file) {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error("Invalid report size or type.");
      bytes = readFileSync(file);
      finding.report = { path: file, sha256: createHash("sha256").update(bytes).digest("hex") };
    }
    if (revision() !== grant.revision)
      return { ...finding, reason: "The checkout changed during the assessment." };
    if (!native.ok || (native.status !== "passed" && native.status !== "failed") ||
        !bytes || native.exitCode !== (native.status === "passed" ? 0 : 1))
      return { ...finding, reason: native.error ? "The wrapper reported " + native.error.code + "." : finding.reason };
    finding.checks = readSecurityEvidence(bytes, native.status);
  } catch {
    return { ...finding, reason: "The native report could not establish the checks and execution settings required by policy." };
  }
  if (finding.checks.some(check => check.status === "failed"))
    return { ...finding, status: "checks_failed", reason: "The listed failed checks observed a task-board contract violation." };
  if (finding.checks.some(check => check.status === "inconclusive"))
    return { ...finding, reason: "At least one contract lacks a matching observation and completed first attempt." };
  return { ...finding, status: "checks_passed", reason: "All listed task-board contracts passed on the authorized revision." };
}
