import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import policy from "../../../agents/contrarian/policy.json";
import reportingPolicy from "../../../agents/reporting/policy.json";
import { authorizeAgentRequest } from "../agents/governance";
import { cleanRevision } from "../performance/revision";
import { isDigest, maxNativeBytes, readPinnedBytes, readPinnedJson, record, requireEvidence, reviewNativePins } from "../reporting/pinnedEvidence";
import { reportingTool, summarizeEvidence, type ReportingResult } from "../reporting/summarizeEvidence";
import { verifyNativeFindings } from "./nativeChecks";
import { requireNativeJob } from "./nativeJob";
import { reviewSuite } from "./suiteReview";

export const contrarianTool = {
  name: policy.action,
  description: "Review this job's verdict against discovery, native reports and the upstream pipeline result.",
  inputSchema: { type: "object" as const, properties: {}, additionalProperties: false as const },
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
};

export interface VerdictReview {
  schemaVersion: 1;
  policyVersion: number;
  jobId: string | null;
  revision: string | null;
  status: "approved" | "failure_confirmed" | "needs_review" | "denied";
  advance: boolean;
  reason: string;
  upstreamResult: string | null;
  reportedStatus: ReportingResult["status"] | null;
  manifestSha256: string | null;
  summarySha256: string | null;
  planSha256: string | null;
  suite: Omit<ReturnType<typeof reviewSuite>, "challenges"> | null;
  confirmedFailures: ("suite" | "security" | "performance")[];
  challenges: string[];
}

export function reviewVerdict(name: unknown, args: unknown, env = process.env,
  revision?: () => string | null, root = path.resolve(__dirname, "../../..")): VerdictReview {
  const checkRevision = revision ?? (() => cleanRevision(root));
  const grant = authorizeAgentRequest(contrarianTool.name, name, args, env, checkRevision);
  const result: VerdictReview = {
    schemaVersion: 1, policyVersion: policy.version, jobId: grant.ok ? grant.jobId : null,
    revision: grant.ok ? grant.revision : null, status: "needs_review", advance: false,
    reason: "Resolve the evidence challenges before proceeding.", upstreamResult: null, reportedStatus: null,
    manifestSha256: null, summarySha256: null, planSha256: null, suite: null, confirmedFailures: [], challenges: [],
  };
  const deny = (reason: string): VerdictReview => ({ ...result, status: "denied", reason });
  if (!grant.ok) return deny(grant.reason);

  const upstream = env.PW_AGENT_UPSTREAM_RESULT;
  if (upstream && ["success", "failure", "cancelled", "skipped"].includes(upstream)) result.upstreamResult = upstream;
  if (upstream !== "success" && upstream !== "failure") result.challenges.push("upstream_incomplete");
  if (!["linux", "darwin", "win32"].includes(env.PW_AGENT_PRODUCER_PLATFORM ?? ""))
    result.challenges.push("producer_platform_unverified");
  const evidence = summarizeEvidence(reportingTool.name, {}, env, checkRevision, root);
  if (evidence.status === "denied") return deny(evidence.reason);
  result.manifestSha256 = evidence.manifestSha256;
  if (!evidence.manifestSha256) result.challenges.push("manifest_unverified");

  try {
    const pin = env.PW_AGENT_REVIEW_SUMMARY_SHA256;
    requireEvidence(isDigest(pin));
    const claim = record(readPinnedJson(root, grant, "summary.json", pin, reportingPolicy.maxFindingBytes));
    result.summarySha256 = pin;
    if (claim.status === "passed" || claim.status === "failed" || claim.status === "inconclusive" || claim.status === "denied")
      result.reportedStatus = claim.status;
    if (!isDeepStrictEqual(claim, evidence)) result.challenges.push("summary_disagrees_with_evidence");
  } catch { result.challenges.push("summary_unverified"); }

  if (evidence.suite?.status !== "passed" && evidence.suite?.status !== "failed")
    result.challenges.push("suite_verdict_incomplete");
  if (evidence.suite?.missingProjects?.length) result.challenges.push("suite_project_missing");
  try {
    const planPin = env.PW_AGENT_REVIEW_PLAN_SHA256;
    requireEvidence(isDigest(planPin) && isDigest(evidence.suite?.sha256));
    const plan = readPinnedJson(root, grant, "suite-plan.json", planPin, reportingPolicy.maxSuiteBytes);
    const native = readPinnedJson(root, grant, "suite.json", evidence.suite.sha256, reportingPolicy.maxSuiteBytes);
    requireNativeJob(plan, grant.jobId, grant.revision);
    requireNativeJob(native, grant.jobId, grant.revision);
    const { challenges, ...counts } = reviewSuite(plan, native, env.PW_AGENT_PRODUCER_PLATFORM);
    result.planSha256 = planPin;
    result.suite = counts;
    result.challenges.push(...challenges);
    if (evidence.suite.knownFailure && counts.plannedFailures) result.confirmedFailures.push("suite");
  } catch { result.challenges.push("suite_inventory_unverified"); }

  const mode = env.PW_AGENT_REVIEW_PERFORMANCE ?? "required";
  if (mode === "required" || mode === "initial-enrollment") {
    const native = verifyNativeFindings(evidence, file => {
      const pin = env[reviewNativePins[file]];
      requireEvidence(isDigest(pin));
      return readPinnedBytes(root, grant, file, pin, maxNativeBytes);
    }, mode, { mainRevision: env.PW_AGENT_MAIN_REVISION, acceptanceRun: env.PW_AGENT_MAIN_CI_RUN,
      baselineSha256: env.PW_AGENT_BASELINE_SHA256 });
    result.confirmedFailures.push(...native.failures);
    result.challenges.push(...native.concerns);
  } else result.challenges.push("performance_mode_unrecognized");

  if (checkRevision() !== grant.revision) return { ...deny("The checkout changed during review."),
    suite: null, reportedStatus: null, manifestSha256: null, planSha256: null, summarySha256: null,
    confirmedFailures: [], challenges: [] };
  if (result.reportedStatus === "failed" && !result.confirmedFailures.length) result.challenges.push("reported_failure_unconfirmed");
  if (upstream === "failure" && !result.confirmedFailures.length) result.challenges.push("upstream_failure_unexplained");
  if (result.confirmedFailures.length) {
    if (upstream === "success" || result.reportedStatus === "passed") result.challenges.push("green_with_confirmed_failure");
    result.status = "failure_confirmed";
    result.reason = "Native evidence confirms an unexpected outcome. Keep the pipeline blocked.";
  } else if (upstream === "success" && evidence.status === "passed" && result.reportedStatus === "passed" && !result.challenges.length) {
    result.status = "approved";
    result.advance = true;
    result.reason = "The reported pass agrees with the planned cases, native checks and pipeline result.";
  } else if (!result.challenges.length) result.challenges.push("evidence_incomplete");
  return result;
}
