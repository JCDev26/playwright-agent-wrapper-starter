import { execFileSync } from "node:child_process";

/** A dirty checkout cannot identify the source of a timing observation by HEAD alone. */
export function cleanRevision(cwd = process.cwd()): string | null {
  try {
    const git = (...args: string[]) => execFileSync("git", args, {
      cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000,
    }).trim();
    const head = git("rev-parse", "HEAD");
    return git("status", "--porcelain", "--untracked-files=normal") ? null : head;
  } catch { return null; }
}
