import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import policy from "../../../agents/performance/policy.json";
import { jobIdPattern } from "../agents/governance";
import { cleanRevision } from "./revision";
import { readObservation } from "./evidence";
import { eventCutoff, NoAcceptedMain, resolveAcceptedMain } from "./acceptedMain";

/** Operator entry point. No resolver, checkout or environment selection is exposed as an agent tool. */
async function prepare() {
  const candidate = cleanRevision();
  if (!candidate) throw new Error("Prepare from a clean, reviewed candidate checkout.");
  const jobId = process.env.PW_AGENT_JOB_ID ?? randomUUID();
  if (!jobIdPattern.test(jobId) || (process.env.PW_AGENT_REVISION && candidate !== process.env.PW_AGENT_REVISION))
    throw new Error("The host job must authorize this candidate checkout.");
  const anchor = process.env.GITHUB_ACTIONS === "true"
    ? eventCutoff(process.env.GITHUB_EVENT_NAME ?? "", JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, "utf8")))
    : undefined;
  const reference = await resolveAcceptedMain(anchor, process.env.PW_MAIN_READ_TOKEN);
  const temp = mkdtempSync(path.join(tmpdir(), "pw-accepted-main-"));
  const checkout = path.join(temp, "app");
  let added = false;
  try {
    execFileSync("git", ["worktree", "add", "--quiet", "--detach", checkout, reference.revision]);
    added = true;
    const env: NodeJS.ProcessEnv = { ...process.env, PW_PERF_REFERENCE_ROOT: checkout };
    delete env.PW_MAIN_READ_TOKEN;
    // The reference is a measurement. An absolute candidate SLO must not suppress reference collection.
    delete env.TASK_MEDIAN_BUDGET_MS;
    const target = policy.target;
    const receipt = JSON.parse(execFileSync(process.execPath, ["scripts/wrapper.cjs", "--project", target.project,
      "--spec", target.spec, "--grep", target.grep, "--workers", String(target.workers)], {
      env, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
    }));
    if (receipt.status !== "passed" || !receipt.ok || !receipt.artifacts.testResultsJson)
      throw new Error("The accepted-main benchmark did not produce passing native evidence.");
    const file = path.resolve(receipt.artifacts.testResultsJson);
    const observation = readObservation(file);
    if (observation.revision !== reference.revision || observation.harnessRevision !== candidate ||
        cleanRevision(checkout) !== reference.revision || cleanRevision() !== candidate)
      throw new Error("Measured source does not match the selected reference and candidate harness.");
    console.error(`Selected main ${reference.revision} (cutoff ${reference.anchor}, accepted by CI run ${reference.runId}).`);
    return { PW_AGENT_BASELINE_FILE: file, PW_AGENT_BASELINE_SHA256: observation.sha256,
      PW_AGENT_MAIN_REVISION: reference.revision, PW_AGENT_MAIN_CI_RUN: reference.runId,
      PW_AGENT_REVISION: candidate, PW_AGENT_JOB_ID: jobId };
  } finally {
    if (added) execFileSync("git", ["worktree", "remove", checkout]);
    rmdirSync(temp);
  }
}

prepare().then(binding => console.log(JSON.stringify(binding))).catch(error => {
  console.error(error.message);
  process.exitCode = error instanceof NoAcceptedMain ? 3 : 2;
});
