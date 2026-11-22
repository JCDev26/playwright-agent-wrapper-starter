import { createRunReport, type RunContext, type RunReport, type VisualApplicability } from "./run-report";
import type { PlaywrightRunResult } from "../playwright-wrapper/contract/resultSchema";

/** Caller supplies the tested revision/environment; never infer it from transport ok. */
export function toRunReport(result: PlaywrightRunResult, context: RunContext, visual?: VisualApplicability): RunReport & { native: PlaywrightRunResult } {
  return { ...createRunReport(context, [{
    name: "playwright",
    status: result.status === "passed" && result.ok ? "passed"
      : result.status === "failed" || result.execution?.nativeJudgment === "failed" ? "failed" : "inconclusive",
    // Primary JSON is invocation-scoped. Native reports remain the detailed
    // evidence surface; lifecycle metadata is preserved in native.execution.
    evidence: result.artifacts.testResultsJson ? [result.artifacts.testResultsJson] : [],
  }], visual), native: structuredClone(result) };
}
