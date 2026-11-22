import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { jobIdPattern } from "../agents/governance";

export type Job = { jobId: string; revision: string };
export type LaneStatus = "passed" | "failed" | "inconclusive" | "missing" | "invalid" | "not_scheduled";
export interface Lane {
  status: LaneStatus;
  reason: string;
  partial: boolean;
  knownFailure: boolean;
}

export class EvidenceIssue extends Error {
  constructor(readonly status: "missing" | "invalid", reason: string) { super(reason); }
}

export function requireEvidence(condition: unknown, reason = "inconsistent_evidence"): asserts condition {
  if (!condition) throw new EvidenceIssue("invalid", reason);
}

export function record(value: unknown): Record<string, unknown> {
  requireEvidence(value !== null && typeof value === "object" && !Array.isArray(value), "invalid_schema");
  return value as Record<string, unknown>;
}

export function fields(value: unknown, required: string[], optional: string[] = []) {
  const obj = record(value);
  requireEvidence(required.every(key => Object.hasOwn(obj, key)) &&
    Object.keys(obj).every(key => required.includes(key) || optional.includes(key)), "invalid_schema");
  return obj;
}

export function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

export function requireJob(value: Record<string, unknown>, job: Job) {
  requireEvidence(value.jobId === job.jobId && value.revision === job.revision, "job_or_revision_mismatch");
}

export interface Manifest {
  suite: { sha256: string; exitCode: number } | null;
  security: { sha256: string } | null;
  performance: { expected: boolean; sha256: string | null };
}

export function parseManifest(value: unknown, job: Job): Manifest {
  const obj = fields(value, ["schemaVersion", "jobId", "revision", "suite", "security", "performance"]);
  requireEvidence(obj.schemaVersion === 1, "unsupported_manifest_version");
  requireJob(obj, job);
  let suite: Manifest["suite"] = null;
  if (obj.suite !== null) {
    const { sha256, exitCode } = fields(obj.suite, ["sha256", "exitCode"]);
    requireEvidence(isDigest(sha256) && typeof exitCode === "number" && Number.isInteger(exitCode) &&
      exitCode >= 0 && exitCode <= 255, "invalid_suite_enrollment");
    suite = { sha256, exitCode };
  }
  let security: Manifest["security"] = null;
  if (obj.security !== null) {
    const { sha256 } = fields(obj.security, ["sha256"]);
    requireEvidence(isDigest(sha256), "invalid_security_enrollment");
    security = { sha256 };
  }
  const { expected, sha256 } = fields(obj.performance, ["expected", "sha256"]);
  requireEvidence(typeof expected === "boolean" && (sha256 === null || (expected && isDigest(sha256))),
    "invalid_performance_enrollment");
  return { suite, security, performance: { expected, sha256 } };
}

export const reviewNativePins = {
  "security-native.json": "PW_AGENT_REVIEW_SECURITY_SHA256",
  "baseline-native.json": "PW_AGENT_REVIEW_BASELINE_SHA256",
  "candidate-1-native.json": "PW_AGENT_REVIEW_CANDIDATE_1_SHA256",
  "candidate-2-native.json": "PW_AGENT_REVIEW_CANDIDATE_2_SHA256",
  "enrollment-native.json": "PW_AGENT_REVIEW_ENROLLMENT_SHA256",
} as const;
export type NativeFile = keyof typeof reviewNativePins;
const inputFiles = ["manifest.json", "suite.json", "security.json", "performance.json", "summary.json", "suite-plan.json",
  "enrollment-receipt.json"] as const;
export type InputFile = typeof inputFiles[number] | NativeFile;

/** Names come from the wrapper. Neither requests nor evidence can introduce a path. */
export function readEvidenceBytes(root: string, job: Job, name: InputFile, maxBytes: number): Buffer {
  requireEvidence(jobIdPattern.test(job.jobId) && (inputFiles.some(file => file === name) || Object.hasOwn(reviewNativePins, name)),
    "unsafe_artifact_path");
  return readArtifact(root, ["artifacts", "reporting", job.jobId], name, maxBytes);
}

