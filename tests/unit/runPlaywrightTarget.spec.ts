import path from "node:path";
import type { PlaywrightProcessRunner, ProcessOutcome } from "../../src/playwright-wrapper/execution/processLifecycle";
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { playwrightReport } from "../support/playwrightReport";
import {
  runPlaywrightTarget,
} from "../../src/playwright-wrapper/execution/runPlaywrightTarget";
import type { PlaywrightArtifacts } from "../../src/playwright-wrapper/contract/resultSchema";

const emptyArtifacts: PlaywrightArtifacts = {
  htmlReport: null,
  testResultsJson: null,
  testResultsXml: null,
  traceFiles: [],
};

function createSpawnTracker(result: { status: number | null; error?: Error }) {
  const calls: Array<{
    command: string;
    args: readonly string[];
    stdio: ["ignore", 2, 2];
    shell: false;
  }> = [];

  const runProcess: PlaywrightProcessRunner = async (command, args, options) => {
    calls.push({ command, args: [...args], stdio: options.stdio, shell: options.shell });
    if (result.status === 0 || result.status === 1) {
      fs.writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE!, JSON.stringify(playwrightReport(result.status === 1)));
    }
    return fakeOutcome(result.status, result.error);
  };

  return { runProcess, calls };
}

test.describe("runPlaywrightTarget boundary", async () => {
  test("rejects invalid project without spawning Playwright and echoes the rejected project", async () => {
    const { runProcess, calls } = createSpawnTracker({ status: 0 });

    const result = await runPlaywrightTarget(
      {
        project: "ui",
        spec: "tests/smoke/example.spec.ts",
      },
      {}, {
        runProcess,
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("validation_error");
    expect(result.command).toBeNull();
    expect(result.exitCode).toBeNull();
    expect(result.target.project).toBe("ui");
    expect(result.target.project).not.toBe("smoke");
    expect(result.target.spec).toBe("tests/smoke/example.spec.ts");
    expect(result.error?.code).toBe("INVALID_PROJECT");
  });

  test("rejects invalid spec without spawning and preserves the rejected spec echo", async () => {
    const { runProcess, calls } = createSpawnTracker({ status: 0 });

    const result = await runPlaywrightTarget(
      {
        project: "smoke",
        spec: "../secrets.spec.ts",
      },
      {}, {
        runProcess,
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(calls).toHaveLength(0);
    expect(result.status).toBe("validation_error");
    expect(result.target.project).toBe("smoke");
    expect(result.target.spec).toBe("../secrets.spec.ts");
    expect(result.error?.code).toBe("INVALID_SPEC");
  });

  test("maps child exit 0 with current passing evidence to ok + passed", async () => {
    const { runProcess, calls } = createSpawnTracker({ status: 0 });

    const result = await runPlaywrightTarget(
      { project: "smoke", workers: 1 },
      {}, {
        runProcess,
        resolveCliScriptPath: () => "/fake/playwright/cli.js",
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdio).toEqual(["ignore", 2, 2]);
    expect(calls[0]?.shell).toBe(false);
    expect(calls[0]?.args).toEqual([
      "/fake/playwright/cli.js",
      "test",
      "--project=smoke",
      "--workers=1",
      "--output=" + path.resolve(result.execution!.artifactRoot!, "test-results"),
    ]);
    expect(result.ok).toBe(true);
    expect(result.status).toBe("passed");
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeUndefined();
    expect(result.target).toEqual({
      project: "smoke",
      spec: null,
      grep: null,
      headed: false,
      workers: 1,
    });
  });

  test("maps child exit 1 with current failing evidence to ok + failed", async () => {
    const { runProcess } = createSpawnTracker({ status: 1 });

    const result = await runPlaywrightTarget(
      { project: "smoke" },
      {}, {
        runProcess,
        resolveCliScriptPath: () => "/fake/playwright/cli.js",
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBe(1);
    expect(result.error).toBeUndefined();
  });

  test("maps unexpected exit codes to execution_error", async () => {
    const { runProcess } = createSpawnTracker({ status: 2 });

    const result = await runPlaywrightTarget(
      { project: "smoke" },
      {}, {
        runProcess,
        resolveCliScriptPath: () => "/fake/playwright/cli.js",
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("execution_error");
    expect(result.exitCode).toBe(2);
    expect(result.error?.code).toBe("PROCESS_COMPLETION_FAILED");
  });

  test("maps spawn launch errors to execution_error", async () => {
    const { runProcess } = createSpawnTracker({
      status: null,
      error: new Error("spawn ENOENT"),
    });

    const result = await runPlaywrightTarget(
      { project: "smoke" },
      {}, {
        runProcess,
        resolveCliScriptPath: () => "/fake/playwright/cli.js",
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("execution_error");
    expect(result.exitCode).toBeNull();
    expect(result.error?.code).toBe("PROCESS_LAUNCH_FAILED");
    expect(result.error?.detail).toContain("spawn ENOENT");
  });

  test("maps missing exit status to execution_error", async () => {
    const { runProcess } = createSpawnTracker({ status: null });

    const result = await runPlaywrightTarget(
      { project: "smoke" },
      {}, {
        runProcess,
        resolveCliScriptPath: () => "/fake/playwright/cli.js",
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("execution_error");
    expect(result.error?.code).toBe("PROCESS_COMPLETION_FAILED");
  });

  test("maps CLI resolution failure to execution_error without spawning", async () => {
    const { runProcess, calls } = createSpawnTracker({ status: 0 });

    const result = await runPlaywrightTarget(
      { project: "smoke" },
      {}, {
        runProcess,
        resolveCliScriptPath: () => {
          throw new Error("Could not find local Playwright CLI");
        },
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(calls).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect(result.status).toBe("execution_error");
    expect(result.command).toBeNull();
    expect(result.error?.code).toBe("COMMAND_CONSTRUCTION_FAILED");
  });
});

test("normalizes synchronous spawn exceptions", async () => {
  const result = await runPlaywrightTarget({ project: "smoke" }, {}, {
    resolveCliScriptPath: () => "/fake/cli.js",
    runProcess: () => { throw new TypeError("invalid spawn argument"); },
  });
  expect(result).toMatchObject({ ok: false, status: "execution_error", exitCode: null,
    error: { code: "PROCESS_LAUNCH_FAILED" } });
});

for (const field of ["spec", "grep"] as const) {
  test(`rejects NUL in ${field} without spawning`, async () => {
    let spawned = false;
    const result = await runPlaywrightTarget({ project: "smoke", [field]: "tests/a\0.spec.ts" }, {}, {
      runProcess: () => { spawned = true; throw new Error("must not spawn"); },
    });
    expect(spawned).toBe(false);
    expect(result.status).toBe("validation_error");
    expect(result.error?.code).toBe(field === "spec" ? "INVALID_SPEC" : "INVALID_GREP");
  });
}

test("artifact scanning failure preserves validation rejection", async () => {
  const result = await runPlaywrightTarget({ project: "ui" }, {}, {
    collectArtifacts: () => { throw new Error("ENOTDIR"); },
  });
  expect(result).toMatchObject({ status: "validation_error", error: { code: "INVALID_PROJECT" },
    artifacts: { htmlReport: null, traceFiles: [] } });
});

for (const status of [0, 1, 2]) {
  test(`artifact scanning failure preserves primary child outcome ${status}`, async () => {
    const { runProcess } = createSpawnTracker({ status });
    const result = await runPlaywrightTarget({ project: "smoke" }, {}, {
      runProcess, resolveCliScriptPath: () => "/fake/cli.js",
      collectArtifacts: () => { throw new Error("ENOTDIR"); },
    });
    expect(result.status).toBe(status === 0 ? "passed" : status === 1 ? "failed" : "execution_error");
    expect(result.exitCode).toBe(status);
    expect(result.artifacts.htmlReport).toBeNull();
  });
}

for (const exitCode of [0, 1]) {
  test(`exit ${exitCode} without current report is unable to judge`, async () => {
    const result = await runPlaywrightTarget({ project: "smoke" }, {}, {
      runProcess: async () => fakeOutcome(exitCode), resolveCliScriptPath: () => "/fake/cli.js",
    });
    expect(result).toMatchObject({ ok: false, status: "execution_error", exitCode,
      artifacts: { testResultsJson: null }, error: { code: "TEST_JUDGMENT_UNAVAILABLE" } });
  });
}

test("grep remains a single argument and never becomes shell text", async () => {
  const { runProcess, calls } = createSpawnTracker({ status: 0 });
  const grep = "@smoke; echo not-a-command";
  await runPlaywrightTarget({ project: "smoke", grep }, {}, {
    runProcess, resolveCliScriptPath: () => "/fake/cli.js",
  });
  expect(calls[0]?.shell).toBe(false);
  expect(calls[0]?.args.slice(-3, -1)).toEqual(["--grep", grep]);
});

for (const mode of ["malformed", "shape", "totals", "interrupted", "no-attempt", "contradictory", "runner-error"]) {
  test(`unusable current evidence stays structured: ${mode}`, async () => {
    const result = await runPlaywrightTarget({ project: "smoke" }, {}, {
      resolveCliScriptPath: () => "/fake/cli.js",
      runProcess: async (_command, _args, options) => {
        const report = playwrightReport();
        if (mode === "totals") report.stats.expected = 99;
        if (mode === "interrupted") report.suites[0]!.specs[0]!.tests[0]!.results[0]!.status = "interrupted";
        if (mode === "no-attempt") report.suites[0]!.specs[0]!.tests[0]!.results = [];
        const output = mode === "malformed" ? "{" : mode === "shape" ? "{}"
          : JSON.stringify(mode === "runner-error" ? { ...report, errors: [{ message: "setup failed" }] } : report);
        fs.writeFileSync(options.env.PLAYWRIGHT_JSON_OUTPUT_FILE!, output);
        return fakeOutcome(mode === "contradictory" ? 1 : 0);
      },
    });
    expect(result).toMatchObject({ status: "execution_error", ok: false,
      error: { code: "TEST_JUDGMENT_UNAVAILABLE" } });
  });
}

function fakeOutcome(status: number | null, error?: Error): ProcessOutcome {
  return { status, error, pid: null, signal: null, cleanup: { scope: "observed-process-tree", status: "verified", observedDescendants: 0 } };
}
