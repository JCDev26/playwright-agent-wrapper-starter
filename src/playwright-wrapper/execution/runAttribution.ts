import { execFile } from "node:child_process";
import path from "node:path";
import type { PlaywrightExecution } from "../contract/resultSchema";

const unknownSource = (): PlaywrightExecution["source"] => ({ revision: null, workingTree: "unknown" });
/** Observed checkout context only; never claims deployment/binary correspondence. */
export async function observeSource(signal: AbortSignal): Promise<PlaywrightExecution["source"]> {
  const git = (args: string[]) => new Promise<string>((resolve, reject) => {
    execFile("git", args, { signal, timeout: 1000, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => error ? reject(error) : resolve(stdout.trim()));
  });
  try {
    const identity = await git(["rev-parse", "--show-toplevel", "HEAD"]);
    const split = identity.lastIndexOf("\n");
    const top = identity.slice(0, split).trimEnd();
    const revision = identity.slice(split + 1);
    if (path.resolve(top) !== path.resolve(process.cwd())) return unknownSource();
    const changes = await git(["status", "--porcelain", "--untracked-files=normal"]);
    return /^[a-f0-9]{40}$/.test(revision) ? { revision, workingTree: changes ? "dirty" : "clean" } : unknownSource();
  } catch { return unknownSource(); }
}
