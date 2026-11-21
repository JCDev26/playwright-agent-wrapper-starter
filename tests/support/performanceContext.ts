import { cleanRevision } from "../../src/playwright-wrapper/performance/revision";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";

export function performanceContext(browserEngine: string) {
  const hash = createHash("sha256");
  for (const file of ["tests/performance/task-timing.spec.ts", "tests/support/board.ts", "tests/support/performanceContext.ts"]) {
    hash.update(file).update("\0").update(readFileSync(file, "utf8").replaceAll("\r\n", "\n")).update("\0");
  }
  return {
    revision: cleanRevision(process.env.PW_PERF_REFERENCE_ROOT),
    harnessRevision: cleanRevision(),
    benchmarkHash: hash.digest("hex"),
    browserEngine,
    playwright: require("@playwright/test/package.json").version as string,
    node: process.version,
    architecture: process.arch,
    osRelease: os.release(),
    runnerClass: process.env.PW_PERF_RUNNER_CLASS || createHash("sha256").update(os.hostname()).digest("hex"),
  };
}
