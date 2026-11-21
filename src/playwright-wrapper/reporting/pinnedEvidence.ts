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

const inputFiles = ["manifest.json", "suite.json", "security.json", "performance.json"] as const;
export type InputFile = typeof inputFiles[number];

/** Names come from the wrapper. Neither requests nor evidence can introduce a path. */
export function readEvidenceBytes(root: string, job: Job, name: InputFile, maxBytes: number): Buffer {
  requireEvidence(jobIdPattern.test(job.jobId) && inputFiles.includes(name), "unsafe_artifact_path");
  let fd: number | undefined;
  try {
    let directory = fs.realpathSync.native(root);
    for (const segment of ["artifacts", "reporting", job.jobId]) {
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

export function readPinnedJson(root: string, job: Job, name: InputFile, pin: string, maxBytes: number): unknown {
  const bytes = readEvidenceBytes(root, job, name, maxBytes);
  requireEvidence(createHash("sha256").update(bytes).digest("hex") === pin, "digest_mismatch");
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new EvidenceIssue("invalid", "invalid_json"); }
}
