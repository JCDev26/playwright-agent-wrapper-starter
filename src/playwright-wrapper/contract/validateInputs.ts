import path from "node:path";

export type PlaywrightProjectName = "smoke";

export interface PlaywrightTargetRequest {
  /**
   * Must match an allowlisted Playwright project name.
   * Typed as string so rejected values can be validated and echoed honestly.
   */
  project: string;
  spec?: string;
  grep?: string;
  headed?: boolean;
  workers?: number;
}

/** Approved target after successful validation. */
export interface NormalizedPlaywrightTarget {
  project: PlaywrightProjectName;
  spec: string | null;
  grep: string | null;
  headed: boolean;
  workers: number | null;
}

/**
 * Result echo of the request as interpreted by the wrapper.
 * On validation_error, `project` may contain a rejected caller-supplied value.
 */
export interface PlaywrightTargetEcho {
  project: string;
  spec: string | null;
  grep: string | null;
  headed: boolean;
  workers: number | null;
}

export type PlaywrightRunErrorCode =
  | "INVALID_PROJECT"
  | "INVALID_SPEC"
  | "INVALID_GREP"
  | "INVALID_HEADED"
  | "INVALID_WORKERS";

export class InputValidationError extends Error {
  readonly code: PlaywrightRunErrorCode;

  constructor(code: PlaywrightRunErrorCode, message: string) {
    super(message);
    this.name = "InputValidationError";
    this.code = code;
  }
}

const ALLOWED_PROJECTS: readonly PlaywrightProjectName[] = ["smoke"];
const TESTS_DIR = "tests";
const MAX_GREP_LENGTH = 200;
const MIN_WORKERS = 1;
const MAX_WORKERS = 4;

function isAllowedProject(value: unknown): value is PlaywrightProjectName {
  return typeof value === "string" && ALLOWED_PROJECTS.includes(value as PlaywrightProjectName);
}

function normalizeSpec(spec: unknown): string | null {
  if (spec === undefined) {
    return null;
  }

  if (typeof spec !== "string") {
    throw new InputValidationError("INVALID_SPEC", "Spec must be a string when provided.");
  }

  const trimmed = spec.trim();
  if (trimmed.includes("\0")) {
    throw new InputValidationError("INVALID_SPEC", "Spec must not contain NUL characters.");
  }
  if (!trimmed) {
    throw new InputValidationError("INVALID_SPEC", "Spec must not be empty.");
  }

  if (path.posix.isAbsolute(trimmed) || path.win32.isAbsolute(trimmed)) {
    throw new InputValidationError("INVALID_SPEC", "Spec path must be repo-relative, not absolute.");
  }

  const slashed = trimmed.replaceAll("\\", "/");
  if (slashed.split("/").includes("..")) {
    throw new InputValidationError("INVALID_SPEC", "Spec path must not use parent-directory traversal.");
  }
  const normalized = path.posix.normalize(slashed);

  if (normalized.startsWith("../") || normalized === "..") {
    throw new InputValidationError("INVALID_SPEC", "Spec path must not use parent-directory traversal.");
  }

  if (!normalized.startsWith(`${TESTS_DIR}/`)) {
    throw new InputValidationError("INVALID_SPEC", "Spec path must remain inside tests/.");
  }

  if (!normalized.endsWith(".spec.ts")) {
    throw new InputValidationError("INVALID_SPEC", "Spec path must point to a .spec.ts file.");
  }

  return normalized;
}

function normalizeGrep(grep: unknown): string | null {
  if (grep === undefined) {
    return null;
  }

  if (typeof grep !== "string") {
    throw new InputValidationError("INVALID_GREP", "Grep must be a string when provided.");
  }

  const trimmed = grep.trim();
  if (trimmed.includes("\0")) {
    throw new InputValidationError("INVALID_GREP", "Grep must not contain NUL characters.");
  }
  if (!trimmed) {
    throw new InputValidationError("INVALID_GREP", "Grep must not be empty.");
  }

  if (trimmed.length > MAX_GREP_LENGTH) {
    throw new InputValidationError(
      "INVALID_GREP",
      `Grep must not exceed ${MAX_GREP_LENGTH} characters.`,
    );
  }

  return trimmed;
}

function normalizeHeaded(headed: unknown): boolean {
  if (headed === undefined) {
    return false;
  }

  if (typeof headed !== "boolean") {
    throw new InputValidationError("INVALID_HEADED", "Headed must be a boolean when provided.");
  }

  return headed;
}

function normalizeWorkers(workers: unknown): number | null {
  if (workers === undefined) {
    return null;
  }

  if (typeof workers !== "number" || !Number.isInteger(workers)) {
    throw new InputValidationError("INVALID_WORKERS", "Workers must be an integer when provided.");
  }

  if (workers < MIN_WORKERS || workers > MAX_WORKERS) {
    throw new InputValidationError(
      "INVALID_WORKERS",
      `Workers must be between ${MIN_WORKERS} and ${MAX_WORKERS}.`,
    );
  }

  return workers;
}

export function validateAndNormalizeTarget(
  input: PlaywrightTargetRequest,
): NormalizedPlaywrightTarget {
  if (!isAllowedProject(input.project)) {
    throw new InputValidationError(
      "INVALID_PROJECT",
      `Project must be one of: ${ALLOWED_PROJECTS.join(", ")}.`,
    );
  }

  return {
    project: input.project,
    spec: normalizeSpec(input.spec),
    grep: normalizeGrep(input.grep),
    headed: normalizeHeaded(input.headed),
    workers: normalizeWorkers(input.workers),
  };
}
