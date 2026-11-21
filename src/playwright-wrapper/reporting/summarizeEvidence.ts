import path from "node:path";
import policy from "../../../agents/reporting/policy.json";
import { authorizeAgentRequest } from "../agents/governance";
import { cleanRevision } from "../performance/revision";
import { EvidenceIssue, isDigest, parseManifest, readPinnedJson, type Job, type Lane } from "./pinnedEvidence";
import { summarizePerformance, summarizeSecurity } from "./specialistSummaries";
import { summarizeSuite } from "./suiteSummary";

export const reportingTool = {
  name: policy.action,
  description: "Summarize the host-pinned Playwright suite and specialist findings for this job.",
  inputSchema: { type: "object" as const, properties: {}, additionalProperties: false as const },
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
};

type Source = "suite" | "security" | "performance";
type View<T extends Lane> = Lane & Partial<Omit<T, keyof Lane>> & { sha256?: string };
export interface ReportingResult {
  schemaVersion: 1;
  policyVersion: number;
  jobId: string | null;
  revision: string | null;
  manifestSha256: string | null;
  status: "passed" | "failed" | "inconclusive" | "denied";
  coverage: "complete" | "partial";
  reason: string;
  knownFailures: Source[];
  incompleteSources: (Source | "manifest")[];
  suite: View<ReturnType<typeof summarizeSuite>> | null;
  security: View<ReturnType<typeof summarizeSecurity>> | null;
  performance: View<ReturnType<typeof summarizePerformance>> | null;
}

function unavailable(error: unknown): Lane {
  return { status: error instanceof EvidenceIssue ? error.status : "invalid",
    reason: error instanceof EvidenceIssue ? error.message : "invalid_evidence", knownFailure: false, partial: true };
}

function readLane<T extends Lane>(root: string, job: Job, source: Source, pin: string | null,
  summarize: (value: unknown) => T): Lane | (T & { sha256: string }) {
  if (pin === null) return unavailable(new EvidenceIssue("missing", "not_enrolled"));
  try {
    const limit = source === "suite" ? policy.maxSuiteBytes : policy.maxFindingBytes;
    const value = readPinnedJson(root, job, `${source}.json`, pin, limit);
    return { ...summarize(value), sha256: pin };
  } catch (error) { return unavailable(error); }
}

export function summarizeEvidence(name: unknown, args: unknown, env = process.env,
  revision?: () => string | null, root = path.resolve(__dirname, "../../..")): ReportingResult {
  const checkRevision = revision ?? (() => cleanRevision(root));
  const grant = authorizeAgentRequest(reportingTool.name, name, args, env, checkRevision);
  const result: ReportingResult = {
    schemaVersion: 1, policyVersion: policy.version, jobId: grant.ok ? grant.jobId : null,
    revision: grant.ok ? grant.revision : null, manifestSha256: null, status: "inconclusive", coverage: "partial",
    reason: "manifest_pin_required", knownFailures: [], incompleteSources: ["manifest"],
    suite: null, security: null, performance: null,
  };
  if (!grant.ok) return { ...result, status: "denied", reason: grant.reason };
  const pin = env.PW_AGENT_REPORT_MANIFEST_SHA256;
  if (!isDigest(pin)) return result;
  let manifest;
  try {
    manifest = parseManifest(readPinnedJson(root, grant, "manifest.json", pin, policy.maxManifestBytes), grant);
  } catch (error) { return { ...result, reason: unavailable(error).reason }; }

  const suite = readLane(root, grant, "suite", manifest.suite?.sha256 ?? null,
    value => summarizeSuite(value, manifest.suite!.exitCode));
  const security = readLane(root, grant, "security", manifest.security?.sha256 ?? null,
    value => summarizeSecurity(value, grant));
  const performance = manifest.performance.expected
    ? readLane(root, grant, "performance", manifest.performance.sha256, value => summarizePerformance(value, grant))
    : { status: "not_scheduled" as const, reason: "not_scheduled_by_host", knownFailure: false, partial: false };
  if (checkRevision() !== grant.revision) return { ...result, status: "denied", reason: "checkout_changed" };

  const sources = { suite, security, performance };
  const names: Source[] = ["suite", "security", "performance"];
  const knownFailures = names.filter(source => sources[source].knownFailure);
  const incompleteSources = names.filter(source => sources[source].partial);
  const completeOutcomes = names.every(source => ["passed", "not_scheduled"].includes(sources[source].status));
  const status = knownFailures.length ? "failed" : completeOutcomes ? "passed" : "inconclusive";
  return { ...result, suite, security, performance, knownFailures, incompleteSources, status,
    coverage: incompleteSources.length ? "partial" : "complete", manifestSha256: pin,
    reason: status === "failed" ? "observed_failure" : status === "inconclusive" ? "incomplete_evidence" : "outcomes_checked" };
}
