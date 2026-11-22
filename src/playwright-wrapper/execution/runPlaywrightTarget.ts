import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { readPlaywrightJudgment } from "./playwrightJudgment";
import { runOwnedProcess, type PlaywrightProcessRunner, type ProcessOutcome } from "./processLifecycle";
import { observeSource } from "./runAttribution";
import {
  InputValidationError, type NormalizedPlaywrightTarget, type PlaywrightTargetEcho,
  type PlaywrightTargetRequest, validateAndNormalizeTarget,
} from "../contract/validateInputs";
import { collectPlaywrightArtifacts, emptyArtifacts, reportPath } from "../artifacts/playwrightArtifacts";
import {
  createExecutionErrorResult, createFailedResult, createPassedResult, createValidationErrorResult,
  type PlaywrightArtifacts, type PlaywrightExecution, type PlaywrightRunResult, type PlaywrightRunErrorCode,
} from "../contract/resultSchema";

export const DEFAULT_TIMEOUT_MS = 300_000;
export const DEFAULT_CLEANUP_TIMEOUT_MS = 5_000;
export interface RunPlaywrightOptions {
  /** Whole invocation, including preparation, native reporting and judgment. Integer 1–900000. */
  timeoutMs?: number;
  /** Additional maximum cleanup allowance. Integer 100–10000. */
  cleanupTimeoutMs?: number;
  signal?: AbortSignal;
}
export interface RunPlaywrightTargetDeps {
  runProcess?: PlaywrightProcessRunner;
  resolveCliScriptPath?: () => string | Promise<string>;
  collectArtifacts?: (root: string | null) => PlaywrightArtifacts | Promise<PlaywrightArtifacts>;
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

async function resolvePlaywrightCliScriptPath(): Promise<string> {
  const file = path.join(process.cwd(), "node_modules", "playwright", "cli.js");
  await fs.access(file);
  return file;
}

/** API change: callers must await the result. Target and native judgment semantics are unchanged. */
export async function runPlaywrightTarget(
  input: PlaywrightTargetRequest,
  options: RunPlaywrightOptions = {},
  deps: RunPlaywrightTargetDeps = {},
): Promise<PlaywrightRunResult> {
  const startedAt = new Date().toISOString();
  const start = performance.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cleanupTimeoutMs = options.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS;
  const execution: PlaywrightExecution = {
    schemaVersion: 1, runId: randomUUID(), startedAt, finishedAt: startedAt, durationMs: 0,
    timeoutMs, cleanupTimeoutMs, termination: "not-started", pid: null, signal: null,
    artifactRoot: null, cleanup: { scope: "observed-process-tree", status: "not-started", observedDescendants: 0 },
    source: { revision: null, workingTree: "unknown" },
    environment: { id: "host:" + os.hostname(), platform: process.platform, release: os.release(),
      arch: process.arch, node: process.version, playwright: null },
  };
  let target: PlaywrightTargetEcho = echoRejectedTarget(input);
  let command: string | null = null;
  let artifacts = emptyArtifacts();
  let stop: "timeout" | "cancelled" | null = null;
  const controller = new AbortController();
  const interrupt = (reason: "timeout" | "cancelled") => {
    if (!stop) { stop = reason; controller.abort(); }
  };
  const checkDeadline = () => {
    if (performance.now() - start >= timeoutMs) interrupt("timeout");
    return stop;
  };
  const fail = (code: PlaywrightRunErrorCode, detail: string, exitCode: number | null = null) =>
    createExecutionErrorResult({ target, command, exitCode, artifacts, code, detail });
  const finish = (result: PlaywrightRunResult): PlaywrightRunResult => {
    if (result.status !== "validation_error" && result.error?.code !== "INVALID_RUN_OPTIONS" && checkDeadline()) {
      result = fail(stop === "timeout" ? "RUN_TIMEOUT" : "RUN_CANCELLED",
        stop === "timeout" ? "Whole-invocation deadline exceeded." : "Invocation cancelled by caller.", result.exitCode);
    }
    execution.termination = stop ?? (result.status === "validation_error" || result.error?.code === "INVALID_RUN_OPTIONS"
      ? "not-started" : result.ok ? "completed" : "error");
    execution.finishedAt = new Date().toISOString();
    execution.durationMs = Math.round(performance.now() - start);
    return { ...result, execution };
  };
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 900_000 ||
      !Number.isInteger(cleanupTimeoutMs) || cleanupTimeoutMs < 100 || cleanupTimeoutMs > 10_000 ||
      (options.signal !== undefined && !(options.signal instanceof AbortSignal))) {
    execution.timeoutMs = DEFAULT_TIMEOUT_MS;
    execution.cleanupTimeoutMs = DEFAULT_CLEANUP_TIMEOUT_MS;
    return finish(fail("INVALID_RUN_OPTIONS", "timeoutMs must be 1–900000 and cleanupTimeoutMs 100–10000 (integer milliseconds); signal must be an AbortSignal."));
  }
  const timer = setTimeout(() => interrupt("timeout"), Math.max(1, timeoutMs - (performance.now() - start)));
  const onAbort = () => interrupt("cancelled");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const within = async <T>(promise: Promise<T>): Promise<T> => {
    if (checkDeadline()) {
      void promise.catch(() => {});
      throw new Error("Invocation interrupted.");
    }
    let abort!: () => void;
    try {
      return await Promise.race([promise, new Promise<never>((_, reject) => {
        abort = () => reject(new Error("Invocation interrupted."));
        controller.signal.addEventListener("abort", abort, { once: true });
        if (controller.signal.aborted) abort();
      })]);
    } finally { controller.signal.removeEventListener("abort", abort); }
  };
  const collect = async () => {
    try {
      const observed = await within(Promise.resolve((deps.collectArtifacts ?? collectPlaywrightArtifacts)(execution.artifactRoot)));
      artifacts = { ...observed, traceFiles: [...observed.traceFiles] };
    } catch { artifacts = emptyArtifacts(); }
    // Ancillary discovery cannot erase the primary report reference or advertise stale JSON.
    artifacts.testResultsJson = null;
    const file = execution.artifactRoot && path.join(execution.artifactRoot, "results.json");
    if (file && !controller.signal.aborted) {
      try { artifacts.testResultsJson = (await within(fs.stat(file))).isFile() ? reportPath(file) : null; }
      catch { /* Absence / interrupted metadata read does not replace the primary cause. */ }
    }
  };
  try {
    try { target = validateAndNormalizeTarget(input); }
    catch (error) {
      return finish(createValidationErrorResult({
        target, artifacts, code: error instanceof InputValidationError ? error.code : "INVALID_PROJECT",
        detail: error instanceof Error ? error.message : "Unknown validation error.",
      }));
    }
    if (checkDeadline()) return finish(fail("RUN_CANCELLED", "Invocation interrupted before launch."));
    let cli: string;
    let args: string[];
    try {
      execution.source = await within(observeSource(controller.signal));
      cli = await within(Promise.resolve((deps.resolveCliScriptPath ?? resolvePlaywrightCliScriptPath)()));
      try {
        const pkg = JSON.parse(await within(fs.readFile(path.join(path.dirname(cli), "package.json"), "utf8")));
        execution.environment.playwright = typeof pkg.version === "string" ? pkg.version : null;
      } catch { /* A fixture or unavailable package has no verified version. */ }
      await within(fs.mkdir("artifacts", { recursive: true }));
      // Windows mkdtemp needs the extended absolute form for long checkout paths.
      const reserved = await within(fs.mkdtemp(path.toNamespacedPath(path.resolve("artifacts", "wrapper-result-" + execution.runId + "-"))));
      execution.artifactRoot = reportPath(path.relative(path.toNamespacedPath(process.cwd()), reserved));
      args = [...buildPlaywrightCliArgs(target as NormalizedPlaywrightTarget),
        "--output=" + path.resolve(execution.artifactRoot, "test-results")];
      command = buildCommandString(args);
    } catch (error) {
      return finish(fail("COMMAND_CONSTRUCTION_FAILED", (error as Error).message));
    }
    if (checkDeadline()) return finish(fail("RUN_CANCELLED", "Invocation interrupted before launch."));
    let outcome: ProcessOutcome;
    try {
      const root = path.resolve(execution.artifactRoot);
      outcome = await (deps.runProcess ?? runOwnedProcess)(process.execPath, [cli, ...args], {
        shell: false, stdio: ["ignore", 2, 2], signal: controller.signal, cleanupTimeoutMs,
        env: { ...process.env,
          PLAYWRIGHT_JSON_OUTPUT_FILE: path.join(root, "results.json"),
          PLAYWRIGHT_JUNIT_OUTPUT_FILE: path.join(root, "junit.xml"),
          PLAYWRIGHT_HTML_OUTPUT_DIR: path.join(root, "html"), PLAYWRIGHT_HTML_OPEN: "never",
        },
      });
    } catch (error) {
      return finish(fail("PROCESS_LAUNCH_FAILED", (error as Error).message));
    }
    execution.pid = outcome.pid;
    execution.signal = outcome.signal;
    execution.cleanup = outcome.cleanup;
    if (outcome.error && !checkDeadline()) return finish(fail("PROCESS_LAUNCH_FAILED", outcome.error.message, outcome.status));
    await collect();
    if (checkDeadline()) return finish(fail("RUN_CANCELLED", "Invocation interrupted.", outcome.status));
    if (outcome.error) return finish(fail("PROCESS_LAUNCH_FAILED", outcome.error.message, outcome.status));
    const exitCode = outcome.status;
    if (exitCode !== 0 && exitCode !== 1) {
      return finish(fail("PROCESS_COMPLETION_FAILED", "Playwright did not complete with child code 0 or 1.", exitCode));
    }
    let judgment: "passed" | "failed";
    try {
      judgment = await within(readPlaywrightJudgment(path.join(execution.artifactRoot, "results.json"), exitCode, controller.signal));
    } catch (error) { return finish(fail("TEST_JUDGMENT_UNAVAILABLE", (error as Error).message, exitCode)); }
    execution.nativeJudgment = judgment;
    if (outcome.cleanup.status !== "verified") {
      return finish(fail("PROCESS_CLEANUP_FAILED", outcome.cleanup.detail ?? "Observed process cleanup was not verified.", exitCode));
    }
    return finish((judgment === "passed" ? createPassedResult : createFailedResult)({ target, command, exitCode, artifacts }));
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
