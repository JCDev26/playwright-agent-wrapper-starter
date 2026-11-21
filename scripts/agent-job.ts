import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import reportingPolicy from "../agents/reporting/policy.json";
import { jobDirectory } from "../src/playwright-wrapper/agents/governance";
import { cleanRevision } from "../src/playwright-wrapper/performance/revision";
import { EvidenceIssue, readEvidenceBytes, type Job } from "../src/playwright-wrapper/reporting/pinnedEvidence";
import { captureReviewInputs } from "./capture-review-inputs";

// Operator entry point. None of these operations are advertised through MCP or the agent CLIs.
const checkout = realpathSync.native(process.cwd());

function enroll(job: Job, source: "suite" | "security" | "performance") {
  try {
    const cap = source === "suite" ? reportingPolicy.maxSuiteBytes : reportingPolicy.maxFindingBytes;
    const bytes = readEvidenceBytes(checkout, job, `${source}.json`, cap);
    return createHash("sha256").update(bytes).digest("hex");
  } catch (error) {
    if (!(error instanceof EvidenceIssue)) throw error;
    console.error("Could not enroll " + source + " evidence (" + error.message + ").");
    return null;
  }
}

function main() {
  const [command, mode, suiteExit, ...extra] = process.argv.slice(2);
  const revision = cleanRevision();
  if (!revision) throw new Error("The operator must start in a clean candidate checkout.");
  if (command === "init" && process.argv.length === 3) {
    const jobId = randomUUID();
    jobDirectory("reporting", jobId, true);
    return { PW_AGENT_JOB_ID: jobId, PW_AGENT_REVISION: revision };
  }
  const review = command === "review-inputs" && (mode === "required" || mode === "initial-enrollment") &&
    suiteExit === undefined && !extra.length;
  const seal = command === "seal" && ["required", "not-scheduled"].includes(mode) && !extra.length &&
    (suiteExit === "missing" || (/^(0|[1-9]\d{0,2})$/.test(suiteExit) && Number(suiteExit) <= 255));
  if (!review && !seal)
    throw new Error("Use init, seal <required|not-scheduled> <suite exit code|missing>, or review-inputs <required|initial-enrollment>.");

  const jobId = process.env.PW_AGENT_JOB_ID ?? "";
  const directory = jobDirectory("reporting", jobId);
  if (process.env.PW_AGENT_REVISION !== revision)
    throw new Error("The reserved job directory and approved candidate are required.");
  const job = { jobId, revision };
  if (review) return captureReviewInputs(job, mode, process.env);
  const suite = enroll(job, "suite");
  const security = enroll(job, "security");
  const performance = mode === "required" ? enroll(job, "performance") : null;
  if (mode === "not-scheduled" && lstatSync(path.join(directory, "performance.json"), { throwIfNoEntry: false }))
    throw new Error("A performance finding exists for an unscheduled comparison.");
  const manifest = { schemaVersion: 1, jobId, revision,
    suite: suite && suiteExit !== "missing" ? { sha256: suite, exitCode: Number(suiteExit) } : null,
    security: security ? { sha256: security } : null, performance: { expected: mode === "required", sha256: performance } };
  const bytes = JSON.stringify(manifest) + "\n";
  writeFileSync(path.join(directory, "manifest.json"), bytes, { flag: "wx" });
  return { PW_AGENT_REPORT_MANIFEST_SHA256: createHash("sha256").update(bytes).digest("hex") };
}

try {
  console.log(JSON.stringify(main()));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 2;
}
