import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  InputValidationError,
  type NormalizedPlaywrightTarget,
  type PlaywrightTargetEcho,
  type PlaywrightTargetRequest,
  validateAndNormalizeTarget,
} from "../contract/validateInputs";
import { collectPlaywrightArtifacts } from "../artifacts/playwrightArtifacts";
import {
  createExecutionErrorResult,
  createFailedResult,
  createPassedResult,
  createValidationErrorResult,
  type PlaywrightArtifacts,
  type PlaywrightRunResult,
} from "../contract/resultSchema";

/**
 * Minimal spawn seam for tests. Production uses node:child_process.spawnSync.
 * Child stdout/stderr must not write to the parent stdout channel.
 */
export type PlaywrightSpawnSync = (
  command: string,
  args: readonly string[],
  options: {
    shell: false;
    /**
     * ignore stdin; route child stdout+stderr to parent stderr (fd 2)
     * so parent stdout remains a clean JSON result channel for the CLI.
     */
    stdio: ["ignore", 2, 2];
  },
) => {
  status: number | null;
  error?: Error;
};

export interface RunPlaywrightTargetDeps {
  spawnSync?: PlaywrightSpawnSync;
  resolveCliScriptPath?: () => string;
  collectArtifacts?: () => PlaywrightArtifacts;
}

function buildPlaywrightCliArgs(target: NormalizedPlaywrightTarget): string[] {
  const args = ["test", `--project=${target.project}`];

  if (target.spec) {
    args.push(target.spec);
  }

  if (target.grep) {
    args.push("--grep", target.grep);
  }

  if (target.headed) {
    args.push("--headed");
  }

  if (target.workers !== null) {
    args.push(`--workers=${target.workers}`);
  }

  return args;
}

function buildCommandString(cliArgs: string[]): string {
  return ["npx", "playwright", ...cliArgs].join(" ");
}

/**
 * Echo the caller's request fields without coercing rejected values into
 * allowlisted defaults (e.g. do not rewrite an invalid project to "smoke").
 */
export function echoRejectedTarget(
  input: Partial<PlaywrightTargetRequest>,
): PlaywrightTargetEcho {
  return {
    project: typeof input.project === "string" ? input.project : "",
    spec: typeof input.spec === "string" ? input.spec : null,
    grep: typeof input.grep === "string" ? input.grep : null,
    headed: typeof input.headed === "boolean" ? input.headed : false,
    workers:
      typeof input.workers === "number" && Number.isInteger(input.workers)
        ? input.workers
        : null,
  };
}

function resolvePlaywrightCliScriptPath(): string {
  const cliPath = path.join(process.cwd(), "node_modules", "playwright", "cli.js");

  if (!fs.existsSync(cliPath)) {
    throw new Error(`Could not find local Playwright CLI at ${cliPath}`);
  }

  return cliPath;
}

export function runPlaywrightTarget(
  input: PlaywrightTargetRequest,
  deps: RunPlaywrightTargetDeps = {},
): PlaywrightRunResult {
  const spawn = deps.spawnSync ?? (spawnSync as PlaywrightSpawnSync);
  const resolveCli = deps.resolveCliScriptPath ?? resolvePlaywrightCliScriptPath;
  const collectArtifacts = deps.collectArtifacts ?? collectPlaywrightArtifacts;

  let target: NormalizedPlaywrightTarget;

  try {
    target = validateAndNormalizeTarget(input);
  } catch (error) {
    const artifacts = collectArtifacts();

    if (error instanceof InputValidationError) {
      return createValidationErrorResult({
        target: echoRejectedTarget(input),
        artifacts,
        code: error.code,
        detail: error.message,
      });
    }

    return createValidationErrorResult({
      target: echoRejectedTarget(input),
      artifacts,
      code: "INVALID_PROJECT",
      detail: error instanceof Error ? error.message : "Unknown validation error.",
    });
  }

  let cliArgs: string[];
  let cliScriptPath: string;

  try {
    cliArgs = buildPlaywrightCliArgs(target);
    cliScriptPath = resolveCli();
  } catch (error) {
    return createExecutionErrorResult({
      target,
      command: null,
      exitCode: null,
      artifacts: collectArtifacts(),
      code: "COMMAND_CONSTRUCTION_FAILED",
      detail: error instanceof Error ? error.message : "Failed to construct Playwright command.",
    });
  }

  const command = buildCommandString(cliArgs);

  // Keep parent stdout free for the CLI JSON result. Playwright's human-readable
  // reporter output is routed to the parent stderr stream via fd 2.
  const result = spawn(process.execPath, [cliScriptPath, ...cliArgs], {
    stdio: ["ignore", 2, 2],
    shell: false,
  });

  const artifacts = collectArtifacts();

  if (result.error) {
    return createExecutionErrorResult({
      target,
      command,
      exitCode: null,
      artifacts,
      code: "PROCESS_LAUNCH_FAILED",
      detail: result.error.message,
    });
  }

  const exitCode = result.status;

  if (exitCode === null) {
    return createExecutionErrorResult({
      target,
      command,
      exitCode: null,
      artifacts,
      code: "PROCESS_COMPLETION_FAILED",
      detail: "Playwright process did not report an exit code.",
    });
  }

  if (exitCode === 0) {
    return createPassedResult({
      target,
      command,
      exitCode,
      artifacts,
    });
  }

  if (exitCode === 1) {
    return createFailedResult({
      target,
      command,
      exitCode,
      artifacts,
    });
  }

  return createExecutionErrorResult({
    target,
    command,
    exitCode,
    artifacts,
    code: "PROCESS_COMPLETION_FAILED",
    detail: `Playwright process exited with unexpected code ${exitCode}.`,
  });
}
