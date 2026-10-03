# Result schema

The wrapper returns `PlaywrightRunResult`. It reports request validity and a Playwright test judgment, not broader product correctness.

## Status and CLI exits

| Status | ok | Meaning | CLI exit |
| --- | --- | --- | --- |
| `validation_error` | false | Request rejected before Playwright execution. | 2 |
| `passed` | true | Current-run native results establish completed test attempts and an accepted Playwright outcome, consistent with child exit 0. | 0 |
| `failed` | true | Current-run native results establish completed test attempts and unexpected test outcomes, consistent with child exit 1. | 1 |
| `execution_error` | false | No trustworthy completed test judgment: preparation/launch failure, abnormal completion, runner/discovery errors, no tests, all skipped, or missing/unusable/contradictory result evidence. | 2 |

Playwright's expected-failure and retry semantics remain authoritative. An expected failure or a successful retry can contribute to `passed`; an unexpected pass of a test marked to fail can contribute to `failed`. Test-associated assertion, fixture, hook, or timeout failures remain Playwright test outcomes. Runner-level errors take precedence over test outcomes. Neither status diagnoses whether a defect belongs to the product, test, or environment.

Exit code alone never establishes `passed` or `failed`. A no-tests child exit of 1 produces wrapper `execution_error` and CLI exit 2.

## Result fields

- `ok`: true only when the wrapper established a completed test judgment.
- `status`: one of the four statuses above.
- `target`: normalized request on accepted inputs; an echo of interpretable rejected fields on validation failure. Rejected project names are not replaced by `smoke`.
- `command`: human-readable display of constructed argv, or null before construction succeeds. It is not a shell command to execute or an exact replay contract. The actual process is Node plus the local Playwright CLI. Literal spec filters contain an escaped absolute path.
- `exitCode`: observed Playwright child exit code. Null means no exit code was obtained: execution may never have started, or a launched process may have terminated without a numeric exit status. This is distinct from the wrapper CLI exit.
- `artifacts`: always present; see [artifact semantics](artifact-model.md).
- `summary.message` and `summary.nextReviewPoint`: human review guidance, not approval gates.
- `error`: structured code and explanatory detail for validation/execution errors; absent for passed/failed. Consumers should branch on status/code, not parse detail text.

## Current-run judgment

Each invocation prepares a fresh `artifacts/wrapper-result-<suffix>/results.json` location and passes it to the native JSON reporter through the child environment. Only that file can classify the invocation.

The wrapper checks native runner errors, nested test outcomes and completed attempts, outcome totals, and consistency with the child exit. Empty/all-skipped, interrupted, malformed, inconsistent, or absent results cannot establish a judgment. It does not parse console output or duplicate assertion evaluation.

## Error codes

- `INVALID_PROJECT`, `INVALID_SPEC`, `INVALID_GREP`, `INVALID_HEADED`, `INVALID_WORKERS`: request rejection.
- `COMMAND_CONSTRUCTION_FAILED`: invocation or result-location preparation failed, including local CLI resolution.
- `PROCESS_LAUNCH_FAILED`: synchronous launch exception or returned spawn error.
- `PROCESS_COMPLETION_FAILED`: missing exit status or a child code other than 0/1.
- `TEST_JUDGMENT_UNAVAILABLE`: child exited 0/1, but current-run evidence cannot establish a completed test judgment.

Ancillary HTML/JUnit/trace discovery failures do not replace these causes or a passed/failed result.

## Example outcome excerpts

A real failing test:

```json
{ "ok": true, "status": "failed", "exitCode": 1 }
```

A no-tests run:

```json
{
  "ok": false,
  "status": "execution_error",
  "exitCode": 1,
  "error": {
    "code": "TEST_JUDGMENT_UNAVAILABLE",
    "detail": "Playwright reported runner/discovery errors; no trustworthy test judgment."
  }
}
```

These are field excerpts; the actual result also includes target, command, artifacts, and summary.

## CLI syntax boundary

For requests reaching the wrapper, stdout contains one JSON result and Playwright human output goes to stderr. CLI syntax errors (unknown flags, missing flag values, missing required project) are intentionally outside this result contract: empty stdout, diagnostic stderr, exit 2. Runtime failures before the entrypoint can execute are also outside the contract.

Use direct CLI invocation or `npm run --silent wrapper:run` to avoid npm's banner on stdout.
