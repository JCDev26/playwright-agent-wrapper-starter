# Read the reporting agent's evidence

The Reporting Agent answers what the approved checkout's tests established in one job. It returns the same structured result through MCP and JSON stdio. A second read of the same sealed inputs gives the same answer. The maintainer owns the expected suite projects and file limits. [Reporting policy](../agents/reporting/policy.json)

## Read a CI result

Open **Playwright verification** in the **collect** job summary. In the downloaded artifact, open `reporting/<job-id>/summary.json` alongside the sealed manifest and enrolled inputs. Start with `knownFailures` and `incompleteSources`. A confirmed failure takes precedence over a missing input, so both lists can contain entries in the same job. The final **verify** job uses the summary as the claim under review. [GitHub Actions workflow](../.github/workflows/ci.yml) · [Contrarian Agent](contrarian-agent.md)

| Overall status | What it establishes | CLI exit |
|---|---|---|
| `passed` | The scheduled sources established accepted outcomes. Check coverage and skipped cases. | 0 |
| `failed` | The native suite recorded an unexpected test outcome, a security check failed, or two comparable performance runs exceeded budget. | 1 |
| `inconclusive` | An expected source is missing, inconsistent or incomplete and the verified inputs establish no failure. | 2 |
| `denied` | The request or clean checkout failed authorization. | 2 |

The suite shows native `expected`, `unexpected`, `flaky` and `skipped` counts per project. A test annotated to fail can contribute to `expected`. A successful retry can contribute to `flaky`. Skips yield `partial` coverage. If a scheduled project has zero completed tests, the suite cannot establish a passing result. The policy sets no fixed test count. [Playwright test outcomes](https://playwright.dev/docs/api/class-testcase#test-case-outcome)

Security and Performance carry `evidence: "host_attested_finding"`. The reporter verifies each enrolled finding's bytes, job identity, policy version and decision consistency. Security projects the policy's named checks. Performance checks the comparison arithmetic, candidate revision and independent report digests. The originating specialist examined the underlying reports and the host vouches for collection. The reporter reads only the enrolled receipt for each specialist. A native benchmark or fixture failure can leave a specialist's decision `insufficient_evidence`. Its native status remains visible. [Security Agent](security-agent.md) · [Performance Agent](performance-agent.md)

## Run a local job

This Bash example schedules the five suite projects and Security. Start in a clean checkout with the locked packages, Chromium, WebKit and `jq` installed.

```bash
grant=$(node --import tsx scripts/agent-job.ts init) || exit 2
export PW_AGENT_JOB_ID=$(jq -er .PW_AGENT_JOB_ID <<<"$grant")
export PW_AGENT_REVISION=$(jq -er .PW_AGENT_REVISION <<<"$grant")
directory="$PWD/artifacts/reporting/$PW_AGENT_JOB_ID"

suite_exit=0
PLAYWRIGHT_JSON_OUTPUT_FILE="$directory/suite.json" npm run test:ci || suite_exit=$?
printf '%s\n' '{"name":"assess-security","arguments":{}}' |
  node --import tsx src/playwright-wrapper/security/cli.ts > "$directory/security.json" ||
  echo 'Security returned a finding that requires review.' >&2

binding=$(node --import tsx scripts/agent-job.ts seal not-scheduled "$suite_exit") || exit 2
export PW_AGENT_REPORT_MANIFEST_SHA256=$(jq -er .PW_AGENT_REPORT_MANIFEST_SHA256 <<<"$binding")
printf '%s\n' '{"name":"summarize-evidence","arguments":{}}' |
  node --import tsx src/playwright-wrapper/reporting/cli.ts
```

For a job that schedules Performance, prepare the accepted-main binding with the same job ID, run its assessment, and redirect its JSON stdout to `$directory/performance.json` before sealing. Use `seal required "$suite_exit"` even if preparation failed. The reporter will show missing evidence. When the suite never starts, pass `missing` as the exit-code argument. CI uses an explicitly unscheduled comparison during initial main enrollment. [Prepare the performance binding](performance-agent.md)

## Connect a client

Register the absolute Node executable as an MCP stdio server. Use the absolute paths to `node_modules/tsx/dist/cli.mjs` and `src/playwright-wrapper/reporting/cli.ts` as the first two arguments, followed by `--mcp`. Supply the three `PW_AGENT_*` variables from the sealed job. The tool accepts `summarize-evidence` with `{}`. A JSON client can send the same request to `npm run --silent agent:reporting`. The checked-in role instructions describe how to explain a partial result. [Reporting role](../agents/reporting/AGENT.md)

## Host evidence contract

The operator reserves a fresh UUID directory in this checkout and captures each invocation's original JSON bytes there. Use byte-preserving redirection on Windows, such as PowerShell 7.4+ native stdout redirection. Seal the directory once and give the Reporting Agent read-only access to the artifacts. Keep the manifest pin and permission to write or replace evidence with the host. [PowerShell native stdout redirection](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection#redirecting-output-from-native-commands)

| File under `artifacts/reporting/<job-id>/` | Binding in manifest version 1 |
|---|---|
| `suite.json` | `suite: {sha256, exitCode}` or `null`. The host attests which invocation produced the native report and its actual exit code. |
| `security.json` | `security: {sha256}` or `null`. Security is expected in every job. |
| `performance.json` | `performance: {expected, sha256}`. A null digest marks missing or unscheduled evidence according to `expected`. |
| `manifest.json` | Contains `schemaVersion: 1`, `jobId`, `revision` and exactly the three bindings above. Its SHA-256 comes from the operator's launch environment. |

The reader opens fixed names under the approved checkout, rejects links and enforces byte limits before JSON parsing. It compares the suite's reported totals with completed attempts and checks each specialist finding against its policy. The returned projection contains controlled statuses, identifiers and measurements. Titles, diagnostics, HTML, attachment contents and paths inside receipts stay in the original artifacts for human review. The maintainer retains release and baseline approval. [Reporter implementation](../src/playwright-wrapper/reporting/summarizeEvidence.ts)
