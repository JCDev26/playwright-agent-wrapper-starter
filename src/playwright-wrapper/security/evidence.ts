import type { JSONReport, JSONReportTest } from "@playwright/test/reporter";
import policy from "../../../agents/security/policy.json";
import { judgePlaywrightReport } from "../execution/playwrightJudgment";

export interface SecurityCheck {
  id: string;
  status: "passed" | "failed" | "inconclusive";
}

function checkOutcome(test: JSONReportTest, id: string): SecurityCheck["status"] {
  const [attempt] = test.results;
  if (test.expectedStatus !== "passed" || test.results.length !== 1 || attempt.retry !== 0 ||
      !Number.isInteger(attempt.workerIndex) || attempt.workerIndex < 0 || attempt.parallelIndex !== 0 ||
      !Array.isArray(attempt.attachments) || !Array.isArray(attempt.errors))
    return "inconclusive";
  const markers = attempt.attachments.filter(attachment => attachment.name === "security-contract-v1");
  const marker = markers[0];
  if (markers.length !== 1 || marker.path !== undefined || marker.contentType !== "text/plain")
    return "inconclusive";
  const matches = (status: string) => marker.body === Buffer.from(id + ":" + status).toString("base64");
  if (test.status === "expected" && attempt.status === "passed" && !attempt.error &&
      attempt.errors.length === 0 && matches("passed"))
    return "passed";
  if (test.status === "unexpected" && attempt.status === "failed" && matches("failed") &&
      attempt.errors.some(error => typeof error?.message === "string" && error.message.length > 0))
    return "failed";
  return "inconclusive";
}

/** Read inline contract observations only. The native report must cover the exact policy manifest. */
export function readSecurityEvidence(bytes: Buffer, nativeStatus: "passed" | "failed"): SecurityCheck[] {
  const native: JSONReport = JSON.parse(bytes.toString("utf8"));
  judgePlaywrightReport(native, nativeStatus === "passed" ? 0 : 1);
  const projects = native.config.projects.filter(project => project.name === policy.target.project);
  if (native.config.workers !== policy.target.workers || projects.length !== 1 || projects[0].id !== policy.target.project ||
      projects[0].retries !== 0 || projects[0].repeatEach !== 1)
    throw new Error("Unexpected security project settings.");

  const [suite] = native.suites;
  if (native.suites.length !== 1 || suite.file !== policy.target.spec || suite.suites?.length ||
      suite.specs.length !== policy.checks.length)
    throw new Error("Unexpected security spec.");

  return policy.checks.map(({ id, title }) => {
    const specs = suite.specs.filter(spec => spec.title === title);
    const spec = specs[0];
    if (specs.length !== 1 || spec.file !== policy.target.spec || spec.tests.length !== 1)
      throw new Error("The security check manifest differs from policy.");
    const [test] = spec.tests;
    if (test.projectName !== policy.target.project || test.projectId !== projects[0].id)
      throw new Error("The security check belongs to a different project.");
    return { id, status: checkOutcome(test, id) };
  });
}
