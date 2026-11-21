import { readFileSync } from "node:fs";
import type { ReportingResult } from "../src/playwright-wrapper/reporting/summarizeEvidence";

// CI presents only the Reporting endpoint's validated projection.
const report: ReportingResult = JSON.parse(readFileSync(0, "utf8"));
const { suite, security, performance } = report;
const ms = (n: number) => n.toFixed(2) + " ms";
console.log("## Playwright verification\n");
console.log("**" + report.status + "** · " + report.coverage + " coverage\n");
console.log("| Evidence | Result |");
console.log("|---|---|");
console.log("| Desktop, emulated mobile and wrapper suite | " + (suite?.status ?? "unavailable") + " |");
console.log("| Security contracts | " + (security?.decision ?? security?.status ?? "unavailable") + " |");
console.log("| Performance comparison | " + (performance?.decision ?? performance?.status ?? "unavailable") + " |\n");
if (suite?.counts) {
  const { expected, unexpected, flaky, skipped } = suite.counts;
  console.log("Playwright recorded " + expected + " expected outcomes, " + unexpected +
    " unexpected, " + flaky + " flaky and " + skipped + " skipped.\n");
}
if (security?.checks) {
  for (const check of security.checks) console.log("- `" + check.id + "` · " + check.status);
  console.log();
}
if (performance?.baseline && typeof performance.limitMs === "number") {
  const { revision, acceptanceRun, initialTasks, medianMs } = performance.baseline;
  const runUrl = process.env.GITHUB_SERVER_URL + "/" + process.env.GITHUB_REPOSITORY + "/actions/runs/" + acceptanceRun;
  const reference = process.env.GITHUB_REPOSITORY ? "[`" + revision.slice(0, 7) + "`](" + runUrl + ")" : revision.slice(0, 7);
  console.log("At " + initialTasks + " tasks, accepted main " + reference + " measured " + ms(medianMs) +
    ". The candidate limit was " + ms(performance.limitMs) + ".\n");
  for (const [index, run] of (performance.runs ?? []).entries()) {
    const value = run.measurement ? ms(run.measurement.medianMs) : "median unavailable";
    console.log("- " + (index === 0 ? "Candidate" : "Confirmation") + " · " + value + " (Playwright " + run.nativeStatus + ")");
  }
  console.log();
}
if (report.incompleteSources.length) {
  const reasons = report.incompleteSources.map(source =>
    source + " (" + (source === "manifest" ? report.reason : report[source]?.reason ?? "unavailable") + ")");
  console.log("Incomplete evidence for " + reasons.join(", ") + ".\n");
}
