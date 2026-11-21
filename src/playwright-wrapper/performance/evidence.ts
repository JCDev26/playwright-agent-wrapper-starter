import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { JSONReport } from "@playwright/test/reporter";
import policy from "../../../agents/performance/policy.json";
import { judgePlaywrightReport } from "../execution/playwrightJudgment";

const comparisonFields = [
  "browserEngine", "browser", "platform", "architecture", "osRelease", "playwright", "node",
  "runnerClass", "benchmarkHash", "conditions",
] as const;
type ComparisonField = (typeof comparisonFields)[number];
export interface Observation {
  sha256: string;
  revision: string;
  harnessRevision: string;
  initialTasks: number;
  medianMs: number;
  context: Record<ComparisonField, string>;
}

const maxReportBytes = 2 * 1024 * 1024;

function readReportFile(file: string): Buffer {
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > maxReportBytes) throw new Error("Invalid report size");
  return readFileSync(file);
}

/** Read only the inline timing attachment. A path or URL inside a report has no authority. */
export function readObservation(source: string | Buffer, pinnedHash?: string): Observation {
  const bytes = typeof source === "string" ? readReportFile(source) : source;
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > maxReportBytes) throw new Error("Invalid report size");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (pinnedHash !== undefined && sha256 !== pinnedHash) throw new Error("Baseline digest mismatch");
  const report: JSONReport = JSON.parse(bytes.toString("utf8"));
  if (judgePlaywrightReport(report, 0) !== "passed" || report.suites.length !== 1 ||
      report.config.workers !== 1 || report.stats.expected !== 1) throw new Error("Expected one passing benchmark");
  const [suite] = report.suites;
  const [spec] = suite.specs;
  if (suite.suites?.length || suite.specs.length !== 1 || spec.file !== policy.target.spec || spec.tests.length !== 1)
    throw new Error("Unexpected benchmark spec");
  const [test] = spec.tests;
  const [attempt] = test.results;
  if (test.projectName !== policy.target.project || test.expectedStatus !== "passed" || test.status !== "expected" ||
      test.results.length !== 1 || attempt.status !== "passed" || attempt.retry !== 0 || attempt.errors.length)
    throw new Error("Expected one completed first attempt");
  const timing = attempt.attachments.filter(a => a.name === "task-timing.json");
  if (timing.length !== 1 || timing[0].path || !timing[0].body || timing[0].contentType !== "application/json")
    throw new Error("Expected inline task timing");
  const data = JSON.parse(Buffer.from(timing[0].body, "base64").toString("utf8"));
  if (data.metric !== policy.metric || data.unit !== "ms" || data.project !== policy.target.project ||
      data.initialTasks !== policy.initialTasks || typeof data.harnessRevision !== "string" ||
      !/^[0-9a-f]{40}$/.test(data.harnessRevision) ||
      data.browserEngine !== "chromium" || typeof data.revision !== "string" || !/^[0-9a-f]{40}$/.test(data.revision) ||
      typeof data.benchmarkHash !== "string" || !/^[0-9a-f]{64}$/.test(data.benchmarkHash))
    throw new Error("Incomplete benchmark provenance");
  const samples: unknown = data.samplesMs;
  if (!Array.isArray(samples) || samples.length !== policy.sampleCount ||
      !samples.every(n => typeof n === "number" && Number.isFinite(n) && n >= 0))
    throw new Error("Invalid timing samples");
  const sorted = samples.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const medianMs = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  if (!Number.isFinite(medianMs) || medianMs !== data.medianMs) throw new Error("Inconsistent median");
  const context = {} as Observation["context"];
  for (const field of comparisonFields) {
    if (typeof data[field] !== "string" || !data[field].trim()) throw new Error("Missing comparison context");
    context[field] = data[field];
  }
  return { revision: data.revision, harnessRevision: data.harnessRevision, initialTasks: data.initialTasks, sha256, medianMs, context };
}

export function differingFields(a: Observation, b: Observation): ComparisonField[] {
  return comparisonFields.filter(field => a.context[field] !== b.context[field]);
}
