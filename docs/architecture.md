# Architecture

This repository implements one bounded Playwright Test execution responsibility. AI reasoning remains external.

```text
External human / script / AI caller
  -> request validation
  -> literal target and argv construction
  -> fresh native JSON result destination
  -> local Playwright child process
  -> native result inspection + best-effort artifact discovery
  -> normalized JSON result
```

## Responsibilities

- `contract/validateInputs.ts`: request types, normalization, fixed input policy.
- `contract/resultSchema.ts`: result types and constructors.
- `execution/runPlaywrightTarget.ts`: invocation boundary, process handling, current-run report destination, terminal result.
- `execution/playwrightJudgment.ts`: small Playwright-specific projection of native JSON errors, outcomes, attempts, and totals.
- `execution/runPlaywrightTargetCli.ts`: argument parsing, JSON output and CLI exit mapping.
- `artifacts/playwrightArtifacts.ts`: presence checks for shared native report/trace paths.

## Boundaries

Callers supply fields, not raw commands. Validated spec paths become escaped literal-file filters; grep remains a discrete Playwright regex argument. The child is Node plus the installed Playwright CLI with `shell: false`.

Rejected inputs never reach spawning. Passed/failed require current-run native test evidence consistent with the child exit code. No-tests/discovery failures cannot become failed-test judgments. Synchronous launch exceptions are structured; optional artifact scanning cannot replace the primary outcome.

The JSON reporter writes into a fresh invocation-specific directory solely to prevent stale or overlapping machine reports from determining a verdict. Other report paths remain shared/presence-based. See [artifact model](artifact-model.md).

CLI syntax failures deliberately remain outside the JSON wrapper-result contract. Human-readable child output uses stderr.

## Trust and scope

Repository code, configuration, dependencies, the local account, and inherited environment are trusted. The request boundary is not OS/network isolation. Explicit worker values are bounded to 1–4; omitted values inherit Playwright defaults.

There is no LLM, agent runtime, contributor registry, workflow engine, generic evaluator, approval gate, protocol adapter, or historical evidence service. Native reports and external human judgment remain the review surface.

## V1 stop point

The final hardening pass ends at truthful result classification, literal spec selection, structured exception handling, directly related regressions, and accurate documentation. Optional run-management features are not part of v1.

See [contracts](contracts.md), [wrapper contract](wrapper-contract.md), [result schema](result-schema.md), and [review guidance](human-review-model.md).
