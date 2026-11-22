import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import performancePolicy from "../../agents/performance/policy.json";
import reportingPolicy from "../../agents/reporting/policy.json";
import securityPolicy from "../../agents/security/policy.json";
import { buildReleaseManifest, resolveReleaseSource } from "../../scripts/release-evidence";
import { reviewSuite } from "../../src/playwright-wrapper/contrarian/suiteReview";
import { summarizePerformance, summarizeSecurity } from "../../src/playwright-wrapper/reporting/specialistSummaries";
import { summarizeSuite } from "../../src/playwright-wrapper/reporting/suiteSummary";

const repository = "owner/repository", revision = "a".repeat(40), tag = "releases/v1";
const job = { jobId: "11111111-1111-1111-1111-111111111111", revision };
const metadata = { agentJobId: job.jobId, agentRevision: revision };
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const env = { GITHUB_EVENT_NAME: "release", GITHUB_REPOSITORY: repository, GITHUB_SHA: revision, GITHUB_REF: "refs/tags/" + tag };
const event = { repository: { full_name: repository }, action: "published", release: { id: 7, draft: false, published_at: "2026-11-21T10:00:00Z", tag_name: tag } };
const run = { id: 123, run_attempt: 2, path: ".github/workflows/ci.yml", event: "push", head_branch: "main", head_sha: revision,
  status: "completed", conclusion: "success", repository: event.repository, head_repository: event.repository };

function source(options: { run?: object; tagSha?: string; verify?: string; expired?: boolean } = {}) {
  return resolveReleaseSource(env, event, async endpoint => {
    if (endpoint === "commits/" + encodeURIComponent(env.GITHUB_REF)) return { sha: options.tagSha ?? revision };
    if (endpoint === "actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=" + revision + "&per_page=1")
      return { workflow_runs: [{ ...run, ...options.run }] };
    if (endpoint === "actions/runs/123/attempts/2/jobs?per_page=100")
      return { jobs: [{ id: 987, name: "verify", status: "completed", conclusion: options.verify ?? "success" }] };
    const artifact = /^actions\/runs\/123\/artifacts\?name=(contrarian|review-inputs)-123-2&per_page=2$/.exec(endpoint);
    if (!artifact) throw new Error("Unexpected release lookup.");
    return { total_count: 1, artifacts: [{ id: artifact[1] === "contrarian" ? 333 : 444, name: artifact[1] + "-123-2",
      digest: "sha256:" + "c".repeat(64), expired: options.expired ?? false, workflow_run: { id: 123, head_sha: revision } }] };
  });
}

test("selects the published tag's exact successful main push, verify job and immutable artifact attempt", async () => {
  expect(await source()).toMatchObject({ revision, release: { id: 7, tag }, ci: { runId: 123, attempt: 2 },
    artifacts: { verdict: { id: 333, name: "contrarian-123-2" }, inputs: { id: 444, name: "review-inputs-123-2" } } });
  for (const change of [{ tagSha: "b".repeat(40) }, { run: { event: "pull_request" } }, { run: { head_branch: "feature" } },
    { run: { head_sha: "b".repeat(40) } }, { run: { conclusion: "failure" } }, { run: { status: "in_progress" } },
    { run: { head_repository: { full_name: "fork/repo" } } }, { run: { path: ".github/workflows/other.yml" } },
    { verify: "skipped" }, { expired: true }]) await expect(source(change)).rejects.toThrow();
});

