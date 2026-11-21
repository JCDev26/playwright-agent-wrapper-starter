import { lstatSync, mkdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { cleanRevision } from "../performance/revision";

export const jobIdPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function authorizeAgentRequest(expectedName: string, name: unknown, args: unknown, env: NodeJS.ProcessEnv,
  revision: () => string | null = cleanRevision):
    { ok: true; jobId: string; revision: string } | { ok: false; reason: string } {
  if (name !== expectedName || !args || typeof args !== "object" || Array.isArray(args) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(args)) || Reflect.ownKeys(args).length !== 0)
    return { ok: false, reason: "Only the registered assessment with empty arguments is permitted." };
  const jobId = env.PW_AGENT_JOB_ID;
  if (!jobId || !jobIdPattern.test(jobId))
    return { ok: false, reason: "A host-issued job UUID is required." };
  const approved = env.PW_AGENT_REVISION;
  if (!approved || !/^[0-9a-f]{40}$/.test(approved) || revision() !== approved)
    return { ok: false, reason: "The clean checkout must match the candidate revision authorized by the host." };
  if (env.PW_PERF_REFERENCE_ROOT)
    return { ok: false, reason: "Candidate execution cannot override the application checkout." };
  return { ok: true, jobId, revision: approved };
}

type JobArea = "reporting" | "security-agent-jobs" | "performance-agent-jobs";

/** A new job directory is exclusive. Existing parent directories must resolve inside the checkout. */
export function jobDirectory(area: JobArea, jobId: string, create = false): string {
  if (!jobIdPattern.test(jobId)) throw new Error("A host-issued job UUID is required.");
  let directory = realpathSync.native(process.cwd());
  for (const name of ["artifacts", area, jobId]) {
    directory = path.join(directory, name);
    if (create) {
      try { mkdirSync(directory); }
      catch (error) {
        if (name === jobId || (error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    if (!lstatSync(directory).isDirectory() || realpathSync.native(directory) !== directory)
      throw new Error("An evidence directory must be a real directory inside the checkout.");
  }
  return directory;
}

/** One atomic reservation per executing role, shared across clients and process restarts. */
export function claimAgentJob(lane: "performance" | "security", jobId: string): string | null {
  try {
    jobDirectory(`${lane}-agent-jobs`, jobId, true);
    return null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EEXIST"
      ? "This host-issued job has already been consumed." : "The wrapper could not reserve the job.";
  }
}
