import type { PlaywrightTargetEcho } from "./validateInputs";

export interface PlaywrightArtifacts {
  htmlReport: string | null;
  testResultsJson: string | null;
  testResultsXml: string | null;
  traceFiles: string[];
}

export interface PlaywrightRunSummary {
  message: string;
  nextReviewPoint: string;
}

export type PlaywrightRunStatus =
  | "passed"
  | "failed"
  | "validation_error"
  | "execution_error";

export type PlaywrightRunErrorCode =
  | "INVALID_PROJECT"
  | "INVALID_SPEC"
  | "INVALID_GREP"
  | "INVALID_HEADED"
  | "INVALID_WORKERS"
  | "INVALID_RUN_OPTIONS"
  | "COMMAND_CONSTRUCTION_FAILED"
  | "PROCESS_LAUNCH_FAILED"
  | "PROCESS_COMPLETION_FAILED"
  | "RUN_TIMEOUT"
  | "RUN_CANCELLED"
  | "PROCESS_CLEANUP_FAILED"
  | "TEST_JUDGMENT_UNAVAILABLE";

export interface PlaywrightRunError {
  code: PlaywrightRunErrorCode;
  detail: string;
}

export interface PlaywrightRunResult {
  ok: boolean;
  status: PlaywrightRunStatus;
  target: PlaywrightTargetEcho;
  command: string | null;
  exitCode: number | null;
  artifacts: PlaywrightArtifacts;
  summary: PlaywrightRunSummary;
  error?: PlaywrightRunError;
  /** Additive operational observation; synthetic/older results may omit it. */
  execution?: PlaywrightExecution;
}

export interface ProcessCleanup {
  scope: "observed-process-tree";
  status: "not-started" | "verified" | "unverified" | "incomplete";
  observedDescendants: number;
  detail?: string;
}

export interface PlaywrightExecution {
  schemaVersion: 1;
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  timeoutMs: number;
  cleanupTimeoutMs: number;
  termination: "completed" | "timeout" | "cancelled" | "error" | "not-started";
  pid: number | null;
  signal: string | null;
  /** Native report judgment, when established; cleanup can still prevent operational success. */
  nativeJudgment?: "passed" | "failed";
  artifactRoot: string | null;
  cleanup: ProcessCleanup;
  source: { revision: string | null; workingTree: "clean" | "dirty" | "unknown" };
  environment: { id: string; platform: string; release: string; arch: string; node: string; playwright: string | null };
}

export function createPassedResult(params: {
  target: PlaywrightTargetEcho;
  command: string;
  exitCode: number;
  artifacts: PlaywrightArtifacts;
}): PlaywrightRunResult {
  return {
    ok: true,
    status: "passed",
    target: params.target,
    command: params.command,
    exitCode: params.exitCode,
    artifacts: params.artifacts,
    summary: {
      message: "Playwright run completed successfully.",
      nextReviewPoint: "Open the HTML report if deeper inspection is needed.",
    },
  };
}

export function createFailedResult(params: {
  target: PlaywrightTargetEcho;
  command: string;
  exitCode: number;
  artifacts: PlaywrightArtifacts;
}): PlaywrightRunResult {
  return {
    ok: true,
    status: "failed",
    target: params.target,
    command: params.command,
    exitCode: params.exitCode,
    artifacts: params.artifacts,
    summary: {
      message: "Playwright run completed with failing tests.",
      nextReviewPoint: "Open the HTML report first, then inspect trace files if needed.",
    },
  };
}

export function createValidationErrorResult(params: {
  target: PlaywrightTargetEcho;
  artifacts: PlaywrightArtifacts;
  code: PlaywrightRunErrorCode;
  detail: string;
}): PlaywrightRunResult {
  return {
    ok: false,
    status: "validation_error",
    target: params.target,
    command: null,
    exitCode: null,
    artifacts: params.artifacts,
    summary: {
      message: "Wrapper rejected the request during validation.",
      nextReviewPoint: "Inspect the validation error and correct the request shape.",
    },
    error: {
      code: params.code,
      detail: params.detail,
    },
  };
}

export function createExecutionErrorResult(params: {
  target: PlaywrightTargetEcho;
  command: string | null;
  exitCode: number | null;
  artifacts: PlaywrightArtifacts;
  code: PlaywrightRunErrorCode;
  detail: string;
}): PlaywrightRunResult {
  return {
    ok: false,
    status: "execution_error",
    target: params.target,
    command: params.command,
    exitCode: params.exitCode,
    artifacts: params.artifacts,
    summary: {
      message: "Playwright invocation did not establish a reliable completed result.",
      nextReviewPoint: "Inspect execution context and available artifacts.",
    },
    error: {
      code: params.code,
      detail: params.detail,
    },
  };
}
