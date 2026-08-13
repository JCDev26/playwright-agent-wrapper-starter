import { spawnSync } from "node:child_process";
import path from "node:path";
import { test, expect } from "@playwright/test";

const cliEntry = path.join(
  process.cwd(),
  "tools",
  "agent",
  "execution",
  "runPlaywrightTargetCli.ts",
);

const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");

function runWrapperCli(args: string[]) {
  return spawnSync(process.execPath, [tsxCli, cliEntry, ...args], {
    encoding: "utf8",
    shell: false,
    env: process.env,
  });
}

test.describe("runPlaywrightTargetCli machine output", () => {
  test("stdout is parseable JSON for validation_error and echoes rejected project", async () => {
    const result = runWrapperCli(["--project", "ui"]);

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

  test("stdout remains parseable JSON when Playwright runs (no child stdout contamination)", async () => {
    const result = runWrapperCli([
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
    expect(typeof parsed.command).toBe("string");

    // Child Playwright human output may appear on stderr, not stdout.
    expect(result.stdout.trim().startsWith("{")).toBe(true);
    expect(result.stdout.trim().endsWith("}")).toBe(true);
  });
});
