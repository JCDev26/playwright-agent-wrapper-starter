import { readFileSync } from "node:fs";
import type { assessPerformance } from "../src/playwright-wrapper/performance/assessPerformance";

// CI pipes the current wrapper finding here, including when the comparison exits nonzero.
const finding: ReturnType<typeof assessPerformance> = JSON.parse(readFileSync(0, "utf8"));
const ms = (value: number | undefined) => value === undefined ? "unavailable" : value.toFixed(2) + " ms";
console.log(`## Task submission performance\n\n**${finding.status}** — ${finding.reason}\n`);
if (finding.baseline) {
  const { revision, acceptanceRun, initialTasks, medianMs } = finding.baseline;
  const url = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${acceptanceRun}`;
  console.log(`Started with ${initialTasks} tasks. Accepted main [\`${revision.slice(0, 7)}\`](${url}) measured ${ms(medianMs)}. The limit was ${ms(finding.limitMs)}.\n`);
}
for (const [i, run] of finding.runs.entries()) {
  const label = i === 0 ? "Candidate" : "Confirmation";
  const measurement = run.medianMs === undefined ? "median unavailable" : "median " + ms(run.medianMs);
  console.log(`- ${label} ${measurement} (Playwright ${run.status}).`);
}
if (process.env.EVIDENCE_URL)
  console.log(`\n[Download the finding and native Playwright reports](${process.env.EVIDENCE_URL}).`);
