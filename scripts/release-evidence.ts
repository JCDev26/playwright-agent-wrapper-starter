import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import contrarianPolicy from "../agents/contrarian/policy.json";
import reportingPolicy from "../agents/reporting/policy.json";
import { jobIdPattern } from "../src/playwright-wrapper/agents/governance";
import { requireNativeJob } from "../src/playwright-wrapper/contrarian/nativeJob";
import { reviewSuite } from "../src/playwright-wrapper/contrarian/suiteReview";
import { differingFields, readObservation } from "../src/playwright-wrapper/performance/evidence";
import { isDigest, maxNativeBytes, parseEvidenceJson, parseManifest, record, requireEvidence, requireJob } from "../src/playwright-wrapper/reporting/pinnedEvidence";
import { summarizePerformance, summarizeSecurity } from "../src/playwright-wrapper/reporting/specialistSummaries";
import { summarizeSuite } from "../src/playwright-wrapper/reporting/suiteSummary";
import { readSecurityEvidence } from "../src/playwright-wrapper/security/evidence";

const workflow = ".github/workflows/ci.yml";
const commit = /^[0-9a-f]{40}$/;
const positiveId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0;
type Api = (endpoint: string) => Promise<unknown>;

/** The release event and authenticated GitHub metadata identify the run. Artifact contents have no input here. */
export async function resolveReleaseSource(env: NodeJS.ProcessEnv, payload: unknown, api: Api) {
  const event = record(payload);
  const release = record(event.release);
  const repository = env.GITHUB_REPOSITORY;
  const revision = env.GITHUB_SHA;
  const tag = release.tag_name;
  requireEvidence(env.GITHUB_EVENT_NAME === "release" && event.action === "published" && release.draft === false &&
    positiveId(release.id) && typeof release.published_at === "string" && release.published_at.length > 0 &&
    typeof tag === "string" && tag.length > 0 && env.GITHUB_REF === "refs/tags/" + tag &&
    repository && /^[\w.-]+\/[\w.-]+$/.test(repository) && record(event.repository).full_name === repository &&
    revision && commit.test(revision), "published_release_required");
  const [liveTag, listing] = await Promise.all([
    api("commits/" + encodeURIComponent("refs/tags/" + tag)),
    api("actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=" + revision + "&per_page=1"),
  ]);
  requireEvidence(record(liveTag).sha === revision, "release_tag_changed");
  const latest = record(listing).workflow_runs;
  requireEvidence(Array.isArray(latest) && latest.length === 1, "exact_main_ci_required");
  const run = record(latest[0]);
  const runId = run.id, attempt = run.run_attempt;
  requireEvidence(positiveId(runId) && positiveId(attempt) && run.path === workflow && run.event === "push" &&
    run.head_branch === "main" && run.head_sha === revision && run.status === "completed" && run.conclusion === "success" &&
    record(run.repository).full_name === repository && record(run.head_repository).full_name === repository, "exact_successful_main_ci_required");

  async function artifact(prefix: string) {
    const name = prefix + "-" + runId + "-" + attempt;
    const response = record(await api("actions/runs/" + runId + "/artifacts?name=" + name + "&per_page=2"));
    requireEvidence(response.total_count === 1 && Array.isArray(response.artifacts) && response.artifacts.length === 1, "missing_ci_artifact");
    const item = record(response.artifacts[0]);
    const origin = record(item.workflow_run);
    requireEvidence(item.name === name && positiveId(item.id) && item.expired === false && origin.id === runId &&
      origin.head_sha === revision && typeof item.digest === "string" && /^sha256:[0-9a-f]{64}$/.test(item.digest), "unbound_ci_artifact");
    return { id: item.id, name, sha256: item.digest.slice(7) };
  }
  const [jobs, verdict, inputs] = await Promise.all([
    api("actions/runs/" + runId + "/attempts/" + attempt + "/jobs?per_page=100"), artifact("contrarian"), artifact("review-inputs"),
  ]);
  const jobList = record(jobs).jobs;
  requireEvidence(Array.isArray(jobList), "missing_verify_job");
  const verify = jobList.filter(j => j.name === "verify");
  requireEvidence(verify.length === 1 && positiveId(verify[0].id) && verify[0].status === "completed" &&
    verify[0].conclusion === "success", "verify_job_not_successful");
  return { repository, release: { id: release.id, tag }, revision,
    ci: { workflow, event: "push", branch: "main", runId, attempt, verifyJobId: verify[0].id }, artifacts: { verdict, inputs } };
}

type Source = Awaited<ReturnType<typeof resolveReleaseSource>>;

