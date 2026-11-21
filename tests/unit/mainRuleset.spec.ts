import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import policy from "../../.github/rulesets/main.json";

function reconcile(scenario: string) {
  const mock = `
    const scenario = ${JSON.stringify(scenario)}, policy = ${JSON.stringify(policy)};
    let tipReads = 0;
    globalThis.fetch = async (url, init) => {
      const route = new URL(url).pathname.split("playwright-agent-wrapper-starter/")[1];
      let result;
      if (route === "branches/main") result = { commit: { sha: ++tipReads > 1 && scenario === "advanced" ? "new" : "tip" } };
      else if (route.includes("workflows/ci.yml")) result = { workflow_runs: [{ id: 10, run_attempt: 2, head_sha: "tip", conclusion: "success" }] };
      else if (route.endsWith("/attempts/2/jobs")) result = { jobs: [{ name: "verify", conclusion: "success",
        steps: scenario === "legacy" ? [] : [{ name: "Challenge the pipeline verdict", conclusion: "success" }] }] };
      else if (route.includes("contents/")) result = { content: Buffer.from(JSON.stringify(policy)).toString("base64") };
      else if (route === "codeowners/errors") result = { errors: [] };
      else if (route === "rulesets" && init.method === "POST") {
        if (JSON.stringify(JSON.parse(init.body)) !== JSON.stringify(policy)) throw Error("Unexpected rule payload");
        result = { id: 42 };
      } else if (route === "rulesets") result = ["active","conflict"].includes(scenario) ? [{name: policy.name, id: 9}] : [];
      else if (route === "rulesets/9") result = { ...policy, enforcement: scenario === "active" ? "active" : "disabled" };
      else throw Error("Unexpected route " + route);
      return { ok: true, json: async () => result };
    };`;
  return spawnSync(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(mock),
    "scripts/main-ruleset.mjs", "--apply"], { encoding: "utf8", env: { ...process.env, GH_TOKEN: "fixture" } });
}

test("requires the Contrarian step on main and a stable head before activating", () => {
  for (const [scenario, message] of [["legacy", "Waiting for the Contrarian"], ["advanced", "Main advanced"],
    ["conflict", "differs from reviewed policy"]]) {
    const result = reconcile(scenario);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(message);
  }
});

test("activates the reviewed rule and recognizes an already active matching rule", () => {
  expect(reconcile("create").stdout).toContain("Activated ruleset 42");
  expect(reconcile("active").stdout).toContain("Active matching ruleset 9");
});
