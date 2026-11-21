# Architecture

This repository implements one bounded Playwright Test execution responsibility. AI reasoning remains external.

```text
External human / script / AI caller
  -> request validation
  -> local pre-flight doctor
  -> literal target and argv construction
  -> fresh native report and test-output destinations
  -> local Playwright child process
  -> native result inspection + best-effort artifact discovery
  -> normalized JSON result
```

## Responsibilities

- `scripts/wrapper.cjs`: unit-profile bootstrap before TSX; blocked health goes to stderr outside the normalized result contract.
- `scripts/doctor.cjs`: local prerequisite probes; valid library requests probe the selected browser before target execution.
- `contract/validateInputs.ts`: request types, normalization, fixed input policy.
- `contract/resultSchema.ts`: result types and constructors.
- `execution/runPlaywrightTarget.ts`: invocation boundary, process handling, current-run report destination, terminal result.
- `execution/playwrightJudgment.ts`: small Playwright-specific projection of native JSON errors, outcomes, attempts, and totals.
- `execution/runPlaywrightTargetCli.ts`: argument parsing, JSON output and CLI exit mapping.
- `artifacts/playwrightArtifacts.ts`: presence checks for invocation-scoped native report/trace paths.

## Boundaries

Callers supply fields, not raw commands. Validated spec paths become escaped literal-file filters; grep remains a discrete Playwright regex argument. The child is Node plus the installed Playwright CLI with `shell: false`.

Rejected inputs never reach spawning. Passed/failed require current-run native test evidence consistent with the child exit code. No-tests/discovery failures cannot become failed-test judgments. Synchronous launch exceptions are structured; optional artifact scanning cannot replace the primary outcome.

Native JSON, HTML, JUnit, and test output use a fresh invocation-specific directory. JSON determines the judgment; ancillary reports remain presence-based references within that directory. See [artifact model](artifact-model.md).

CLI syntax and bootstrap failures deliberately remain outside the JSON wrapper-result contract. Human-readable child output uses stderr.

## Trust and scope

Repository code, configuration, dependencies, the local account, and inherited environment are trusted. The request boundary is not OS/network isolation. Explicit worker values are bounded to 1–4; omitted values inherit Playwright defaults.

The general wrapper returns native judgments for trusted callers. The optional [performance agent](performance-agent.md) exposes one narrower tool over JSON stdio and MCP. Its wrapper-side policy binds the test target, validates the host's job and evidence pins, and limits confirmation. Model selection and tool permissions belong to the host. Native reports and external human judgment remain the review surface.

## V1 stop point

The final hardening pass ends at truthful result classification, literal spec selection, structured exception handling, directly related regressions, and accurate documentation. Optional run-management features are not part of v1.

See [contracts](contracts.md), [wrapper contract](wrapper-contract.md), [result schema](result-schema.md), and [review guidance](human-review-model.md).
