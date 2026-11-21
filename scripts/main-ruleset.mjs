import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const desired = JSON.parse(readFileSync(new URL("../.github/rulesets/main.json", import.meta.url), "utf8"));
const { reference } = JSON.parse(readFileSync(new URL("../agents/performance/policy.json", import.meta.url), "utf8"));

async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 1 || args[0] !== "--apply")) throw new Error("Usage: node scripts/main-ruleset.mjs [--apply]");
  const apply = args.length === 1;
  const token = process.env.GH_TOKEN || (apply ? execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim() : undefined);
  const headers = { Accept: "application/vnd.github+json", ...(token ? { Authorization: "Bearer " + token } : {}) };
  const api = async (endpoint, init) => {
    const response = await fetch("https://api.github.com/repos/" + reference.repository + "/" + endpoint,
      { headers, redirect: "error", signal: AbortSignal.timeout(20000), ...init });
    if (!response.ok) throw new Error("GitHub returned HTTP " + response.status + " for " + endpoint);
    return response.json();
  };
  const tip = (await api("branches/main")).commit.sha;
  const list = await api("actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=" + tip + "&per_page=1");
  const run = list.workflow_runs[0];
  if (!run || run.head_sha !== tip || run.conclusion !== "success") throw new Error("Waiting for successful CI on the current main revision.");
  const { jobs } = await api("actions/runs/" + run.id + "/attempts/" + run.run_attempt + "/jobs?per_page=100");
  const verified = jobs.some(job => job.name === "verify" && job.conclusion === "success" &&
    job.steps.some(step => step.name === "Challenge the pipeline verdict" && step.conclusion === "success"));
  if (!verified) throw new Error("Waiting for the Contrarian verify job to land and pass on main.");
  const remote = await api("contents/.github/rulesets/main.json?ref=" + tip);
  if (!isDeepStrictEqual(desired, JSON.parse(Buffer.from(remote.content, "base64").toString("utf8"))))
    throw new Error("The local ruleset must match the reviewed version on main.");
  const owners = await api("codeowners/errors?ref=" + tip);
  if (owners.errors.length) throw new Error("Resolve GitHub's CODEOWNERS errors before activation.");

  const rulesets = await api("rulesets?per_page=100");
  const existing = rulesets.find(rule => rule.name === desired.name);
  if (existing) {
    const current = await api("rulesets/" + existing.id);
    const contains = (actual, expected) => expected && typeof expected === "object"
      ? (Array.isArray(expected) ? Array.isArray(actual) && actual.length === expected.length &&
          expected.every(item => actual.some(value => contains(value, item)))
        : !!actual && Object.entries(expected).every(([key, value]) => contains(actual[key], value)))
      : actual === expected;
    if (!contains(current, desired)) throw new Error("Existing ruleset differs from reviewed policy. Inspect it before changing it.");
    console.log("Active matching ruleset " + existing.id);
    return;
  }
  if (!apply) { console.log("Ready to activate the reviewed main ruleset."); return; }
  if ((await api("branches/main")).commit.sha !== tip) throw new Error("Main advanced during verification. Retry against its new CI result.");
  const created = await api("rulesets", { method: "POST", headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(desired) });
  console.log("Activated ruleset " + created.id + " for main.");
}

main().catch(error => { console.error(error.message); process.exitCode = 2; });
