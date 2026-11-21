# Run the performance agent

The agent answers one question: did task submission exceed the last accepted main baseline by more than the team's allowance on a comparable runner? It works with a stdio MCP client or a process that sends JSON. The same TypeScript wrapper makes the decision for both. The default test suite requires no AI account.

## Who controls what

| Authority | Source of truth |
|---|---|
| Maintainer | The reviewed [policy](../agents/performance/policy.json) fixes the action, test project, literal spec, one headless worker, sample count and budget. The [role instructions](../agents/performance/AGENT.md) describe how to explain the result. |
| Operator or CI | Resolves accepted main, measures that revision, and pins the acceptance run, native report digest and approved candidate for one job. These values belong in the launch environment. |
| Wrapper | Checks the request, clean checkout, pinned baseline and job claim before launching the approved test. It parses the current run's native JSON, recomputes the median and decides whether to confirm. |
| Agent client | Can call `assess-performance` with `{}` and explain the finding and evidence. Policy edits, baseline promotion, approval and model-chosen commands are outside the tool surface. |

Run the service from a trusted installation of the approved wrapper and dependencies. Give the model only this tool in its host. Keep checkout, baseline, launcher settings and job ledger inaccessible for model writes. A worker can mount sources and the baseline read-only, with writable `artifacts/` and browser temporary storage. The model needs neither a shell nor general file, Git or Playwright tools. A model that independently has those permissions can bypass the tool. Reviewed tests and their configuration execute with the OS rights of the runner. Use a disposable, credential-free runner with loopback access for the benchmark.

## Establish a baseline and job

Install dependencies with `npm ci` and Chromium with `npx playwright install chromium`. Start in a clean candidate checkout with full main history. If the checkout is stale, fetch `origin main` first.

**Accepted main** is the nearest first-parent main commit whose latest push run of this repository's `ci.yml` completed successfully. The resolver starts at the PR event's main base SHA, the previous main tip on a main push, or the live GitHub main tip for a local job. It skips failed, pending and untested commits. A rerun on an older commit cannot outrank a nearer accepted commit. GitHub lookup and checkout errors stop preparation. On main's first enrollment with no eligible predecessor, CI records a standalone benchmark and labels the comparison unavailable.

**The baseline is a fresh measurement of that accepted app.** The preparer puts the selected revision in a temporary detached worktree. The candidate's benchmark runs against that worktree's task board, then against the candidate's board on the same runner. Both use the same workload and browser. Evidence records the app SHA separately from the harness SHA. This also works when the accepted app predates the agent's report format. An incompatible reference app stops the job.

From PowerShell, prepare and run one assessment:

```powershell
$binding = node --import tsx src/playwright-wrapper/performance/prepareMain.ts
if ($LASTEXITCODE -ne 0) { throw 'Accepted-main preparation failed.' }
($binding | ConvertFrom-Json).PSObject.Properties | ForEach-Object {
  [Environment]::SetEnvironmentVariable($_.Name, [string]$_.Value, 'Process')
}
'{"name":"assess-performance","arguments":{}}' | node --import tsx src/playwright-wrapper/performance/cli.ts
```

The operator-only preparer is also available as `npm run --silent agent:prepare`. It prints the job environment as JSON on stdout, with diagnostics on stderr. CI supplies read-only access to Actions and repository metadata. Locally the public repository supports anonymous lookup, or the operator can supply `PW_MAIN_READ_TOKEN` to preparation. That variable is removed from the reference benchmark's child environment. Use the generated binding when launching MCP, with no GitHub credential in the agent environment. Baseline selection is outside the agent's tool surface.

## Keep workload growth distinct from latency

The policy seeds 50 open tasks through the API before timing starts. Both sides then perform one warm-up and ten measured submissions. The metric covers submission through the counter DOM update. Setup time, suite duration, and the number of other tests are excluded. The literal spec and benchmark tag select the journey even when new tests are added. Changing the governed sample count or starting data size reruns **both** apps under the new workload. Reports from a different workload cannot establish a regression.

A larger product can legitimately take longer. Reproduced latency growth at the same load is still reported for review. Adding tests or features never automatically increases the allowance. After an intentional change is accepted on main, that revision becomes eligible for future comparisons. An independently configured `TASK_MEDIAN_BUDGET_MS` can enforce an absolute candidate target across many small changes. Violating that target preserves the failed native judgment and produces insufficient comparison evidence. The reference collection is measurement-only.

## Connect a different client

For an MCP host, register a **stdio** server with the absolute path to your Node executable as the command, and these three arguments:

```json
[
  "/absolute/checkout/node_modules/tsx/dist/cli.mjs",
  "/absolute/checkout/src/playwright-wrapper/performance/cli.ts",
  "--mcp"
]
```

Supply the generated job environment in the server configuration. The server advertises the role instructions and exactly one tool. Clients call `assess-performance` with no arguments. For clients without MCP, bind the JSON stdin/stdout command from the PowerShell example as a fixed function in the host and load the role instructions as agent context. Never interpolate prompt text into a command. Child diagnostics use stderr. No adapter needs a provider SDK, API key, or access to the complete report to return the finding.

## Read the decision

The allowance is the larger of 3 ms or 20% of the baseline median under the initial example policy. For a 10 ms baseline the limit is 13 ms. The wrapper accepts exactly ten samples, a single successful first attempt, an inline timing attachment, and matching browser, OS, architecture, Node, Playwright, runner class, benchmark code and measurement conditions.

| Finding | Meaning | JSON CLI exit |
|---|---|---|
| `within_budget` | The first comparable candidate median was at or below the limit. | 0 |
| `regression_reproduced` | Two independent, comparable runs on the authorized candidate exceeded the limit. | 1 |
| `insufficient_evidence` | Evidence is missing, incompatible, or contradictory. Inspect the reason and native run references. | 2 |
| `denied` | The action, arguments or host authorization failed, or this job was already consumed. | 2 |

The claim in `artifacts/performance-agent-jobs/<uuid>/` is atomic across processes sharing the checkout. One valid job permits one initial run and at most one confirmation, even across server restarts. A crash consumes the claim. Preserve the ledger for the job's lifetime and use the host scheduler for wall-clock limits and cross-machine quotas. Results identify the evidence by digest, revision, median and candidate report path. They carry no merge or publication authority.
