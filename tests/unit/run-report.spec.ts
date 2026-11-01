import { test, expect } from "@playwright/test";
import { createRunReport } from "../../src/reporting/run-report";

const context = { taskId: "test-1", repository: "example/project", commit: "a".repeat(40),
  environment: { platform: "test", toolVersions: { node: process.version }, capabilities: ["headless"] },
  observedAt: "2026-11-01T00:00:00.000Z" };
test("empty and unexecuted checks cannot claim success", () => {
  expect(createRunReport(context, []).technical).toBe("inconclusive");
  expect(createRunReport(context, [{ name: "engine", status: "not-run", evidence: [] }]).technical).toBe("inconclusive");
});
test("failure takes precedence over missing evidence and acceptance stays separate", () => {
  const report = createRunReport(context, [
    { name: "test", status: "failed", evidence: ["current/log.txt"] },
    { name: "browser", status: "inconclusive", evidence: [] },
  ]);
  expect(report.technical).toBe("failed");
  expect(report.ownerApproval).toBe("pending");
  expect(report.visual).toBe("unknown");
});
test("provenance is required and report snapshots cannot be changed by later array edits", () => {
  expect(() => createRunReport({ ...context, commit: "HEAD" }, [])).toThrow();
  expect(() => createRunReport({ ...context, observedAt: "yesterday" }, [])).toThrow();
  expect(() => createRunReport(context, [{ name: "test", status: "passed", evidence: [], durationMs: -1 }])).toThrow();
  const evidence = ["run-1.json"];
  const report = createRunReport(context, [{ name: "test", status: "passed", evidence }]);
  evidence.push("later.json");
  expect(report.checks[0]?.evidence).toEqual(["run-1.json"]);
  expect(report.technical).toBe("passed");
  expect(report.ownerApproval).toBe("pending");
});

test("visual applicability is an explicit composition choice, independent of technical success", () => {
  const checks = [{ name: "backend", status: "passed" as const, evidence: [] }];
  expect(createRunReport(context, checks).visual).toBe("unknown");
  expect(createRunReport(context, checks, { applicability: "applicable" }).visual).toBe("review-required");
  const report = createRunReport(context, checks, { applicability: "not-applicable", rationale: "Pure backend validation; no visual output is produced." });
  expect(report.visual).toBe("not-applicable");
  expect(report.visualApplicability.rationale).toContain("backend");
  expect(report.ownerApproval).toBe("pending");
  expect(() => createRunReport(context, checks, { applicability: "not-applicable" })).toThrow();
});
