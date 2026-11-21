import policy from "../../../agents/contrarian/policy.json";
import { record, requireEvidence } from "../reporting/pinnedEvidence";

interface Case {
  project: string;
  file: string;
  title: string;
  describe: string[];
  outcome: unknown;
  expected: unknown;
  terminalStatus: unknown;
}

function array(value: unknown): unknown[] {
  requireEvidence(Array.isArray(value), "invalid_discovery_evidence");
  return value;
}

/** Use Playwright's project, file and full describe/title path to match cases independently of order. */
function cases(value: unknown) {
  const report = record(value);
  const entries = new Map<string, Case>();
  const pending = array(report.suites).map(suite => ({ suite, titles: [] as string[] }));
  while (pending.length) {
    const { suite: input, titles } = pending.pop()!;
    const suite = record(input);
    requireEvidence(typeof suite.title === "string", "invalid_discovery_evidence");
    const path = [...titles, suite.title];
    for (const child of array(suite.suites ?? [])) pending.push({ suite: child, titles: path });
    for (const specValue of array(suite.specs)) {
      const spec = record(specValue);
      requireEvidence(typeof spec.title === "string" && typeof spec.file === "string", "invalid_discovery_evidence");
      for (const testValue of array(spec.tests)) {
        const test = record(testValue);
        requireEvidence(typeof test.projectName === "string", "invalid_discovery_evidence");
        const key = JSON.stringify([test.projectName, spec.file, path, spec.title]);
        requireEvidence(!entries.has(key), "duplicate_test_identity");
        const attempts = array(test.results);
        entries.set(key, { project: test.projectName, file: spec.file, title: spec.title, describe: path.slice(1),
          outcome: test.status, expected: test.expectedStatus,
          terminalStatus: attempts.length ? record(attempts.at(-1)).status : null });
      }
    }
  }
  return entries;
}

export function reviewSuite(plan: unknown, native: unknown, producerPlatform: string | undefined) {
  requireEvidence(array(record(plan).errors).length === 0, "test_discovery_failed");
  const scheduled = cases(plan);
  const observed = cases(native);
  requireEvidence(scheduled.size > 0, "empty_discovery_plan");
  let missing = 0, extra = 0, acceptedSkips = 0, otherSkips = 0, flaky = 0, expectedFailures = 0, plannedFailures = 0;
  for (const identity of scheduled.keys()) if (!observed.has(identity)) missing++;
  for (const [identity, test] of observed) {
    if (!scheduled.has(identity)) extra++;
    if (scheduled.get(identity)?.expected === "passed" && test.expected === "passed" && test.outcome === "unexpected" &&
        (test.terminalStatus === "failed" || test.terminalStatus === "timedOut")) plannedFailures++;
    if (test.outcome === "flaky") flaky++;
    if (test.expected === "failed" || test.expected === "timedOut") expectedFailures++;
    if (test.outcome === "skipped") {
      const allowed = test.expected === "skipped" && policy.allowedSkips.some(rule =>
        rule.platform === producerPlatform && rule.project === test.project && rule.file === test.file &&
        rule.title === test.title && JSON.stringify(rule.describe) === JSON.stringify(test.describe));
      if (allowed) acceptedSkips++;
      else otherSkips++;
    }
  }
  const challenges: string[] = [];
  if (missing || extra) challenges.push("discovery_mismatch");
  if (flaky > policy.maxFlakyTests) challenges.push("flaky_tests");
  if (otherSkips) challenges.push("unapproved_skips");
  if (expectedFailures) challenges.push("expected_failure_annotations");
  return { planned: scheduled.size, observed: observed.size, missing, extra, acceptedSkips, otherSkips,
    flaky, expectedFailures, plannedFailures, challenges };
}
