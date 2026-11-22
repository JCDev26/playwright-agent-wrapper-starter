import { readFileSync } from "node:fs";
import type { VerdictReview } from "../src/playwright-wrapper/contrarian/reviewVerdict";
import { qualityHandoffs } from "../src/playwright-wrapper/swarm/quality-job";

const finding: VerdictReview = JSON.parse(readFileSync(0, "utf8"));
console.log("## Contrarian review\n");
console.log("**" + finding.status + "** · " + (finding.advance ? "Pipeline may advance." : "Pipeline blocked.") + "\n");
console.log("Upstream " + (finding.upstreamResult ?? "unavailable") + " · Reporting " + (finding.reportedStatus ?? "unavailable") + "\n");
if (finding.suite) {
  const s = finding.suite;
  console.log("Discovery listed " + s.planned + " project/test pairs. The run recorded " + s.observed +
    ", with " + s.missing + " missing and " + s.extra + " extra.\n");
  console.log("Reviewed " + s.flaky + " flaky, " + s.acceptedSkips + " policy-allowed skips and " +
    s.otherSkips + " other skips.\n");
}
if (finding.confirmedFailures.length) console.log("Confirmed failures in **" + finding.confirmedFailures.join(", ") + "**.\n");
if (finding.challenges.length) {
  console.log("### Challenges\n");
  for (const code of finding.challenges) console.log("- " + code.replaceAll("_", " "));
}
console.log("\n" + finding.reason);

const followUps = qualityHandoffs(finding).filter(item => item.confirmedFailures.length || item.challenges.length);
if (followUps.length) {
  console.log("\n### Specialist follow-up\n");
  for (const item of followUps) console.log("- " + item.role + " · " + [...item.confirmedFailures, ...item.challenges].join(", "));
}
