import { test, expect } from "@playwright/test";
import {
  runPlaywrightTarget,
  type PlaywrightSpawnSync,
} from "../../tools/agent/execution/runPlaywrightTarget";
import type { PlaywrightArtifacts } from "../../tools/agent/contract/resultSchema";

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
  }> = [];

  const spawnSync: PlaywrightSpawnSync = (command, args, options) => {
    calls.push({ command, args: [...args], stdio: options.stdio });
    return result;
  };

  return { spawnSync, calls };
}

test.describe("runPlaywrightTarget boundary", () => {
  test("rejects invalid project without spawning Playwright and echoes the rejected project", async () => {
    const { spawnSync, calls } = createSpawnTracker({ status: 0 });

    const result = runPlaywrightTarget(
      {
        project: "ui",
        spec: "tests/smoke/example.spec.ts",
      },
      {
        spawnSync,
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
    const { spawnSync, calls } = createSpawnTracker({ status: 0 });

    const result = runPlaywrightTarget(
      {
        project: "smoke",
        spec: "../secrets.spec.ts",
      },
      {
        spawnSync,
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(calls).toHaveLength(0);
    expect(result.status).toBe("validation_error");
    expect(result.target.project).toBe("smoke");
    expect(result.target.spec).toBe("../secrets.spec.ts");
    expect(result.error?.code).toBe("INVALID_SPEC");
  });

  test("maps successful child exit 0 to ok + passed", async () => {
    const { spawnSync, calls } = createSpawnTracker({ status: 0 });

    const result = runPlaywrightTarget(
      { project: "smoke", workers: 1 },
      {
        spawnSync,
        resolveCliScriptPath: () => "/fake/playwright/cli.js",
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdio).toEqual(["ignore", 2, 2]);
    expect(calls[0]?.args).toEqual([
      "/fake/playwright/cli.js",
      "test",
      "--project=smoke",
      "--workers=1",
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

  test("maps child exit 1 to ok + failed (test failure is not wrapper failure)", async () => {
    const { spawnSync } = createSpawnTracker({ status: 1 });

    const result = runPlaywrightTarget(
      { project: "smoke" },
      {
        spawnSync,
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
    const { spawnSync } = createSpawnTracker({ status: 2 });

    const result = runPlaywrightTarget(
      { project: "smoke" },
      {
        spawnSync,
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
    const { spawnSync } = createSpawnTracker({
      status: null,
      error: new Error("spawn ENOENT"),
    });

    const result = runPlaywrightTarget(
      { project: "smoke" },
      {
        spawnSync,
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
    const { spawnSync } = createSpawnTracker({ status: null });

    const result = runPlaywrightTarget(
      { project: "smoke" },
      {
        spawnSync,
        resolveCliScriptPath: () => "/fake/playwright/cli.js",
        collectArtifacts: () => emptyArtifacts,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe("execution_error");
    expect(result.error?.code).toBe("PROCESS_COMPLETION_FAILED");
  });

  test("maps CLI resolution failure to execution_error without spawning", async () => {
    const { spawnSync, calls } = createSpawnTracker({ status: 0 });

    const result = runPlaywrightTarget(
      { project: "smoke" },
      {
        spawnSync,
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
