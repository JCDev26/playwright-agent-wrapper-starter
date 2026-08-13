# Result schema

This document defines the normalized result model returned by the wrapper layer.

The purpose of this schema is not to mirror every Playwright internal detail. Its purpose is to provide a compact, review-friendly execution record that another system can consume reliably and a human can inspect quickly.

## Why this schema exists

Raw process output is not a strong contract.

Terminal logs, runner output, and scattered artifacts may be useful for debugging, but they are a weak interface for governed execution. They make it harder to distinguish policy failures from execution failures, harder to confirm what was actually run, and harder to guide human review.

This schema exists to provide a narrower and more useful model:

- preserve the approved target in structured form
- distinguish wrapper-level failures from test-run outcomes
- expose the constructed command for review
- surface artifact references as first-class evidence
- provide enough summary context for a reviewer to know where to look next

The result model is part of the execution boundary, not just a convenience after the fact.

## Design goals

The first version of the result schema is designed to do a few things well:

- communicate whether the wrapper completed its own job
- normalize outcome status into a small readable set
- echo the approved target in structured form
- expose the constructed command for review
- include artifact references in a stable location
- provide a short summary that supports the next review step

It is intentionally compact.

## Canonical example

```json
{
  "ok": true,
  "status": "passed",
  "target": {
    "project": "smoke",
    "spec": "tests/smoke/example.spec.ts",
    "grep": null,
    "headed": false,
    "workers": 1
  },
  "command": "npx playwright test --project smoke tests/smoke/example.spec.ts --workers 1",
  "exitCode": 0,
  "artifacts": {
    "htmlReport": "artifacts/playwright-report/index.html",
    "testResultsJson": "artifacts/test-results.json",
    "testResultsXml": "artifacts/test-results.xml",
    "traceFiles": []
  },
  "summary": {
    "message": "Playwright run completed successfully.",
    "nextReviewPoint": "Open the HTML report if deeper inspection is needed."
  }
}
```

## Schema overview

The first-version result shape is expected to contain:

- `ok`
- `status`
- `target`
- `command`
- `exitCode`
- `artifacts`
- `summary`

Each field exists to answer a different review question.

## Core semantic model

The result schema deliberately separates three questions:

### 1. Request validity

Was the request accepted under wrapper policy?

This is primarily reflected by `ok` and `status`.

### 2. Execution completion

Did the wrapper successfully construct and attempt the Playwright run, and did the process complete in a normal way?

This is reflected by `ok`, `status`, and `exitCode`.

### 3. Test outcome

Did the selected Playwright target pass or fail?

This is reflected by `status`.

These questions are related, but they are not the same. The schema is stronger because it does not collapse them into one vague success flag.

## Field definitions

### `ok`

Type: boolean

This field answers the wrapper-level question:

**Did the wrapper complete its operational responsibility successfully?**

That responsibility includes:

- validating the request
- constructing the approved invocation
- attempting execution when validation passes
- returning a normalized result

`ok` is therefore about wrapper behavior, not just test outcome.

#### Required interpretation

- `ok: true` means the wrapper accepted the request and completed its execution responsibility
- `ok: false` means the wrapper did not complete that responsibility successfully

#### Important consequence

A failing Playwright test run can still return `ok: true`.

That is expected when:

- the request was valid
- the run was launched successfully
- Playwright completed normally
- the selected tests failed

A validation rejection or execution problem should return `ok: false`.

### `status`

Type: string

This field provides a normalized outcome classification.

For v1, the allowed set should stay deliberately small:

- `passed`
- `failed`
- `validation_error`
- `execution_error`

#### Status meanings

- `passed` means the wrapper completed successfully and the Playwright run completed with passing tests
- `failed` means the wrapper completed successfully and the Playwright run completed with failing tests
- `validation_error` means the wrapper rejected the request before execution
- `execution_error` means the wrapper attempted execution but could not complete the run normally

#### Status and `ok` compatibility rules

The following combinations should be treated as valid in v1:

- `ok: true` with `status: passed`
- `ok: true` with `status: failed`
- `ok: false` with `status: validation_error`
- `ok: false` with `status: execution_error`

The following combinations should be treated as invalid or contradictory:

- `ok: true` with `status: validation_error`
- `ok: true` with `status: execution_error`
- `ok: false` with `status: passed`
- `ok: false` with `status: failed`

This keeps the model simple and internally consistent.

### `target`

Type: object

This field is an echo of the request as interpreted by the wrapper (`PlaywrightTargetEcho`).

Its purpose is to preserve what the wrapper believed it was asked to run — including rejected values when validation fails.

Expected v1 fields:

- `project`
- `spec`
- `grep`
- `headed`
- `workers`

On `validation_error`, `project` must echo the caller-supplied value when it was a string. Rejected project names must not be rewritten to an allowlisted default such as `"smoke"`.

