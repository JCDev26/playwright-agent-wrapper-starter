import { test, expect } from "@playwright/test";
import { toRunReport } from "../../src/reporting/playwright-run-report";
import { createFailedResult, createExecutionErrorResult } from "../../src/playwright-wrapper/contract/resultSchema";
const context = { taskId: "qa", repository: "example/project", commit: "a".repeat(40),
  environment: { platform: "test", toolVersions: {}, capabilities: ["node"] }, observedAt: "2026-11-01T00:00:00Z" };
const target = { project: "smoke", spec: null, grep: null, headed: false, workers: 1 };
const artifacts = { htmlReport: "possibly-old.html", testResultsJson: "run-unique/results.json", testResultsXml: null, traceFiles: [] };
test("ok transport with failed tests remains failed", () => {
  const result = createFailedResult({ target, artifacts, command: "test", exitCode: 1 });
  expect(result.ok).toBe(true);
  expect(toRunReport(result, context).technical).toBe("failed");
  expect(toRunReport(result, context).checks[0]?.evidence).toEqual(["run-unique/results.json"]);
});
test("untrustworthy execution is inconclusive, not proof of failed tests", () => {
  const result = createExecutionErrorResult({ target, artifacts, command: null, exitCode: null,
    code: "TEST_JUDGMENT_UNAVAILABLE", detail: "No native report" });
  expect(toRunReport(result, context).technical).toBe("inconclusive");
  expect(toRunReport(result, context).ownerApproval).toBe("pending");
});

test("the caller can justify nonvisual scope without changing native judgment or approval", () => {
  const result = createFailedResult({ target, artifacts, command: "test", exitCode: 1 });
  expect(toRunReport(result, context).visual).toBe("unknown");
  const report = toRunReport(result, context, { applicability: "not-applicable", rationale: "This invocation runs API-only fixtures with no rendered output." });
  expect(report.visual).toBe("not-applicable");
  expect(report.technical).toBe("failed");
  expect(report.ownerApproval).toBe("pending");
  expect(report.native).toEqual(result);
});
