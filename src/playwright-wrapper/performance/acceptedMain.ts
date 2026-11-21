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

/** Freeze a stacked PR to the newest first-parent main commit reachable from its event base. */
export function stackedMainCutoff(base: string, cwd = process.cwd()): string {
  if (!shaPattern.test(base)) throw new Error("Invalid stacked pull request base.");
  const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const tip = git("rev-parse", "--verify", "refs/remotes/origin/" + branch + "^{commit}");
  // The first-parent main history is a single chain. Commits outside the base form a contiguous prefix.
  const ahead = git("rev-list", "--first-parent", "--count", tip, "--not", base);
  if (!/^\d+$/.test(ahead)) throw new Error("Could not locate the main history shared with the PR base.");
  return git("rev-parse", "--verify", tip + "~" + ahead + "^{commit}");
}

export function eventCutoff(name: string, event: {
  ref?: string; before?: string; repository?: { full_name: string };
  pull_request?: { base: { ref: string; sha: string; repo: { full_name: string } } };
}, stackedCutoff = stackedMainCutoff) {
  if (event.repository?.full_name.toLowerCase() !== repository.toLowerCase())
    throw new Error("Unexpected repository for accepted-main selection.");
  let sha;
  const base = event.pull_request?.base;
  if (name === "pull_request" && base?.ref && shaPattern.test(base.sha) &&
      base.repo.full_name.toLowerCase() === repository.toLowerCase())
    sha = base.ref === branch ? base.sha : stackedCutoff(base.sha);
  if (name === "push" && event.ref === "refs/heads/" + branch) sha = event.before;
  if (!sha || !shaPattern.test(sha)) throw new Error("Expected a repository pull request or a main push.");
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
