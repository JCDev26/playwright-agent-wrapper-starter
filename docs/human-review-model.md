# Human review model

The wrapper is human-reviewable. It suggests inspection points but never pauses for mandatory approval or records a completed human review.

## Recommended review

1. Read `status` and `error.code`; `ok` alone is not a test verdict.
2. Confirm `target` describes the intended request. On validation errors it may contain rejected values.
3. Inspect the current invocation's `testResultsJson` when available.
4. Use HTML/JUnit/traces for deeper review after checking they belong to the relevant invocation; those paths are presence-based and shared.
5. Decide whether to correct the request, investigate execution, or inspect test findings.

## Interpreting results

- **validation_error:** Playwright was not invoked. Correct the rejected field or caller behavior.
- **passed:** current-run evidence establishes completed test attempts and Playwright accepted the result under its expected-failure/retry rules. This does not establish broader product correctness.
- **failed:** current-run evidence establishes completed test attempts and unexpected Playwright test outcomes. Inspect assertions and test-associated setup/fixture failures.
- **execution_error:** no trustworthy completed test judgment was obtained. Inspect the structured cause and current-run report, if present. Examples include discovery/configuration errors, no tests, all skipped, launch failure, interrupted execution, or missing/unusable report data.

A Playwright child exit code of 1 does not tell the reviewer which of failed/execution_error occurred. The wrapper uses native report evidence for that distinction.

CLI syntax errors occur before the wrapper-result contract: no JSON, diagnostic stderr, CLI exit 2. Other wrapper statuses have JSON output and documented [exit mappings](result-schema.md).

## Evidence limits

Ancillary artifact scanning may fail and return null/empty paths without changing a known primary result. Missing optional reports do not turn failing tests into execution errors. Missing usable current-run JSON does prevent a test judgment.

The wrapper preserves native Playwright reporting rather than building a second report or approval system. Reviewer judgment remains external.
