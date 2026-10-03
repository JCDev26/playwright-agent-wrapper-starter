# Contracts

The source of truth is [request validation](../src/playwright-wrapper/contract/validateInputs.ts) and [result types](../src/playwright-wrapper/contract/resultSchema.ts).

## Request

```ts
interface PlaywrightTargetRequest {
  project: string;
  spec?: string;
  grep?: string;
  headed?: boolean;
  workers?: number;
}
```

- `project`: exactly `smoke`.
- `spec`: optional non-empty repository-relative `.spec.ts` path under `tests/`. Backslashes normalize to slashes. Absolute paths in Windows/POSIX form, parent-directory segments, and NUL are rejected. Execution uses an escaped, anchored literal-file filter; existence and project membership are resolved by Playwright. A missing/nonmatching file is an execution error, not necessarily a validation error.
- `grep`: optional Playwright regex string, trimmed, non-empty, at most 200 characters, without NUL. Regex syntax is interpreted by Playwright; invalid syntax can produce an execution error. It remains one argv value.
- `headed`: optional boolean; defaults to false.
- `workers`: optional integer from 1 to 4. Omitted workers normalize to null and omit the CLI override, inheriting Playwright configuration/defaults. Four is not a universal concurrency cap.

Omitted spec/grep also normalize to null. The result target echoes accepted normalized fields or interpretable rejected input fields, preserving an invalid project string.

## Result

```ts
interface PlaywrightRunResult {
  ok: boolean;
  status: "passed" | "failed" | "validation_error" | "execution_error";
  target: {
    project: string;
    spec: string | null;
    grep: string | null;
    headed: boolean;
    workers: number | null;
  };
  command: string | null;
  exitCode: number | null;
  artifacts: {
    htmlReport: string | null;
    testResultsJson: string | null;
    testResultsXml: string | null;
    traceFiles: string[];
  };
  summary: { message: string; nextReviewPoint: string };
  error?: { code: PlaywrightRunErrorCode; detail: string };
}
```

Only passed/failed have `ok: true`. Both require current-run native evidence of completed test attempts and an outcome consistent with the process code. Validation/execution errors have `ok: false`.

`exitCode` is the child code, not the CLI code. Null means no numeric child exit code was obtained; it does not prove that no process launched. `command` is a display string, not a replayable shell interface.

See [result schema](result-schema.md) for exact statuses, error codes and parser exceptions, and [artifact model](artifact-model.md) for current-run versus presence-based references.

The contract stays specific to bounded Playwright execution. New Playwright options do not automatically belong in the public request surface.