This matters because the target is the request echo, while the command is the derived invocation. Those should be related, but not conceptually merged.

For v1, the stronger default is to always include a target echo in the result so the review shape remains stable.

### `command`

Type: string or null

This field is a human-readable representation of the constructed Playwright invocation.

It improves reviewability by making the execution shape visible without exposing raw caller-supplied shell text as part of the public interface.

#### Command rules

- if validation passed and a command was constructed, `command` should be present
- if validation failed before command construction, `command` should be `null`

This field should always reflect validated and normalized input only.

### `exitCode`

Type: number or null

This field captures the process exit code when execution occurred.

#### Exit code rules

- if the Playwright process was launched, `exitCode` should contain the observed process exit code
- if execution never started, `exitCode` should be `null`

#### Required interpretation

- `exitCode: 0` usually corresponds to a passing run
- non-zero `exitCode` may correspond to failing tests or execution problems
- `exitCode: null` means no process was launched

The schema should not imply process semantics when execution never began.

### `artifacts`

Type: object

This field contains compact references to evidence produced or expected from the run.

For v1, the structure should remain small and predictable.

Example fields:

- `htmlReport`
- `testResultsJson`
- `testResultsXml`
- `traceFiles`

Artifact values should use repo-relative paths.

This field exists because evidence is part of the review contract, not an incidental byproduct.

For v1, the artifact object should always be present.

Missing scalar artifact files should be represented by `null`.

`traceFiles` should always be an array, even when empty.

Artifact keys should never be omitted from the result shape.

### `summary`

Type: object

This field provides a small human-review-oriented summary.

Recommended v1 fields:

- `message`
- `nextReviewPoint`

This is intentionally modest.

The goal is not to create a verbose reporting layer. The goal is to make the result immediately useful to a reviewer who wants to know what happened and what to inspect next.

## Outcome matrix

The intended v1 interpretation is:

| `ok` | `status` | Meaning | Typical reviewer action |
|---|---|---|---|
| `true` | `passed` | Wrapper completed successfully and tests passed | Record success, inspect artifacts only if needed |
| `true` | `failed` | Wrapper completed successfully and tests failed | Open HTML report, then inspect traces if needed |
| `false` | `validation_error` | Request was rejected before execution | Fix request shape or caller behavior |
| `false` | `execution_error` | Execution did not complete normally | Inspect environment, wrapper behavior, and available artifacts |

This is enough for v1.

## Example interpretation scenarios

### Passing run

```json
{
  "ok": true,
  "status": "passed",
  "exitCode": 0
}
```

Interpretation:

- the wrapper accepted the request
- execution completed
- the selected target passed

### Failing test run

```json
{
  "ok": true,
  "status": "failed",
  "exitCode": 1
}
```

Interpretation:

- the wrapper did its job correctly
- Playwright ran and completed
- the selected target failed

This is not an execution-boundary failure.

### Validation rejection

```json
{
  "ok": false,
  "status": "validation_error",
  "command": null,
  "exitCode": null
}
```

Interpretation:

- the wrapper rejected the request before execution
- the failure occurred at the trust boundary
- this is a policy or input issue, not a test result

### Execution problem

```json
{
  "ok": false,
  "status": "execution_error",
  "command": "npx playwright test --project smoke tests/smoke/example.spec.ts",
  "exitCode": 1
}
```

Interpretation:

- the wrapper accepted the request and attempted execution
- the run did not complete normally
- the problem is operational rather than a simple failing assertion

## Error detail posture

The v1 schema intentionally keeps top-level status small.

Richer structured error detail may be added later, such as:

- validation failure reason codes
- field-level validation errors
- execution failure classifications
- stderr or debug references

Those are reasonable extensions, but they are not required to prove the core pattern.

The stronger v1 choice is to keep top-level semantics stable and understandable.

## Review-oriented interpretation

A reviewer looking at one result should be able to answer:

- what was requested
- whether the request was accepted
- what the wrapper actually ran
- whether execution completed normally
- whether tests passed or failed
- where the evidence lives
- what should be inspected next

If the schema supports those questions well, it is doing its job.

## Non-goals

This schema is not trying to be:

- a complete Playwright report format
- a telemetry platform
- a historical analytics model
- a replacement for native Playwright artifacts
- a generic result contract for every possible tool

It exists for one bounded purpose: governed Playwright execution with review-friendly outputs.

## Extension posture

The first version should resist the urge to over-model.

Possible future additions might include:

- duration fields
- timestamps
- richer validation detail
- structured error objects
- artifact existence flags
- artifact counts or classifications

Those may be useful later, but they are not required to prove the core pattern.

The stronger design choice in v1 is to keep the schema small, interpretable, and stable.

## Design stance

This result schema is deliberately shaped around reviewability.

It assumes that successful agent-assisted execution is not just about running a command. It is about producing a result that can be trusted, understood, and acted on.

That is the standard this repository is trying to demonstrate.