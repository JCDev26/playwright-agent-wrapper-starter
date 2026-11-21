# Gate a pipeline with the Contrarian Agent

The final reviewer answers whether this job has earned permission to advance. It receives one zero-argument tool, `review-verdict`. The wrapper reads evidence on a clean checkout and returns a deterministic decision. An MCP client can explain the challenges using the same endpoint that CI calls over JSON stdio. [Role instructions](../agents/contrarian/AGENT.md) · [Policy](../agents/contrarian/policy.json)

| Decision | Pipeline action | CLI exit |
|---|---|---|
| `approved` | Advance. The upstream job succeeded and its reported pass survived review. | 0 |
| `failure_confirmed` | Block. Inspect the named lane and its native reports for the cause. Other evidence can still be missing. | 1 |
| `needs_review` | Block. Investigate the listed discrepancies or restore missing evidence. | 2 |
| `denied` | Block. Check the requested tool, arguments, host grant and checkout. | 2 |

## What gets challenged

**Did every intended case run?** Before execution, the host runs Playwright discovery for the five projects in Reporting's policy. The gate matches each project's file, describe path and test title against the actual run. A newly added test enters that revision's plan automatically. A different test with the same total count leaves a discrepancy. Flaky outcomes, expected-failure annotations and unapproved skips trigger review. The policy permits the named case-sensitivity test to skip on a Windows producer. [Playwright CLI](https://playwright.dev/docs/test-cli) · [Suite review](../src/playwright-wrapper/contrarian/suiteReview.ts)

**Did a red pipeline establish a failed check?** A suite failure needs a planned case expected to pass, a completed failed or timed-out attempt, and a consistent native judgment. A setup failure in a planned test can qualify as a failed test. Inspect its trace to diagnose the cause. An infrastructure-only red, an unexpectedly passing expected-failure annotation, and a failure in an extra off-plan test all block for investigation.

**Do the specialists' verdicts survive their original evidence?** The gate rereads Security's three inline assertion observations. It recalculates the baseline and candidate medians from Performance's raw samples, checks the accepted-main authority and workload, and requires two independent comparable overruns to confirm a regression. The host's initial-main enrollment path requires its own passing native timing observation. All replayed reports must identify this job and checkout. [Native corroboration](../src/playwright-wrapper/contrarian/nativeChecks.ts)

**Does Reporting agree?** The reviewer verifies the host's hashes, reconstructs Reporting's projection from the sealed inputs, and compares it with the submitted summary. `confirmedFailures` lists supported negative outcomes. `challenges` identifies gaps and contradictions. A supported failure remains visible alongside a gap in another lane.

## GitHub Actions

`collect` produces the evidence. `verify` runs on a fresh runner after either a successful or failed collection, and opens the fixed evidence bundle by its artifact ID. The job ID, expected SHA-256 digests and upstream outcome travel separately through Actions outputs. Only the reviewed job's exit zero and matching `approved` receipt can produce `advance=true`. Missing job inputs and setup errors fail the gate. The final job summary and `contrarian-…` artifact contain the decision. [Workflow](../.github/workflows/ci.yml)

Give downstream jobs `needs: verify`. Their default success condition waits for this gate. Use the `verify` required status check on a protected target branch to extend the rule to merges. The CI host, checked-in tests, reviewer and policy are trusted code. Protected workflow ownership or independent maintainer review covers changes to those sources. Maintainers own merge and release approval. [GitHub required checks](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches) · [GitHub job dependencies](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idneeds)

## Other pipelines

Use a clean checkout with the locked dependencies. The collector can reuse the Security, Performance and Reporting commands. Keep the following JSON bindings in operator-controlled storage outside the test artifacts.

1. Run `node --import tsx scripts/agent-job.ts init` and save stdout as `job.json`. Pass its `PW_AGENT_JOB_ID` and `PW_AGENT_REVISION` to the operator commands and governed specialists.
2. Run `node --import tsx scripts/review-plan.ts` before the suite and save stdout as `plan.json`. Run the five projects in `npm run test:ci` with `PLAYWRIGHT_JSON_OUTPUT_FILE` set to the job's `suite.json`. An ordinary suite can receive just `PW_EVIDENCE_JOB_ID` and `PW_EVIDENCE_REVISION` to stamp its native metadata. Record its actual exit code.
3. Capture the Security and Performance findings in this job's directory. Seal with `node --import tsx scripts/agent-job.ts seal required <suite-exit-code>` and save stdout as `manifest-binding.json`. Give its pin to Reporting and write Reporting's original stdout to the job's `summary.json`. [Collection and sealing](reporting-agent.md) · [Accepted-main preparation](performance-agent.md)
4. With the same job, manifest pin and original accepted-main binding, run `node --import tsx scripts/agent-job.ts review-inputs required` and save stdout as `review.json`. Transfer the fixed JSON evidence to `artifacts/reporting/<job-id>/` on the review worker. Transfer the four operator bindings independently. Execute the reviewer after both green and red upstream jobs.

For a Bash-based review worker, `BINDINGS` below is the directory containing those four host bindings. Set `COLLECTION_RESULT` from the scheduler's actual upstream outcome and `COLLECTION_PLATFORM` from Node's `process.platform` on the producer.

```bash
export PW_AGENT_UPSTREAM_RESULT="${COLLECTION_RESULT:?missing upstream outcome}"
export PW_AGENT_PRODUCER_PLATFORM="${COLLECTION_PLATFORM:?missing producer platform}"
jq -sr 'add | to_entries[] | "\(.key)=\(.value)"' \
  "$BINDINGS/job.json" "$BINDINGS/plan.json" "$BINDINGS/manifest-binding.json" "$BINDINGS/review.json" \
  > "$BINDINGS/review.env" || exit 2
printf '%s\n' '{"name":"review-verdict","arguments":{}}' |
  node --env-file="$BINDINGS/review.env" --import tsx src/playwright-wrapper/contrarian/cli.ts
```

Propagate that process's exit code as the gate. For MCP, supply the same operator-bound environment and start the absolute Contrarian CLI with `--mcp`. Scope the client to the single tool and mount inputs read-only. Either transport performs the review entirely on the collected files.
