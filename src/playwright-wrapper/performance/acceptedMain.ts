import { execFileSync } from "node:child_process";
import policy from "../../../agents/performance/policy.json";

const { repository, branch, workflow } = policy.reference;
const shaPattern = /^[0-9a-f]{40}$/;
export class NoAcceptedMain extends Error {}

interface WorkflowRun {
  id: number; head_sha: string; head_branch: string; event: string; status: string; conclusion: string | null;
  repository: { full_name: string };
}

export async function selectAcceptedMain(
  history: string[], latestRun: (sha: string) => Promise<WorkflowRun | undefined>,
) {
  for (const sha of history) {
    const run = await latestRun(sha);
    if (run && run.head_sha === sha && run.head_branch === branch && run.event === "push" &&
        run.repository.full_name.toLowerCase() === repository.toLowerCase() &&
        run.status === "completed" && run.conclusion === "success" && Number.isSafeInteger(run.id) && run.id > 0)
      return { revision: sha, runId: String(run.id) };
  }
  throw new NoAcceptedMain("No successful main push CI was found in the eligible first-parent history.");
}

export function eventCutoff(name: string, event: {
  ref?: string; before?: string; repository?: { full_name: string };
  pull_request?: { base: { ref: string; sha: string; repo: { full_name: string } } };
}) {
  if (event.repository?.full_name.toLowerCase() !== repository.toLowerCase())
    throw new Error("Unexpected repository for accepted-main selection.");
  let sha;
  if (name === "pull_request" && event.pull_request?.base.ref === branch &&
      event.pull_request.base.repo.full_name.toLowerCase() === repository.toLowerCase()) sha = event.pull_request.base.sha;
  if (name === "push" && event.ref === "refs/heads/" + branch) sha = event.before;
  if (!sha || !shaPattern.test(sha)) throw new Error("Expected a pull request to main or a main push.");
  if (/^0+$/.test(sha)) throw new NoAcceptedMain("Initial main push has no predecessor.");
  return sha;
}

export async function resolveAcceptedMain(eventAnchor: string | undefined, token?: string) {
  async function api(endpoint: string) {
    const response = await fetch("https://api.github.com/repos/" + repository + "/" + endpoint, {
      headers: { Accept: "application/vnd.github+json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      signal: AbortSignal.timeout(15000), redirect: "error",
    });
    if (!response.ok) throw new Error("GitHub baseline lookup failed (HTTP " + response.status + ").");
    return response.json();
  }
  const anchor = eventAnchor ?? (await api("git/ref/heads/" + branch)).object.sha;
  if (typeof anchor !== "string" || !shaPattern.test(anchor)) throw new Error("Invalid main cutoff.");
  if (execFileSync("git", ["rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() !== "false")
    throw new Error("Fetch full main history before preparing the baseline.");
  const history = execFileSync("git", ["rev-list", "--first-parent", anchor], { encoding: "utf8" }).trim().split(/\s+/);
  const selected = await selectAcceptedMain(history, async sha => {
    // Query by revision so a rerun of an older commit cannot outrank a newer main commit.
    const data = await api(`actions/workflows/${workflow}/runs?branch=${branch}&event=push&head_sha=${sha}&per_page=1`);
    if (!Array.isArray(data.workflow_runs)) throw new Error("Invalid GitHub workflow run listing.");
    return data.workflow_runs[0];
  });
  return { anchor, ...selected };
}
