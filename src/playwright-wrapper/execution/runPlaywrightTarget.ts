import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readPlaywrightJudgment } from "./playwrightJudgment";
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
    env: NodeJS.ProcessEnv;
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
    // Playwright interprets file filters as regexes over absolute paths.
    // Anchor and escape every path segment; support native Windows separators.
    const literal = path.resolve(target.spec).split(path.sep)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("[\\\\/]");
    // Explicit regex delimiters avoid Playwright's implicit case-insensitive flag.
    args.push(`/^${literal}$/`);
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
  let reportPath: string | null = null;
  const collectArtifacts = (): PlaywrightArtifacts => {
    let artifacts: PlaywrightArtifacts;
    try {
      artifacts = (deps.collectArtifacts ?? collectPlaywrightArtifacts)();
    } catch {
      // Optional report/trace discovery must never replace the primary result.
      artifacts = { htmlReport: null, testResultsJson: null, testResultsXml: null, traceFiles: [] };
    }
    return {
      ...artifacts,
      // Never advertise a previous invocation's JSON as this invocation's result.
      testResultsJson: reportPath && fs.existsSync(reportPath)
        ? reportPath.split(path.sep).join("/") : null,
    };
  };

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
    fs.mkdirSync("artifacts", { recursive: true });
    reportPath = path.join(fs.mkdtempSync(path.join("artifacts", "wrapper-result-")), "results.json");
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
  let result: ReturnType<PlaywrightSpawnSync>;
  try {
    result = spawn(process.execPath, [cliScriptPath, ...cliArgs], {
      stdio: ["ignore", 2, 2],
      shell: false,
      env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: path.resolve(reportPath) },
    });
  } catch (error) {
    return createExecutionErrorResult({
      target, command, exitCode: null, artifacts: collectArtifacts(),
      code: "PROCESS_LAUNCH_FAILED",
      detail: error instanceof Error ? error.message : "Playwright launch threw an exception.",
    });
  }

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

  if (exitCode !== 0 && exitCode !== 1) {
    return createExecutionErrorResult({
      target,
      command,
      exitCode,
      artifacts,
      code: "PROCESS_COMPLETION_FAILED",
      detail: exitCode === null ? "Playwright process did not report an exit code."
        : `Playwright process exited with unexpected code ${exitCode}.`,
    });
  }

  let judgment: "passed" | "failed";
  try {
    judgment = readPlaywrightJudgment(reportPath, exitCode);
  } catch (error) {
    return createExecutionErrorResult({
      target, command, exitCode, artifacts,
      code: "TEST_JUDGMENT_UNAVAILABLE",
      detail: error instanceof Error ? error.message : "Current-run Playwright JSON is unavailable.",
    });
  }

  if (judgment === "passed") {
    return createPassedResult({
      target,
      command,
      exitCode,
      artifacts,
    });
  }

  return createFailedResult({
    target,
    command,
    exitCode,
    artifacts,
  });
}
