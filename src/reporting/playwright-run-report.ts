import { createRunReport, type RunContext, type RunReport } from "./run-report";
import type { PlaywrightRunResult } from "../playwright-wrapper/contract/resultSchema";

/** Caller supplies the tested revision/environment; never infer it from transport ok. */
export function toRunReport(result: PlaywrightRunResult, context: RunContext): RunReport & { native: PlaywrightRunResult } {
  return { ...createRunReport(context, [{
    name: "playwright",
    status: result.status === "passed" && result.ok ? "passed"
      : result.status === "failed" ? "failed" : "inconclusive",
    // The wrapper isolates this path for the current invocation. Other optional
    // report/trace paths can refer to prior runs and are not promoted as fresh evidence.
    evidence: result.artifacts.testResultsJson ? [result.artifacts.testResultsJson] : [],
  }]), native: structuredClone(result) };
}
