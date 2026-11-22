# Artifact model

The wrapper references native Playwright reports without replacing their contents.

Each invocation reserves artifacts/wrapper-result-<runId>-<suffix>/ with sibling destinations:

- results.json: native JSON, the sole test-judgment input.
- junit.xml: native JUnit.
- html/index.html: native HTML, with its own report assets.
- test-results/: native attachments, screenshots, videos and traces.

Paths are relative to the repository working directory. Missing scalar paths are null; traceFiles is always an array. Screenshots/videos remain in native reports rather than duplicated wrapper fields.

Directory reservation uses an absolute filesystem prefix, including Windows' extended path form, while returning relative references. This avoids mkdtemp rejecting long checkout paths before Playwright can launch; it does not remove path restrictions in test code or other tools.

The child receives controlled JSON/JUnit/HTML output environment variables and a native --output argument. These override inherited output destinations only in that child; global environment and cwd are not changed. The HTML folder is a sibling of test-results, so report generation cannot delete test assets. Direct npm test retains its configured shared report locations.

All advertised wrapper references come from the reserved root. A present file is current-invocation attribution, not proof of valid/complete content, authentication or test success. Only native JSON with completed attempts, consistent outcomes and compatible child completion can establish a judgment. Incomplete reporting, a stuck reporter, or timeout/cancellation cannot be accepted merely because JSON was written early.

Ancillary discovery is best-effort and scoped to that root; a scanner exception degrades references without replacing the primary result. An unresponsive scan remains subject to the invocation deadline. Interrupted runs may return null/empty paths while retaining execution.artifactRoot for inspection of partial files. Native JSON must be readable and at most 16 MiB for wrapper judgment.

Validation rejection never advertises earlier artifacts. A later run never deletes, scans or reuses another invocation's root. Same-cwd concurrent wrapper calls are tested, including cancellation isolation. This does not make arbitrary test side effects outside the run root concurrent-safe.

Use execution.runId, target, timestamps, source qualification and environment to establish the context being reviewed. Source/working-tree observation is contextual and unverified as a deployment identity. Historical reports remain unchanged; a prior successful report is not evidence for a different revision, invocation or environment.

Generated roots remain under the ignored artifacts tree for review. There is no history index, retention service or tamper protection. To open the selected native HTML report:

    node node_modules/playwright/cli.js show-report artifacts/wrapper-result-<runId>-<suffix>/html

The existing show-report npm script continues to open the plain npm test report. See [lifecycle and API migration](execution-lifecycle.md) and [result schema](result-schema.md).