export function buildReleaseManifest(source: Source, verdictDir: string, inputsDir: string) {
  const files: { name: string; sha256: string; bytes: number }[] = [];
  function read(name: string, limit: number, pin?: unknown) {
    const directory = fs.realpathSync.native(name === "contrarian.json" ? verdictDir : inputsDir);
    const file = path.join(directory, name);
    const entry = fs.lstatSync(file);
    requireEvidence(entry.isFile() && entry.nlink === 1 && entry.size > 0 && entry.size <= limit &&
      fs.realpathSync.native(file) === file, "invalid_evidence_file");
    const bytes = fs.readFileSync(file);
    requireEvidence(bytes.length === entry.size, "evidence_changed");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (pin !== undefined) requireEvidence(isDigest(pin) && sha256 === pin, "evidence_digest_mismatch");
    files.push({ name, sha256, bytes: bytes.length });
    return bytes;
  }
  const cap = reportingPolicy.maxFindingBytes;
  const receipt = record(parseEvidenceJson(read("contrarian.json", cap)));
  requireEvidence(receipt.schemaVersion === 1 && receipt.policyVersion === contrarianPolicy.version &&
    receipt.revision === source.revision && typeof receipt.jobId === "string" && jobIdPattern.test(receipt.jobId) &&
    receipt.status === "approved" && receipt.advance === true && receipt.upstreamResult === "success" && receipt.reportedStatus === "passed" &&
    Array.isArray(receipt.challenges) && receipt.challenges.length === 0 && Array.isArray(receipt.confirmedFailures) && receipt.confirmedFailures.length === 0 &&
    isDigest(receipt.manifestSha256) && isDigest(receipt.summarySha256) && isDigest(receipt.planSha256), "contrarian_approval_required");
  const job = { jobId: receipt.jobId, revision: source.revision };
  const manifest = parseManifest(parseEvidenceJson(read("manifest.json", reportingPolicy.maxManifestBytes, receipt.manifestSha256)), job);
  const summary = record(parseEvidenceJson(read("summary.json", cap, receipt.summarySha256)));
  requireJob(summary, job);
  requireEvidence(summary.status === "passed" && summary.manifestSha256 === receipt.manifestSha256 &&
    manifest.suite?.exitCode === 0 && manifest.security, "approved_evidence_required");
  function native(name: string, max: number, pin?: string) {
    const bytes = read(name, max, pin);
    requireNativeJob(parseEvidenceJson(bytes), job.jobId, job.revision);
    return bytes;
  }
  const plan = parseEvidenceJson(native("suite-plan.json", reportingPolicy.maxSuiteBytes, receipt.planSha256));
  const suite = parseEvidenceJson(native("suite.json", reportingPolicy.maxSuiteBytes, manifest.suite.sha256));
  const suiteResult = summarizeSuite(suite, manifest.suite.exitCode);
  const { challenges, ...counts } = reviewSuite(plan, suite, "linux");
  requireEvidence(!challenges.length && suiteResult.status === "passed" && isDeepStrictEqual(counts, receipt.suite) &&
    isDeepStrictEqual(summary.suite, { ...suiteResult, sha256: manifest.suite.sha256 }), "suite_evidence_mismatch");
  const security = summarizeSecurity(parseEvidenceJson(read("security.json", cap, manifest.security.sha256)), job);
  requireEvidence(security.status === "passed" && security.nativeReportSha256 &&
    isDeepStrictEqual(summary.security, { ...security, sha256: manifest.security.sha256 }), "security_approval_required");
  const checks = readSecurityEvidence(native("security-native.json", maxNativeBytes, security.nativeReportSha256), "passed");
  requireEvidence(checks.every(check => check.status === "passed"), "security_approval_required");
  let performance;
  if (manifest.performance.expected) {
    requireEvidence(isDigest(manifest.performance.sha256), "missing_performance_pin");
    const comparison = summarizePerformance(parseEvidenceJson(read("performance.json", cap, manifest.performance.sha256)), job);
    const baseline = comparison.baseline;
    const candidate = comparison.runs[0]?.measurement;
    requireEvidence(comparison.decision === "within_budget" && baseline && candidate &&
      isDeepStrictEqual(summary.performance, { ...comparison, sha256: manifest.performance.sha256 }), "performance_approval_required");
    const reference = readObservation(native("baseline-native.json", maxNativeBytes, baseline.sha256));
    const measured = readObservation(native("candidate-1-native.json", maxNativeBytes, candidate.sha256));
    requireEvidence(reference.revision === baseline.revision && reference.harnessRevision === job.revision &&
      measured.revision === job.revision && measured.harnessRevision === job.revision && !differingFields(reference, measured).length &&
      reference.medianMs === baseline.medianMs && measured.medianMs === candidate.medianMs, "performance_evidence_mismatch");
    performance = { mode: "accepted-main", baselineRevision: baseline.revision, acceptanceRun: baseline.acceptanceRun };
  } else {
    requireEvidence(record(summary.performance).status === "not_scheduled", "initial_enrollment_required");
    const measured = readObservation(native("enrollment-native.json", maxNativeBytes));
    requireEvidence(measured.revision === job.revision && measured.harnessRevision === job.revision, "enrollment_revision_mismatch");
    performance = { mode: "initial-enrollment" };
  }
  return { schemaVersion: 1, ...source, jobId: job.jobId, verdict: "approved", performance, files };
}

async function main() {
  const env = process.env;
  const temp = env.RUNNER_TEMP;
  requireEvidence(temp && process.argv.length === 3, "release_workflow_context_required");
  const sourceFile = path.join(temp, "release-source.json");
  if (process.argv[2] === "select") {
    requireEvidence(env.GITHUB_EVENT_PATH && env.GITHUB_OUTPUT && env.GH_TOKEN, "release_workflow_context_required");
    const source = await resolveReleaseSource(env, parseEvidenceJson(fs.readFileSync(env.GITHUB_EVENT_PATH)), async endpoint => {
      const response = await fetch("https://api.github.com/repos/" + env.GITHUB_REPOSITORY + "/" + endpoint, {
        headers: { Authorization: "Bearer " + env.GH_TOKEN, Accept: "application/vnd.github+json" },
        redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Release evidence lookup failed (HTTP " + response.status + ").");
      return response.json();
    });
    fs.writeFileSync(sourceFile, JSON.stringify(source), { flag: "wx" });
    fs.appendFileSync(env.GITHUB_OUTPUT, `run=${source.ci.runId}\nverdict=${source.artifacts.verdict.id}\ninputs=${source.artifacts.inputs.id}\n`);
  } else if (process.argv[2] === "manifest") {
    const source: Source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
    const manifest = buildReleaseManifest(source, path.join(temp, "release-verdict"), path.join(temp, "release-inputs"));
    fs.writeFileSync(path.join(temp, "playwright-evidence.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  } else throw new Error("Use select or manifest.");
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
