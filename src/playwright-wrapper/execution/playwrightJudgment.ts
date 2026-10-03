import fs from "node:fs";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Playwright JSON result object.");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid Playwright JSON result array.");
  }
  return value;
}

/** Read only the native report fields needed to establish a completed judgment. */
export function readPlaywrightJudgment(
  reportPath: string,
  exitCode: number,
): "passed" | "failed" {
  const report = object(JSON.parse(fs.readFileSync(reportPath, "utf8")));
  if (array(report.errors).length > 0) {
    throw new Error("Playwright reported runner/discovery errors; no trustworthy test judgment.");
  }

  const counts = { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  let executed = 0;
  function visit(suites: unknown[]): void {
    for (const value of suites) {
      const suite = object(value);
      for (const spec of array(suite.specs)) {
        for (const value of array(object(spec).tests)) {
          const test = object(value);
          const status = test.status;
          if (status !== "expected" && status !== "unexpected" &&
              status !== "flaky" && status !== "skipped") {
            throw new Error("Playwright report contains an unknown test outcome.");
          }
          counts[status] += 1;
          const results = array(test.results).map(object);
          if (results.some((result) => !["passed", "failed", "timedOut", "skipped"].includes(String(result.status)))) {
            throw new Error("Playwright test execution was interrupted or incomplete.");
          }
          if (status !== "skipped") {
            const last = results.at(-1);
            if (!last || last.status === "skipped" ||
                typeof last.workerIndex !== "number" || last.workerIndex < 0) {
              throw new Error("Playwright outcome has no completed test attempt.");
            }
            executed += 1;
          }
        }
      }
      if (suite.suites !== undefined) visit(array(suite.suites));
    }
  }
  visit(array(report.suites));
  const stats = object(report.stats);
  if (Object.entries(counts).some(([name, count]) => stats[name] !== count)) {
    throw new Error("Playwright report totals do not match its test outcomes.");
  }
  if (executed === 0) {
    throw new Error("Playwright produced no completed test attempts (no tests or all skipped).");
  }
  if (exitCode === 0 && counts.unexpected === 0) return "passed";
  if (exitCode === 1 && counts.unexpected > 0) return "failed";
  throw new Error("Playwright exit code and test outcomes do not establish a consistent judgment.");
}
