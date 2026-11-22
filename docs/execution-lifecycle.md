# Execution lifecycle and compatibility

The core reliability phase extends the original v1 execution boundary. It does not add a dependency resolver, deployment integration, LLM loop, security sandbox or human approval mechanism.

## Asynchronous API change

Previous library calls returned a result directly and accepted test dependencies in the second argument. Callers must now await runPlaywrightTarget(request, options?, deps?). The third argument is the internal asynchronous process/artifact seam; the synchronous spawn seam has been removed. CLI parsing, stdout JSON, stderr diagnostics and exits 0/1/2 retain their meanings.

    const controller = new AbortController();
    const result = await runPlaywrightTarget(
      { project: "smoke", workers: 1 },
      { timeoutMs: 300_000, cleanupTimeoutMs: 5_000, signal: controller.signal },
    );

The target allowlist, literal spec selection, grep semantics and native Playwright retries/expected-failure rules are unchanged.

## Explicit limits

- timeoutMs: default 300000, integer 1 through 900000 milliseconds. CLI flag: --timeout-ms.
- cleanupTimeoutMs: default 5000, integer 100 through 10000 milliseconds. CLI flag: --cleanup-timeout-ms.
- POSIX graceful termination allowance: at most 250 milliseconds within the cleanup budget, followed by forced cleanup.
- Native JSON judgment reads: at most 16 MiB. Larger reports remain native artifacts but yield TEST_JUDGMENT_UNAVAILABLE.

The monotonic deadline starts at API entry and covers preparation, checkout observation, configuration/discovery, execution, native reporting, artifact discovery and judgment. Interrupted execution may consume the additional cleanup budget. Operational limits are not per-test Playwright timeouts. Invalid operational options return INVALID_RUN_OPTIONS / execution_error / CLI 2 before spawning.

AbortSignal cancellation, including pre-aborted calls, produces RUN_CANCELLED. Whole-invocation expiration produces RUN_TIMEOUT. Both remain execution_error / CLI 2 even if valid-looking JSON already exists or the child later returns code 0/1. CLI SIGINT/SIGTERM request cancellation where the OS delivers those signals to Node. Forced external termination cannot promise final JSON or cleanup.

Filesystem/OS scheduling and synchronous JSON parsing cannot offer hard real-time guarantees. Reads are bounded, elapsed time is rechecked before acceptance, and timers/listeners/OS query processes are stopped. A blocked event loop, kernel failure or loss of the wrapper process is outside this cooperative guarantee.

## Owned-process cleanup

processLifecycle supervises the direct child and serially observes descendants. processTree is the platform adapter: existing PowerShell/CIM and taskkill on Windows; /proc and signals on Linux. No npm dependency, native helper or system installation is added. Other platforms report cleanup unverified.

Windows reuses one PowerShell query session per invocation. Each request performs a fresh CIM query; numbered replies are validated and bounded to 4 MiB. An interrupted or invalid session is discarded, and every session's shutdown is checked within the cleanup allowance. Sessions and process observations are never shared between invocations.

Cleanup consumes any in-flight snapshot before verifying termination. When the direct child has closed and every observed positive PID returns ESRCH to a signal-zero probe, no additional full snapshot is needed to establish absence. A live or reused PID, denied probe or uncertain result requires the existing birth-identity snapshot checks. This shortcut does not bypass root attribution or descendant observation. Observer shutdown failure prevents a verified cleanup result.

Observed identities include PID and process birth time. Descendants are adopted only through a live matching parent identity. Windows roots must match their launch-time window; exited roots are not newly adopted. Cleanup targets identities from the invocation's latest snapshot, never executable names or unrelated runs. POSIX detached browser groups are observed as descendants, rather than assuming they share the CLI's process group. Native shutdown gets a short grace period on POSIX; Windows uses tree termination.

The cleanup scope is explicitly observed-process-tree. A verified state means the root closed and all observed identities were absent/exited during verification. It does not prove containment of descendants that escaped or reparented between snapshots, eliminate every snapshot-to-signal race, authenticate ownership, or survive abrupt wrapper death. Stronger containment requires a separately reviewed native/OS ownership mechanism. Small budgets, denied OS queries or missing capabilities produce incomplete/unverified cleanup rather than a success claim.

The direct child is reaped through its close event. Orphaned POSIX descendants can only be observed exited; the wrapper is not their kernel parent and does not claim to reap their zombie records.

PROCESS_CLEANUP_FAILED prevents operational success when native judgment exists but cleanup is unverified. execution.nativeJudgment retains that native judgment. Timeout/cancellation remain the primary cause even when cleanup also fails. Optional ancillary scanning failures never overwrite a known cause.

## Operational attribution and freshness

Actual wrapper results add optional execution metadata (schemaVersion 1): unique runId, UTC start/end, monotonic duration, limits, termination, child PID/signal, artifact root, cleanup scope/state, checkout context and actual host identity/OS release/platform/architecture/Node/Playwright version when observable. Host identity labels the execution machine, not the deployed application environment. Constructors/older synthetic results may omit this additive field.

The checkout observation is taken at invocation preparation. A commit plus clean/dirty/unknown state is context, not attestation or proof that files remained unchanged. Non-root fixture directories, absent git or unavailable observations yield null revision / unknown state. Package version is read from the resolved local CLI's package; unavailable versions remain null.

All advertised artifact paths belong to the newly reserved run root. File presence still does not establish content validity or complete reporting. Timeout/cancellation may omit individual paths; execution.artifactRoot identifies the retained partial directory for investigation. Missing files, unverified source/deployment correspondence and old reports must never be promoted into fresh successful evidence. An old successful observation remains historical and is not re-timestamped.

The optional reporting adapter preserves native execution metadata. Caller-supplied reporting context is still caller-supplied; this phase does not install a universal result envelope or dependency/deployment contract.

## Verification boundary

The tests exercise native success/failure/retries, preparation/configuration/reporting deadlines, pre-abort and in-flight cancellation, cleanup failure/budget limits, detached descendants, stale JSON and same-cwd concurrency including cancellation isolation. A Chromium cleanup/endpoint test runs only when the compatible installed browser is available.

Windows process-tree cases have been exercised locally. Ubuntu is unverified in this environment because WSL/Linux execution is unavailable. Windows terminal signal delivery and actual browser cleanup require their respective capabilities; skipped tests are evidence limitations. Existing Ubuntu CI definitions do not prove the modified branch has run there. No cross-platform reliability claim is made.