function bundle(directory: string, enrollment: boolean) {
  fs.mkdirSync(directory, { recursive: true });
  function write(name: string, value: unknown) {
    const bytes = Buffer.from(JSON.stringify(value));
    fs.writeFileSync(path.join(directory, name), bytes);
    return hash(bytes);
  }
  const suite = { config: { metadata }, errors: [], stats: { expected: 5, unexpected: 0, flaky: 0, skipped: 0 },
    suites: [{ title: "suite", specs: reportingPolicy.suiteProjects.map(projectName => ({ file: "test.spec.ts", title: projectName,
      tests: [{ projectName, status: "expected", expectedStatus: "passed", results: [{ retry: 0, status: "passed", workerIndex: 0, errors: [] }] }] })) }] };
  const suiteSha = write("suite.json", suite);
  const planSha256 = write("suite-plan.json", suite);
  const checks = securityPolicy.checks;
  const securityHash = write("security-native.json", { config: { metadata, workers: 1, projects: [{ name: "security", id: "security", retries: 0, repeatEach: 1 }] },
    errors: [], stats: { expected: checks.length, unexpected: 0, flaky: 0, skipped: 0 }, suites: [{ file: securityPolicy.target.spec,
      specs: checks.map(({ id, title }) => ({ file: securityPolicy.target.spec, title, tests: [{ projectName: "security", projectId: "security",
        expectedStatus: "passed", status: "expected", results: [{ retry: 0, parallelIndex: 0, workerIndex: 0, status: "passed", errors: [],
          attachments: [{ name: "security-contract-v1", contentType: "text/plain", body: Buffer.from(id + ":passed").toString("base64") }] }] }] })) }] });
  const security = { ...job, schemaVersion: 1, policyVersion: securityPolicy.version, reason: "fixture", status: "checks_passed", nativeStatus: "passed",
    checks: checks.map(({ id }) => ({ id, status: "passed" })), report: { path: "display-only", sha256: securityHash } };
  const securitySha = write("security.json", security);
  function timing(name: string, appRevision: string, medianMs: number) {
    const data = { revision: appRevision, harnessRevision: revision, medianMs, samplesMs: Array(performancePolicy.sampleCount).fill(medianMs),
      initialTasks: performancePolicy.initialTasks, metric: performancePolicy.metric, unit: "ms", project: "performance", browserEngine: "chromium",
      browser: "fixture", node: "22", playwright: "fixture", platform: "linux", architecture: "x64", osRelease: "fixture", runnerClass: "fixture",
      benchmarkHash: "f".repeat(64), conditions: "loopback" };
    return write(name, { config: { workers: 1, metadata }, errors: [], stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 },
      suites: [{ specs: [{ file: performancePolicy.target.spec, tests: [{ projectName: "performance", expectedStatus: "passed", status: "expected",
        results: [{ retry: 0, workerIndex: 0, status: "passed", errors: [], attachments: [{ name: "task-timing.json",
          contentType: "application/json", body: Buffer.from(JSON.stringify(data)).toString("base64") }] }] }] }] }] });
  }
  const candidateSha = timing(enrollment ? "enrollment-native.json" : "candidate-1-native.json", revision, 12);
  let performanceSha = null;
  let performanceLane: object = { status: "not_scheduled", reason: "not_scheduled_by_host", partial: false, knownFailure: false };
  if (!enrollment) {
    const main = "b".repeat(40);
    const performance = { ...job, schemaVersion: 1, policyVersion: performancePolicy.version, reason: "fixture", status: "within_budget",
      baseline: { revision: main, harnessRevision: revision, medianMs: 10, sha256: timing("baseline-native.json", main, 10),
        initialTasks: performancePolicy.initialTasks, acceptanceRun: "77" }, limitMs: 13,
      runs: [{ revision, medianMs: 12, status: "passed", report: "display-only", sha256: candidateSha }] };
    performanceSha = write("performance.json", performance);
    performanceLane = { ...summarizePerformance(performance, job), sha256: performanceSha };
  }
  const manifestSha256 = write("manifest.json", { ...job, schemaVersion: 1, suite: { sha256: suiteSha, exitCode: 0 },
    security: { sha256: securitySha }, performance: { expected: !enrollment, sha256: performanceSha } });
  const summarySha256 = write("summary.json", { ...job, status: "passed", manifestSha256, suite: { ...summarizeSuite(suite, 0), sha256: suiteSha },
    security: { ...summarizeSecurity(security, job), sha256: securitySha }, performance: performanceLane });
  const { challenges, ...counts } = reviewSuite(suite, suite, "linux");
  const receipt = { ...job, schemaVersion: 1, policyVersion: 1, status: "approved", advance: true, challenges, confirmedFailures: [],
    suite: counts, upstreamResult: "success", reportedStatus: "passed", planSha256, manifestSha256, summarySha256 };
  write("contrarian.json", receipt);
  return { receipt, write };
}

for (const enrollment of [false, true]) {
  test("hashes the validated evidence for " + (enrollment ? "initial enrollment" : "an accepted-main comparison"), async ({}, info) => {
    const f = bundle(info.outputDir, enrollment);
    const selected = await source();
    const build = () => buildReleaseManifest(selected, info.outputDir, info.outputDir);
    const result = build();
    expect(result.files.map(file => file.name).sort()).toEqual(fs.readdirSync(info.outputDir).sort());
    expect(result.files.every(file => hash(fs.readFileSync(path.join(info.outputDir, file.name))) === file.sha256)).toBe(true);
    for (const change of [{ advance: false }, { revision: "d".repeat(40) }, { challenges: ["unresolved"] }, { reportedStatus: "inconclusive" }]) {
      f.write("contrarian.json", { ...f.receipt, ...change });
      expect(build).toThrow("contrarian_approval_required");
    }
    f.write("contrarian.json", f.receipt);
    fs.appendFileSync(path.join(info.outputDir, "suite.json"), " ");
    expect(build).toThrow("evidence_digest_mismatch");
  });
}
