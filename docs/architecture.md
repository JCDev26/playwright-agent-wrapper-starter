# Architecture

This repository implements one bounded Playwright Test execution responsibility. AI reasoning remains external.

```text
External human / script / AI caller
  -> request validation
  -> literal target and argv construction
  -> fresh invocation-specific artifact root
  -> local Playwright child process
  -> native result inspection + best-effort artifact discovery
  -> normalized JSON result
```

## Responsibilities

- `contract/validateInputs.ts`: request types, normalization, fixed input policy.
- `contract/resultSchema.ts`: result types and constructors.
- `execution/runPlaywrightTarget.ts`: asynchronous invocation deadline, current-run artifacts, native judgment and terminal result.
- `execution/processLifecycle.ts` and `processTree.ts`: observed descendant identity, bounded cleanup and OS facilities.
- `execution/runAttribution.ts`: best-effort checkout observation; no attestation.
- `execution/playwrightJudgment.ts`: small Playwright-specific projection of native JSON errors, outcomes, attempts, and totals.
- `execution/runPlaywrightTargetCli.ts`: argument parsing, JSON output and CLI exit mapping.
- `artifacts/playwrightArtifacts.ts`: presence checks beneath one invocation's artifact root.

## Boundaries

Callers supply fields, not raw commands. Validated spec paths become escaped literal-file filters; grep remains a discrete Playwright regex argument. The child is Node plus the installed Playwright CLI with `shell: false`.

Rejected inputs never reach spawning. Passed/failed require current-run native test evidence consistent with the child exit code. No-tests/discovery failures cannot become failed-test judgments. Synchronous launch exceptions are structured; optional artifact scanning cannot replace the primary outcome.

Native JSON, HTML, JUnit and test assets use a fresh invocation-specific root. All references remain presence observations; only valid native JSON can establish test judgment. See [artifact model](artifact-model.md).

CLI syntax failures deliberately remain outside the JSON wrapper-result contract. Human-readable child output uses stderr.

## Trust and scope

Repository code, configuration, dependencies, the local account, and inherited environment are trusted. The request boundary is not OS/network isolation. Explicit worker values are bounded to 1–4; omitted values inherit Playwright defaults.

There is no LLM, agent runtime, contributor registry, workflow engine, generic evaluator, approval gate, protocol adapter, or historical evidence service. Native reports and external human judgment remain the review surface.

## V1 stop point

The final hardening pass ends at truthful result classification, literal spec selection, structured exception handling, directly related regressions, and accurate documentation. The separately authorized core reliability phase extends that stop point with whole-invocation deadlines, cancellation, observed-process cleanup and isolated artifacts. The dependency/deployment pilot remains deferred. See [lifecycle limits and API migration](execution-lifecycle.md).

See [contracts](contracts.md), [wrapper contract](wrapper-contract.md), [result schema](result-schema.md), and [review guidance](human-review-model.md).
