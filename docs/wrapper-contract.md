# Wrapper contract

This document defines the public execution contract for the wrapper layer in this repository.

The wrapper does not replace Playwright. It defines a governed boundary around Playwright execution that another system can call and a human can review.

## Why this contract exists

AI-assisted workflows are often weakest at the execution boundary.

A reasoning system may be useful for deciding what to run, but that does not mean it should be allowed to construct arbitrary terminal commands or operate directly against the environment without constraints.

This wrapper contract enforces a narrower model:

- the caller provides a small validated request
- the wrapper decides whether that request is allowed
- the wrapper constructs an approved Playwright invocation
- the wrapper returns a normalized result and artifact references
- a human or another system can review the outcome without reconstructing raw shell behavior

## Execution boundary

The wrapper is the execution boundary between external reasoning and local Playwright runs.

That boundary exists to prevent a caller from:

- requesting arbitrary shell execution
- injecting unapproved Playwright flags
- escaping approved repo-relative test paths
- treating raw command construction as part of the public interface
- bypassing result normalization and evidence collection

The wrapper accepts intent in a narrow request shape.

It does not accept raw shell text.

It does not expose a generic terminal interface.

It does not treat caller-supplied command fragments as trusted input.

## Contract goals

The first version of the contract is designed to:

- constrain what can be executed
- make validation rules explicit
- keep command construction deterministic
- separate execution concerns from reasoning concerns
- produce a result that is useful for both systems and reviewers

## Accepted request shape

The wrapper accepts a narrow allowlisted request object.

### First-version fields

- `project` required
- `spec` optional
- `grep` optional
- `headed` optional
- `workers` optional

Example request:

```json
{
  "project": "smoke",
  "spec": "tests/smoke/example.spec.ts",
  "grep": "@smoke",
  "headed": false,
  "workers": 1
}
```

## Validation posture

Validation is part of the contract.

The wrapper rejects invalid or out-of-policy requests before attempting execution.

### `project`

Required.

Must match one of the explicitly allowlisted Playwright project names defined by the repository.

For v1, the public sample allowlist is intentionally small.

Unknown project names are rejected.

### `spec`

Optional.

If present, it must be a repo-relative path within the approved test area.

For v1, that means the path must remain inside `tests/`.

The wrapper rejects:

- absolute paths
- parent-directory traversal
- paths outside the approved test area
- malformed or ambiguous paths

### `grep`

Optional.

If present, it is handled as a discrete Playwright filter argument.

For v1, `grep` must satisfy all of the following:

- it must be a string
- it must not be empty after trimming
- it must not exceed 200 characters
- it is passed as a discrete Playwright argument, not interpolated into raw shell text

In v1, `grep` is treated as a plain Playwright grep string, validated only for type, emptiness, and length, and passed as a discrete Playwright argument.

### `headed`

Optional.

Boolean only.

The contract does not accept equivalent string variants unless the CLI layer explicitly normalizes them before validation.

### `workers`

Optional.

Must be a positive integer in the allowed v1 range of `1` to `4`.

The wrapper rejects:

- `0`
- negative numbers
- non-integer values
- values above `4`

This upper bound stays intentionally small in the public sample so execution control remains narrow and reviewable.

If omitted, the wrapper uses its default execution behavior.

## Command construction policy

The wrapper constructs the Playwright invocation from validated fields only.

That means:

- no raw command string input
- no caller-supplied shell fragments
- no pass-through flag bag
- no concatenation model that treats caller input as trusted command text

The public interface is the request object.

The shell command is an internal derivative of validated input.

## Execution responsibilities

The wrapper layer is responsible for:

- validating the request against contract policy
- constructing an approved Playwright invocation
- executing the run through the local Playwright installation
- collecting expected artifact references
- returning a normalized result object

## Explicit non-responsibilities

The wrapper layer is not responsible for:

- deciding what test should be run next
- generating tests
- healing failing tests
- planning browser interactions
- orchestrating external systems
- performing broad environment automation
- acting as a generic command runner

## Operational outcome model

The contract distinguishes between at least two classes of outcome:

### 1. Wrapper-level outcome

Did the wrapper successfully validate, construct, and attempt the run according to policy?

### 2. Test-run outcome

Did the Playwright execution pass or fail?

Those are related, but they are not the same.

A correctly governed wrapper can return a valid completed result for a failing test run.

An invalid request can fail at the wrapper boundary without any Playwright execution occurring at all.

## Review-oriented design

This contract is designed for human review as much as execution.

A reviewer should be able to answer these questions without reverse-engineering shell history:

- what was requested
- whether the request was allowed
- what was actually run
- what the outcome was
- what evidence was produced
- where to inspect next

## Example result expectation

A successful wrapper execution is expected to produce a normalized result with fields such as:

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
  "command": "npx playwright test --project=smoke tests/smoke/example.spec.ts --workers=1",
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

The exact result schema is defined separately in `docs/result-schema.md`.

## Output channels

The CLI treats streams deliberately:

- **stdout** — normalized `PlaywrightRunResult` JSON only
- **stderr** — Playwright human-readable execution output

Machine callers should parse stdout as JSON. Prefer direct CLI invocation or `npm run --silent wrapper:run` so npm's script banner does not contaminate stdout.

## Design stance

This repository demonstrates a bounded Playwright execution boundary with explicit request policy, normalized output, and review-oriented evidence. It is not an OS sandbox or enterprise governance platform.