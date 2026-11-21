import policy from "../../../agents/reporting/policy.json";
import { judgePlaywrightReport } from "../execution/playwrightJudgment";
import { record, requireEvidence, type Lane } from "./pinnedEvidence";

const emptyCounts = () => ({ expected: 0, unexpected: 0, flaky: 0, skipped: 0 });

function list(value: unknown): unknown[] {
  requireEvidence(Array.isArray(value), "invalid_native_schema");
  return value;
}

/** Validate the fields used for judgment. Playwright may add unrelated reporter metadata. */
export function summarizeSuite(value: unknown, exitCode: number) {
  const report = record(value);
  const counts = emptyCounts();
  const projects = policy.suiteProjects.map(name => ({ name, ...emptyCounts() }));
  const suites = [...list(report.suites)];
  let interruptedAttempts = 0;
  while (suites.length) {
    const suite = record(suites.pop());
    if (suite.suites !== undefined) {
      for (const child of list(suite.suites)) suites.push(child);
    }
    for (const spec of list(suite.specs)) {
      for (const input of list(record(spec).tests)) {
        const test = record(input);
        const project = projects.find(item => item.name === test.projectName);
        requireEvidence(project, "unexpected_suite_project");
        requireEvidence(typeof test.expectedStatus === "string" && ["passed", "failed", "timedOut", "skipped"].includes(test.expectedStatus),
          "invalid_expected_status");
        let matched = 0;
        let mismatched = 0;
        let skippedAsExpected = false;
        for (const [index, item] of list(test.results).entries()) {
          const attempt = record(item);
          requireEvidence(attempt.retry === index && Array.isArray(attempt.errors), "invalid_native_attempt");
          if (attempt.status === "interrupted") { interruptedAttempts++; continue; }
          if (attempt.status === "skipped") {
            skippedAsExpected ||= test.expectedStatus === "skipped";
            continue;
          }
          requireEvidence((attempt.status === "passed" || attempt.status === "failed" || attempt.status === "timedOut") &&
            typeof attempt.workerIndex === "number" && Number.isInteger(attempt.workerIndex) && attempt.workerIndex >= 0 &&
            (attempt.status !== "passed" || attempt.errors.length === 0), "invalid_native_attempt");
          if (attempt.status === test.expectedStatus) matched++;
          else mismatched++;
        }
        let outcome: keyof typeof counts = "skipped";
        if (mismatched > 0) outcome = matched > 0 || skippedAsExpected ? "flaky" : "unexpected";
        else if (matched > 0) outcome = "expected";
        requireEvidence(test.status === outcome, "inconsistent_test_outcome");
        counts[outcome]++;
        project[outcome]++;
      }
    }
  }
  const stats = record(report.stats);
  requireEvidence(Object.entries(counts).every(([key, count]) => stats[key] === count), "inconsistent_suite_totals");
  const missingProjects = projects.filter(p => p.expected + p.unexpected + p.flaky === 0).map(p => p.name);
  const runnerErrors = list(report.errors).length;
  const completed = counts.expected + counts.unexpected + counts.flaky;
  const nativeIncomplete = runnerErrors > 0 || interruptedAttempts > 0 || completed === 0;
  let status: Lane["status"] = "inconclusive";
  let knownFailure = false;
  if (nativeIncomplete) {
    // A runner error or interrupted sibling does not erase independently counted failures.
    knownFailure = exitCode === 1 && counts.unexpected > 0;
  } else {
    try { knownFailure = judgePlaywrightReport(value, exitCode) === "failed"; }
    catch { requireEvidence(false, "inconsistent_native_judgment"); }
    if (knownFailure) status = "failed";
    else if (missingProjects.length === 0) status = "passed";
  }
  let reason = "native_outcomes_checked";
  if (runnerErrors > 0) reason = "runner_errors";
  else if (interruptedAttempts > 0) reason = "interrupted_attempts";
  else if (missingProjects.length > 0) reason = "projects_without_completed_tests";
  else if (counts.skipped > 0) reason = "skipped_tests";
  return { status, reason, knownFailure, partial: nativeIncomplete || missingProjects.length > 0 || counts.skipped > 0,
    evidence: "native_report" as const, counts, projects, missingProjects, runnerErrors, interruptedAttempts, exitCode };
}
