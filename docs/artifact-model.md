# Artifact model

The wrapper returns references to native Playwright reports. It does not replace their contents or implement a generic evidence store.

## Result shape

```ts
interface PlaywrightArtifacts {
  htmlReport: string | null;
  testResultsJson: string | null;
  testResultsXml: string | null;
  traceFiles: string[];
}
```

Paths are relative to the repository working directory. Missing scalar paths are null; traces are always an array.

## Current invocation versus filesystem presence

**`testResultsJson` in a wrapper result** references the fresh `artifacts/wrapper-result-<suffix>/results.json` reserved for this invocation, when present. The wrapper sets `PLAYWRIGHT_JSON_OUTPUT_FILE` in the child environment, overriding an inherited JSON output destination. It reads only this invocation's file to establish test meaning. A previous report cannot supply the classification.

A present current-run JSON file can still contain runner errors or unusable data. Its presence is not itself proof of passed/failed tests. On validation rejection or blocked pre-flight, the field is null.

**`htmlReport`, `testResultsXml`, and `traceFiles`** are presence-based references within the same fresh invocation directory:

- `artifacts/wrapper-result-<suffix>/html/index.html`
- `artifacts/wrapper-result-<suffix>/junit.xml`
- `.zip` files beneath `artifacts/wrapper-result-<suffix>/test-results/`

The wrapper sets HTML/JUnit output environment variables and the test output CLI option to isolate these locations. Missing reports remain absent; presence is not content validation or authentication. Trace discovery identifies ZIP paths, not authenticated trace contents. Screenshots/videos have no dedicated wrapper fields.

Direct `npm test` runs still use the configured shared `artifacts/test-results.json`. Wrapper invocations use their fresh JSON location instead and never consume the shared JSON for classification.

## Failure behavior

Ancillary discovery is best-effort. If scanning HTML/JUnit/trace locations throws, those references degrade to null/empty without changing the primary validation, process, or test result. Current-run JSON reading is different: it is necessary for classification, so missing or unusable data produces `execution_error`.

## Review and limits

The wrapper applies Reporting's suite JSON byte budget (currently 32 MiB) before parsing a native result. Oversized or changing files remain available for inspection. When the report cannot be read within the budget, the wrapper returns `TEST_JUDGMENT_UNAVAILABLE` and CLI exit 2. A child terminated by a signal returns `PROCESS_COMPLETION_FAILED`, with the signal name when the OS supplies it.

Start with the wrapper status/error and its current-run JSON, then inspect other reports after confirming they belong to the run of interest.

Fresh invocation directories isolate native classification evidence, ancillary reports, and test output for review. They are generated artifacts under the existing ignored `artifacts/` tree; there is no run identity API, history index, retention service, authentication, or tamper protection. Trusted repository code and the local environment remain assumptions. Generated artifacts can be removed when no longer needed.

Wrapper report/output paths are invocation-scoped. Direct Playwright test runs still use configured shared paths; this is not a general concurrency or retention service.
