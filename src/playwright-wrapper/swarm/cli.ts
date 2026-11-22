import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { calibrationBrief, calibrationPacket, compareReviews } from "./calibration";
import { branchExercise, compareSavedMemory, correctionExercise, memoryExercise, readyReview, type WorldChange } from "./fixture";
import { parseHandoff } from "./checkpoints";
import { swarmExercise, Workshop, workshopHelp } from "./workshop";

import { QualityJob, qualityHandoffs, readQualityVerdict } from "./quality-job";
import { qualityTasks, runQualityTask } from "./quality-tasks";

const usage = [
  "tasks / run <area>                  list quality questions or run one fixed check",
  "review                             inspect this host-bound wrapper job and route its findings",
  "session                            coordinate a live host-bound job through operator stdin",
  "demo [--json]                      run the specialist handoff start to finish",
  "workshop                           steer it yourself; type help or pipe commands",
  "memory [case] [--json]             reconcile saved claims and recheck publication",
  "  all (default), unchanged, advanced, revoked, expired, unavailable, conflicting, correction, branch",
  "memory save                       emit a portable reporting handoff as JSON",
  "memory check <file> <change>      compare that file against an independently initialized fixture",
  "calibrate brief | packet           emit the common brief or blinded evidence for both reviewers",
  "calibrate score <comparison.json>  score baseline and twoPass submissions on the frozen cases",
].join("\n");

function json(value: unknown) { console.log(JSON.stringify(value, null, 2)); }

async function workshop(job?: QualityJob) {
  let lab = job ?? new Workshop();
  const help = job ? ["brief / history / resume / hold / continue <role>", "save <role> [next action]",
    "processed <role> <sequence>", "reply <role> <JSON> or reply-file <role> <path>", "review / quit"] : workshopHelp;
  console.log(job ? "Quality job session. Type help for commands." : "Local release-review workshop. Timing draft v1 is ready. Type help for commands.");
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
  input.setPrompt("release> ");
  if (process.stdin.isTTY) input.prompt();
  try {
    for await (const line of input) {
      const command = line.trim();
      if (command === "quit") break;
      if (command === "help") console.log(help.join("\n"));
      else if (command === "reset" && !job) { lab = new Workshop(); console.log("Fresh fixture ready."); }
      else if (command) {
        try {
          const file = /^reply-file\s+(\S+)\s+(.+)$/.exec(command);
          const turn = file ? "reply " + file[1] + " " + readFileSync(file[2]!, "utf8").replace(/^\uFEFF/, "") : command;
          json(lab.step(turn));
        } catch (error) { console.error(error instanceof Error ? error.message : error); }
      }
      if (process.stdin.isTTY) input.prompt();
    }
  } finally { input.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift() ?? "--help";
  if (command === "--help" && !args.length) { console.log(usage); return; }
  if (command === "tasks" && !args.length) return json(qualityTasks());
  if (command === "run" && args.length === 1) { process.exitCode = runQualityTask(args[0]); return; }
  if (command === "review" && !args.length) {
    const verdict = readQualityVerdict();
    json({ verdict, handoffs: qualityHandoffs(verdict) });
    process.exitCode = verdict.status === "approved" ? 0 : verdict.status === "failure_confirmed" ? 1 : 2;
    return;
  }
  if (command === "session" && !args.length) return workshop(new QualityJob());
  if (command === "workshop" && !args.length) return workshop();
  if (command === "calibrate") {
    if (args.length === 1 && args[0] === "brief") return json(calibrationBrief);
    if (args.length === 1 && args[0] === "packet") return json(calibrationPacket());
    if (args.length === 2 && args[0] === "score") {
      const pair = JSON.parse(readFileSync(args[1]!, "utf8").replace(/^\uFEFF/, ""));
      return json(compareReviews(pair.baseline, pair.twoPass));
    }
    throw new Error(usage);
  }
  const machine = args.at(-1) === "--json";
  if (machine) args.pop();
  if (command === "demo" && !args.length) {
    const run = await swarmExercise();
    if (machine) return json(run);
    for (const { action, result } of run.steps) {
      let summary: unknown = result;
      if (Array.isArray(result) && result.some(m => typeof m?.sequence === "number")) summary = result.map(m => m.sequence);
      else if (result && typeof result === "object") {
        if ("body" in result && "sequence" in result) summary = { sequence: result.sequence, message: result.body };
        else if ("checkpointId" in result && "claims" in result) summary = { saved: result.checkpointId };
        else if ("waiting" in result && "jobId" in result) summary = { job: result.jobId, replay: result.waiting };
      }
      console.log(action.padEnd(37), JSON.stringify(summary));
    }
    return;
  }
  const cases: WorldChange[] = ["unchanged", "advanced", "revoked", "expired", "unavailable", "conflicting"];
  if (command === "memory" && args.length === 1 && args[0] === "save") return json(readyReview().saved);
  if (command === "memory" && args.length === 3 && args[0] === "check" && cases.includes(args[2] as WorldChange)) {
    return json(compareSavedMemory(parseHandoff(readFileSync(args[1]!, "utf8")), args[2] as WorldChange));
  }
  if (command === "memory" && args.length <= 1) {
    const name = args[0] ?? "all";
    if (name !== "all" && !cases.includes(name as WorldChange) && name !== "correction" && name !== "branch") throw new Error(usage);
    const runs = cases.filter(c => name === "all" || name === c).map(memoryExercise);
    const correction = name === "all" || name === "correction" ? correctionExercise() : undefined;
    const branch = name === "all" || name === "branch" ? branchExercise() : undefined;
    if (machine) return json({ runs, correction, branch });
    for (const run of runs) {
      const claims = run.resume!.claims.map(c => c.fact + "=" + c.disposition).join("  ");
      console.log(run.change.padEnd(12), claims, " | ", run.action.status, "calls=" + run.action.publisherCalls);
    }
    if (correction) console.log("correction  ", correction.before.reasons.join(", "), "->", correction.action.status,
      "(original " + correction.note.checkpointId + ", corrected " + correction.corrected.checkpointId + ")");
    if (branch) console.log("branch      ", "loaded " + branch.selected + "; newer other-branch save rejected: " + branch.rejection);
    return;
  }
  throw new Error(usage);
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 2; });
