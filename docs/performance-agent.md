# Run the performance agent

The agent answers one question: did task submission exceed the approved baseline by more than the team's allowance on a comparable runner? It works with a stdio MCP client or a process that sends JSON. The same TypeScript wrapper makes the decision for both. The default test suite requires no AI account.

## Who controls what

| Authority | Source of truth |
|---|---|
| Maintainer | The reviewed [policy](../agents/performance/policy.json) fixes the action, test project, literal spec, one headless worker, sample count and budget. The [role instructions](../agents/performance/AGENT.md) describe how to explain the result. |
| Operator or CI | Selects the approved candidate commit, baseline report and digest, and gives the job a fresh UUID. These values belong in the launch environment. |
| Wrapper | Checks the request, clean checkout, pinned baseline and job claim before launching the approved test. It parses the current run's native JSON, recomputes the median and decides whether to confirm. |
| Agent client | Can call `assess-performance` with `{}` and explain the finding and evidence. Policy edits, baseline promotion, approval and model-chosen commands are outside the tool surface. |

Run the service from a trusted installation of the approved wrapper and dependencies. Give the model only this tool in its host. Keep checkout, baseline, launcher settings and job ledger inaccessible for model writes. A worker can mount sources and the baseline read-only, with writable `artifacts/` and browser temporary storage. The model needs neither a shell nor general file, Git or Playwright tools. A model that independently has those permissions can bypass the tool. Reviewed tests and their configuration execute with the OS rights of the runner. Use a disposable, credential-free runner with loopback access for the benchmark.

## Establish a baseline and job

Install dependencies with `npm ci` and the browser with `npx playwright install chromium`. Use a clean checkout containing this version of the benchmark on both sides. Earlier reports lack the comparison metadata. On the reference commit, run:

```sh
node scripts/wrapper.cjs --project performance --spec tests/performance/task-timing.spec.ts --workers 1
```

Verify `status: passed` and retain the **native JSON file** named by `artifacts.testResultsJson`. Record its SHA-256 in your trusted baseline record when accepting it. Keep that file under operator control across candidate runs. The baseline and candidate may be the same revision for a setup check. For a change assessment, produce the baseline on the accepted reference revision and authorize the separate reviewed candidate revision. Use a fixed host or set the same operator-controlled `PW_PERF_RUNNER_CLASS` on equivalent machines when *both* measurements are taken.

Configure these values in the process that launches the tool. Example PowerShell for a local trial:

```powershell
$env:PW_AGENT_BASELINE_FILE = (Resolve-Path 'artifacts/wrapper-result-EXAMPLE/results.json').Path
$env:PW_AGENT_BASELINE_SHA256 = '<64 lowercase hex characters from the accepted baseline record>'
$env:PW_AGENT_REVISION = '<40 lowercase hex characters of the approved candidate commit>'
$env:PW_AGENT_JOB_ID = [guid]::NewGuid().ToString()
'{"name":"assess-performance","arguments":{}}' | node --import tsx src/playwright-wrapper/performance/cli.ts
```

Replace the example file and pins. To obtain the digest at enrollment, use `(Get-FileHash $env:PW_AGENT_BASELINE_FILE -Algorithm SHA256).Hash.ToLowerInvariant()`. Leave `TASK_MEDIAN_BUDGET_MS` unset for this comparison unless the operator also intends to enforce the benchmark's separate absolute test budget. A failure of the underlying test is reported as insufficient comparison evidence with the native failure preserved.

## Connect a different client

For an MCP host, register a **stdio** server with the absolute path to your Node executable as the command, and these three arguments:

```json
[
  "/absolute/checkout/node_modules/tsx/dist/cli.mjs",
  "/absolute/checkout/src/playwright-wrapper/performance/cli.ts",
  "--mcp"
]
```

Supply the operator environment above in the server configuration. The server advertises the role instructions and exactly one tool. Clients call `assess-performance` with no arguments. For clients without MCP, bind the JSON stdin/stdout command from the PowerShell example as a fixed function in the host and load the role instructions as agent context. Never interpolate prompt text into a command. Child diagnostics use stderr. No adapter needs a provider SDK, API key, or access to the complete report to return the finding.

## Read the decision

The allowance is the larger of 3 ms or 20% of the baseline median under the initial example policy. For a 10 ms baseline the limit is 13 ms. The wrapper accepts exactly ten samples, a single successful first attempt, an inline timing attachment, and matching browser, OS, architecture, Node, Playwright, runner class, benchmark code and measurement conditions.

| Finding | Meaning | JSON CLI exit |
|---|---|---|
| `within_budget` | The first comparable candidate median was at or below the limit. | 0 |
| `regression_reproduced` | Two independent, comparable runs on the authorized candidate exceeded the limit. | 1 |
| `insufficient_evidence` | Evidence is missing, incompatible, or contradictory. Inspect the reason and native run references. | 2 |
| `denied` | The action, arguments or host authorization failed, or this job was already consumed. | 2 |

The claim in `artifacts/performance-agent-jobs/<uuid>/` is atomic across processes sharing the checkout. One valid job permits one initial run and at most one confirmation, even across server restarts. A crash consumes the claim. Preserve the ledger for the job's lifetime and use the host scheduler for wall-clock limits and cross-machine quotas. Results identify the evidence by digest, revision, median and candidate report path. They carry no merge or publication authority.
