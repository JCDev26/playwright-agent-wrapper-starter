import { spawnSync } from "node:child_process";
import path from "node:path";

const test = "scripts/test.cjs";
const areas = {
  code: { purpose: "Type-check the code and run wrapper unit tests.", steps: [["node_modules/typescript/bin/tsc", "--noEmit"], [test, "--project=unit"]] },
  web: { purpose: "Exercise the desktop product journey.", steps: [[test, "--project=smoke"]] },
  mobile: { purpose: "Exercise touch journeys in Android and iOS browser emulation.", steps: [[test, "--project=mobile-android", "--project=mobile-ios"]] },
  performance: { purpose: "Measure the interaction on the demo application.", steps: [[test, "--project=performance"]] },
  security: { purpose: "Check the demo product's declared defensive contracts.", steps: [[test, "--project=security"]] },
  load: { purpose: "Measure the local demo API workload with k6.", steps: [["--import", "tsx", "examples/load/run.ts"]] },
  governance: { purpose: "Exercise the wrapper's own request, evidence, reviewer and transport boundaries.", steps: [
    [test, "--project=unit", "validateInputs.spec", "contrarian", "mainRuleset.spec"],
    [test, "--project=integration", "specialistTransports.spec"]] },
  agent: { purpose: "Exercise specialist handoffs, checkpoint recovery and reviewer calibration.", steps: [[test, "--project=unit", "swarm-"]] },
} as const;

export function qualityTasks() { return Object.entries(areas).map(([area, task]) => ({ area, purpose: task.purpose })); }

/** Operator-facing task selection. Never translate user prose or extra flags into a process invocation. */
export function runQualityTask(area: string) {
  if (!Object.hasOwn(areas, area)) throw new Error("Unknown quality area. Use quality tasks to list named checks.");
  for (const args of areas[area as keyof typeof areas].steps) {
    const child = spawnSync(process.execPath, [...args], { cwd: path.resolve(__dirname, "../../.."),
      stdio: "inherit", shell: false, windowsHide: true });
    if (child.error) throw child.error;
    if (child.status !== 0) return child.status ?? 2;
  }
  return 0;
}