/** A specialist receipt may identify only an actual wrapper reservation. The preparer's baseline uses an absolute path. */
export function readWrapperReport(root: string, reference: unknown, kind: "receipt" | "baseline"): Buffer {
  requireEvidence(typeof reference === "string", "invalid_wrapper_reference");
  const checkout = fs.realpathSync.native(root);
  let relative = reference;
  if (kind === "baseline") {
    const prefix = checkout.endsWith(path.sep) ? checkout : checkout + path.sep;
    requireEvidence(reference.startsWith(prefix), "invalid_wrapper_reference");
    relative = reference.slice(prefix.length).split(path.sep).join("/");
  }
  const match = /^artifacts\/(wrapper-result-[A-Za-z0-9]{6})\/results\.json$/.exec(relative);
  requireEvidence(match && (kind === "receipt" || reference === path.join(checkout, "artifacts", match[1], "results.json")),
    "invalid_wrapper_reference");
  return readArtifact(checkout, ["artifacts", match[1]], "results.json", maxNativeBytes);
}

export const maxNativeBytes = 2 * 1024 * 1024;

/** Read an invocation-owned result using the same bounded reader as sealed CI reports. */
export function readRunResultBytes(file: string, maxBytes: number): Buffer {
  return readArtifact(path.dirname(path.resolve(file)), [], path.basename(file), maxBytes);
}

function readArtifact(root: string, directories: string[], name: string, maxBytes: number): Buffer {
  let fd: number | undefined;
  try {
    let directory = fs.realpathSync.native(root);
    for (const segment of directories) {
      directory = path.join(directory, segment);
      requireEvidence(fs.lstatSync(directory).isDirectory(), "unsafe_artifact_path");
    }
    const file = path.join(directory, name);
    const entry = fs.lstatSync(file, { bigint: true });
    requireEvidence(entry.isFile() && entry.nlink === 1n && fs.realpathSync.native(file) === file,
      "unsafe_artifact_path");
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const stat = fs.fstatSync(fd, { bigint: true });
    // On Windows a path stat may omit the volume ID even though the handle stat reports it.
    const sameDevice = entry.dev === stat.dev || (process.platform === "win32" && entry.dev === 0n);
    requireEvidence(stat.isFile() && stat.nlink === 1n && sameDevice && entry.ino === stat.ino &&
      fs.realpathSync.native(file) === file, "unsafe_artifact_path");
    requireEvidence(stat.size > 0n && stat.size <= BigInt(maxBytes), "invalid_artifact_size");
    const size = Number(stat.size);

    // Cap actual reads as well as the initial stat, even if the producer changes the file.
    const bytes = Buffer.alloc(size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (read === 0) break;
      length += read;
    }
    requireEvidence(length === size, "artifact_changed");
    return bytes.subarray(0, length);
  } catch (error) {
    if (error instanceof EvidenceIssue) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new EvidenceIssue("missing", "file_missing");
    throw new EvidenceIssue("invalid", "unreadable_artifact");
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

export function readPinnedBytes(root: string, job: Job, name: InputFile, pin: string, maxBytes: number): Buffer {
  requireEvidence(isDigest(pin), "digest_mismatch");
  const bytes = readEvidenceBytes(root, job, name, maxBytes);
  requireEvidence(createHash("sha256").update(bytes).digest("hex") === pin, "digest_mismatch");
  return bytes;
}

export function parseEvidenceJson(bytes: Buffer): unknown {
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new EvidenceIssue("invalid", "invalid_json"); }
}

export function readPinnedJson(root: string, job: Job, name: InputFile, pin: string, maxBytes: number): unknown {
  return parseEvidenceJson(readPinnedBytes(root, job, name, pin, maxBytes));
}
