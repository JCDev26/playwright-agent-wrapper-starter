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

A present current-run JSON file can still contain runner errors or unusable data. Its presence is not itself proof of passed/failed tests. On pre-execution validation rejection, the field is null.

**`htmlReport`, `testResultsXml`, and `traceFiles`** are presence-based references at shared locations:

- `artifacts/playwright-report/index.html`
- `artifacts/test-results.xml`
- `.zip` files beneath `artifacts/test-results/`

They may come from an earlier invocation, be overwritten by another run, or be absent. The wrapper does not establish their current-run provenance. Trace discovery identifies ZIP paths, not authenticated trace contents. Screenshots/videos have no dedicated wrapper fields.

Direct `npm test` runs still use the configured shared `artifacts/test-results.json`. Wrapper invocations use their fresh JSON location instead and never consume the shared JSON for classification.

## Failure behavior

Ancillary discovery is best-effort. If scanning HTML/JUnit/trace locations throws, those references degrade to null/empty without changing the primary validation, process, or test result. Current-run JSON reading is different: it is necessary for classification, so missing or unusable data produces `execution_error`.

## Review and limits

Start with the wrapper status/error and its current-run JSON, then inspect other reports after confirming they belong to the run of interest.

Fresh JSON directories exist solely to isolate classification evidence and retain the native report for review. They are generated artifacts under the existing ignored `artifacts/` tree; there is no run identity API, history index, retention service, authentication, or tamper protection. Trusted repository code and the local environment remain assumptions. Generated artifacts can be removed when no longer needed.

Shared HTML/JUnit/traces are not safe for concurrent-run attribution. This wrapper does not promise general concurrent artifact isolation.
