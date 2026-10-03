# Wrapper contract

An external human, script, or AI system provides a request. The wrapper validates it, constructs approved argv, launches the local Playwright installation, and returns a result with artifact references.

## Request and execution policy

The request contains required `project` and optional `spec`, `grep`, `headed`, and `workers`. See [contracts](contracts.md) for exact types and bounds.

```json
{
  "project": "smoke",
  "spec": "tests/smoke/example.spec.ts",
  "grep": "@smoke",
  "headed": false,
  "workers": 1
}
```

The wrapper rejects unknown projects, invalid field types, unsafe path forms, NUL-containing spec/grep, and out-of-range explicit workers before spawning Playwright.

A spec denotes a literal file, not a caller-controlled regex. The wrapper resolves it against the repository working directory and builds an escaped, anchored Playwright filter with explicit case-sensitive regex semantics. The selected project still constrains discovery. A nonexistent file or a file outside the selected project's discovered tests produces no test judgment.

Grep intentionally retains Playwright regex semantics. Explicit workers must be 1–4; omission inherits Playwright's configured/default value.

The actual child is `process.execPath` (Node) plus `node_modules/playwright/cli.js`, with `shell: false`. Callers cannot provide command text, arbitrary flags, a config path, or a pass-through option bag.

Run from the repository root. Configuration, test code, dependencies, and inherited environment remain trusted. This is a request boundary, not OS sandboxing, network isolation, or enterprise authorization.

## Responsibilities

The wrapper owns:

- input validation and literal target translation;
- local child-process launch and structured launch/completion errors;
- a fresh native JSON report destination for the invocation;
- a small projection of native results sufficient to classify completed test judgments;
- best-effort discovery of ancillary report/trace paths.

It does not choose the next test, generate/heal tests, reason with a model, orchestrate other systems, or enforce human approval.

## Outcomes and output

A completed test judgment yields `passed` or `failed`, both with `ok: true`. Rejected requests yield `validation_error`. Runs without trustworthy completed test evidence yield `execution_error`; a no-tests exit of 1 is in this category.

CLI exits are 0 for passed, 1 for failed, and 2 for validation/execution errors.

For parsed requests reaching the wrapper, stdout contains one JSON result; Playwright human output goes to stderr. CLI syntax failures are intentionally separate: empty stdout, diagnostic stderr, exit 2. Use direct invocation or `npm run --silent wrapper:run` to avoid npm banners.

See [result schema](result-schema.md) for exact semantics and [artifact model](artifact-model.md) for provenance limits. Review points are guidance, not gates.
