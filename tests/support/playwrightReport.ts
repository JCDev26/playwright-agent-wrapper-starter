/** Minimal native JSON projection used by process-boundary tests. */
export function playwrightReport(failed = false) {
  return {
    errors: [],
    stats: { expected: failed ? 0 : 1, unexpected: failed ? 1 : 0, flaky: 0, skipped: 0 },
    suites: [{ specs: [{ tests: [{
      status: failed ? "unexpected" : "expected",
      results: [{ status: failed ? "failed" : "passed", workerIndex: 0 }],
    }] }] }],
  };
}
