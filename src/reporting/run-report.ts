export type CheckStatus = "passed" | "failed" | "inconclusive" | "not-run";
export interface RunCheck {
  name: string;
  status: CheckStatus;
  evidence: string[];
  durationMs?: number;
}
export interface RunContext {
  taskId: string;
  repository: string;
  commit: string;
  environment: { platform: string; toolVersions: Record<string, string>; capabilities: string[] };
  observedAt: string;
}
export interface VisualApplicability {
  applicability: "unknown" | "applicable" | "not-applicable";
  rationale?: string;
}
export interface RunReport extends RunContext {
  schemaVersion: 1;
  checks: RunCheck[];
  technical: "passed" | "failed" | "inconclusive";
  visual: "unknown" | "review-required" | "not-applicable" | "passed" | "failed" | "inconclusive";
  visualApplicability: VisualApplicability;
  ownerApproval: "pending" | "approved" | "rejected" | "not-required";
}

/** An observation only. This object grants no publication/merge authority. */
export function createRunReport(context: RunContext, checks: RunCheck[],
  visualApplicability: VisualApplicability = { applicability: "unknown" }): RunReport {
  if (!["unknown", "applicable", "not-applicable"].includes(visualApplicability.applicability)
      || (visualApplicability.applicability === "not-applicable" && !visualApplicability.rationale?.trim())) {
    throw new Error("Visual non-applicability requires an explicit caller rationale.");
  }
  if (!context.taskId.trim() || !/^[^/\s]+\/[^/\s]+$/.test(context.repository)
      || !/^[a-f0-9]{40}$/.test(context.commit)
      || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(context.observedAt)
      || !Number.isFinite(Date.parse(context.observedAt))) {
    throw new Error("Run provenance requires a task, repository, full commit and UTC observation time.");
  }
  for (const check of checks) {
    if (!check.name.trim() || !["passed", "failed", "inconclusive", "not-run"].includes(check.status)
        || (check.durationMs !== undefined && (!Number.isFinite(check.durationMs) || check.durationMs < 0))) {
      throw new Error("Invalid check observation.");
    }
  }
  return {
    ...context,
    environment: { ...context.environment, toolVersions: { ...context.environment.toolVersions },
      capabilities: [...context.environment.capabilities] },
    schemaVersion: 1,
    checks: checks.map(check => ({ ...check, evidence: [...check.evidence] })),
    technical: checks.some(check => check.status === "failed") ? "failed"
      : checks.length === 0 || checks.some(check => check.status !== "passed") ? "inconclusive" : "passed",
    visual: visualApplicability.applicability === "not-applicable" ? "not-applicable"
      : visualApplicability.applicability === "applicable" ? "review-required" : "unknown",
    visualApplicability: { ...visualApplicability },
    ownerApproval: "pending",
  };
}
