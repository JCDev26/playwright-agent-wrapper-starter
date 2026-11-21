import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import policy from "../agents/reporting/policy.json";
import { jobDirectory } from "../src/playwright-wrapper/agents/governance";
import { cleanRevision } from "../src/playwright-wrapper/performance/revision";

// Operator-only discovery. Capture the intended projects independently of the command that runs the suite.
function discover() {
  const approved = process.env.PW_AGENT_REVISION;
  if (process.argv.length !== 2 || !approved || cleanRevision() !== approved) throw new Error("A clean, host-bound checkout is required.");
  const directory = jobDirectory("reporting", process.env.PW_AGENT_JOB_ID ?? "");
  const env = { ...process.env };
  for (const key of ["PLAYWRIGHT_JSON_OUTPUT_DIR", "PLAYWRIGHT_JSON_OUTPUT_NAME", "PLAYWRIGHT_JSON_OUTPUT_FILE",
    "PLAYWRIGHT_JSON_ONLY_FAILURES"]) delete env[key];
  const bytes = execFileSync(process.execPath, [path.resolve("node_modules/playwright/cli.js"), "test",
    "--list", "--reporter=json", ...policy.suiteProjects.map(project => "--project=" + project)], {
    env, timeout: 60_000, maxBuffer: policy.maxSuiteBytes, stdio: ["ignore", "pipe", "inherit"], windowsHide: true,
  });
  const report = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(report.errors) || report.errors.length || !report.suites?.length || cleanRevision() !== approved)
    throw new Error("Playwright could not establish the current revision's discovery plan.");
  writeFileSync(path.join(directory, "suite-plan.json"), bytes, { flag: "wx" });
  return { PW_AGENT_REVIEW_PLAN_SHA256: createHash("sha256").update(bytes).digest("hex") };
}

try {
  console.log(JSON.stringify(discover()));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 2;
}
