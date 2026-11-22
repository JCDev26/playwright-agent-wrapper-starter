import { test, expect } from "@playwright/test";
import { wrapperFixture } from "../support/wrapperFixture";

test.describe("runPlaywrightTargetCli machine output", () => {
  test("stdout is parseable JSON for validation_error and echoes rejected project", async ({}, info) => {
    const result = wrapperFixture(info).run(["--project", "ui"]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);

    // stdout must be only the normalized JSON result (no Playwright chatter).
    const parsed = JSON.parse(result.stdout);

    expect(parsed).toMatchObject({
      ok: false,
      status: "validation_error",
      target: {
        project: "ui",
      },
      command: null,
      exitCode: null,
      error: {
        code: "INVALID_PROJECT",
      },
    });
    expect(parsed.target.project).not.toBe("smoke");

    // No non-whitespace residue before/after the JSON document.
    expect(result.stdout.trim().startsWith("{")).toBe(true);
    expect(result.stdout.trim().endsWith("}")).toBe(true);
  });

  test("stdout remains parseable JSON when Playwright runs (no child stdout contamination)", async ({}, info) => {
    const result = wrapperFixture(info).run([
      "--project",
      "smoke",
      "--spec",
      "tests/smoke/example.spec.ts",
      "--workers",
      "1",
    ]);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);

    const parsed = JSON.parse(result.stdout);

    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("passed");
    expect(parsed.exitCode).toBe(0);
    expect(parsed.target.project).toBe("smoke");
    expect(parsed.execution).toMatchObject({ schemaVersion: 1, termination: "completed",
      cleanup: { scope: "observed-process-tree", status: "verified" },
      source: { revision: null, workingTree: "unknown" },
      environment: { platform: process.platform, node: process.version, playwright: null } });
    expect(parsed.execution.environment.id).toMatch(/^host:.+/);
    expect(Date.parse(parsed.execution.finishedAt)).toBeGreaterThanOrEqual(Date.parse(parsed.execution.startedAt));
    expect(typeof parsed.command).toBe("string");

    // Child Playwright human output may appear on stderr, not stdout.
    expect(result.stdout.trim().startsWith("{")).toBe(true);
    expect(result.stdout.trim().endsWith("}")).toBe(true);
  });
});

for (const args of [
  ["--project", "smoke", "--timeout-ms", "0"],
  ["--project", "smoke", "--cleanup-timeout-ms", "10001"],
  ["--project", "smoke", "--timeout-ms", "not-a-number"],
]) {
  test("operational option rejection is structured and exits 2: " + JSON.stringify(args), async ({}, info) => {
    const child = wrapperFixture(info).run(args);
    expect(child.status).toBe(2);
    expect(JSON.parse(child.stdout)).toMatchObject({ ok: false, error: { code: "INVALID_RUN_OPTIONS" },
      execution: { termination: "not-started", pid: null } });
  });
}
test("a missing deadline flag value remains a parser error", async ({}, info) => {
  const child = wrapperFixture(info).run(["--project", "smoke", "--timeout-ms"]);
  expect(child.status).toBe(2);
  expect(child.stdout).toBe("");
  expect(child.stderr).toContain("Missing value");
});
