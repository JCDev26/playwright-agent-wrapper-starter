import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import type { ProcessCleanup } from "../contract/resultSchema";
import { createProcessObserver, observedProcessesAbsent, rememberDescendants, sameProcess, terminateObserved, type ProcessIdentity } from "./processTree";

export interface ProcessOutcome {
  status: number | null;
  signal: string | null;
  pid: number | null;
  error?: Error;
  cleanup: ProcessCleanup;
}
export interface ProcessOptions {
  shell: false;
  stdio: ["ignore", 2, 2];
  env: NodeJS.ProcessEnv;
  signal: AbortSignal;
  cleanupTimeoutMs: number;
}
export type PlaywrightProcessRunner = (command: string, args: readonly string[], options: ProcessOptions) => Promise<ProcessOutcome>;

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const emptyCleanup = (): ProcessCleanup => ({ scope: "observed-process-tree", status: "not-started", observedDescendants: 0 });

/**
 * Supervise a trusted process, remembering PID + birth identity across snapshots.
 * This cannot contain a process that escapes/reparents before it is observed.
 */
export const runOwnedProcess: PlaywrightProcessRunner = async (command, args, options) => {
  if (options.signal.aborted) return { status: null, signal: null, pid: null, cleanup: emptyCleanup() };
  const launchStarted = Date.now();
  let child;
  try {
    child = spawn(command, args, { shell: false, stdio: options.stdio, env: options.env, windowsHide: true });
  } catch (error) {
    return { status: null, signal: null, pid: null, error: error as Error, cleanup: emptyCleanup() };
  }
  const pid = child.pid ?? null;
  const launchFinished = Date.now();
  let closed = false;
  let status: number | null = null;
  let signal: string | null = null;
  let error: Error | undefined;
  let close!: () => void;
  const completion = new Promise<void>(resolve => { close = resolve; });
  child.once("error", cause => { error = cause; if (!child.pid) { closed = true; close(); } });
  child.once("close", (code, name) => { closed = true; status = code; signal = name; close(); });
  if (pid === null) {
    await completion;
    return { pid, status, signal, error, cleanup: emptyCleanup() };
  }

  const known = new Map<number, ProcessIdentity>();
  let observing = true;
  let snapshotError: string | undefined;
  const observations = new AbortController();
  const observer = createProcessObserver();
  const monitorStop = new AbortController();
  const sample = async (budget: number) => {
    const rows = await observer.snapshot(budget, observations.signal);
    // Never adopt a root that has already exited or a later reuse of its PID.
    if (!known.has(pid) && !closed) {
      const root = rows.find(row => row.pid === pid);
      const bornMs = root && process.platform === "win32"
        ? Number(BigInt(root.born) / 10000n - 62135596800000n) : null;
      if (root && (bornMs === null || (bornMs >= launchStarted - 10 && bornMs <= launchFinished + 10))) {
        known.set(pid, root);
      }
    }
    rememberDescendants(pid, known, rows);
    return rows;
  };
  // Serial snapshots avoid overlapping OS queries and do not block JS cancellation.
  const monitor = (async () => {
    while (observing) {
      try { await sample(Math.min(1000, options.cleanupTimeoutMs)); }
      catch (cause) { snapshotError = (cause as Error).message; }
      if (observing) await delay(100, undefined, { signal: monitorStop.signal }).catch(() => {});
    }
  })();
  let abort!: () => void;
  const interrupted = new Promise<void>(resolve => { abort = resolve; });
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  await Promise.race([completion, interrupted]);
  options.signal.removeEventListener("abort", abort);
  observing = false;
  monitorStop.abort();

  const cleanup: ProcessCleanup = { scope: "observed-process-tree", status: "unverified", observedDescendants: 0 };
  const until = performance.now() + options.cleanupTimeoutMs;
  let active = true;
  let budgetTimer: ReturnType<typeof setTimeout> | undefined;
  const remaining = () => Math.max(1, Math.floor(until - performance.now()));
  const clean = async () => {
    await monitor;
    if (!active) return;
    // All in-flight observations have been consumed. ESRCH for every known PID
    // proves absence; any present/reused/denied PID retains full identity checks.
    if (closed && known.has(pid) && observedProcessesAbsent(known)) {
      cleanup.status = "verified";
      return;
    }
    let rows = await sample(remaining());
    if (!active) return;
    // Let Playwright handle normal shutdown on POSIX before forced tree cleanup.
    if (!closed && options.signal.aborted && process.platform !== "win32") {
      child.kill("SIGTERM");
      await Promise.race([completion, pause(Math.min(250, remaining()))]);
      if (!active) return;
      rows = await sample(remaining());
    }
    while (active && performance.now() < until) {
      const live = [...known.values()].filter(owner => rows.some(row => sameProcess(owner, row)));
      if (live.length === 0 && closed) {
        cleanup.status = known.has(pid) ? "verified" : "unverified";
        if (!known.has(pid)) cleanup.detail = "The root exited before a process snapshot established its tree.";
        return;
      }
      // POSIX descendants first; Windows /T covers a subtree, then refresh identities.
      for (const owner of (process.platform === "win32" ? live : live.reverse())) {
        if (!active || performance.now() >= until) return;
        try { await terminateObserved(owner, rows, remaining(), observations.signal); }
        catch (cause) { snapshotError = (cause as Error).message; } // Verify instead of interpreting localized tool output.
        if (process.platform === "win32") break; // /T covers this subtree; refresh before the next PID.
      }
      if (!active) return;
      await Promise.race([completion, pause(Math.min(50, remaining()))]);
      if (active) rows = await sample(remaining());
    }
  };
  try {
    await Promise.race([
      clean(),
      new Promise<void>(resolve => {
        budgetTimer = setTimeout(() => {
          cleanup.status = "incomplete";
          cleanup.detail = "Process cleanup exceeded its explicit budget.";
          active = false;
          observations.abort();
          resolve();
        }, options.cleanupTimeoutMs);
      }),
    ]);
  } catch (cause) {
    if (active) {
      cleanup.status = "unverified";
      cleanup.detail = (cause as Error).message;
    }
  } finally {
    active = false;
    observations.abort();
    if (budgetTimer) clearTimeout(budgetTimer);
    if (!await observer.close(remaining())) {
      cleanup.status = "incomplete";
      cleanup.detail = "Process observer shutdown exceeded the cleanup budget.";
    }
    cleanup.observedDescendants = Math.max(0, known.size - (known.has(pid) ? 1 : 0));
    if (cleanup.status !== "verified" && !cleanup.detail) cleanup.detail = snapshotError ?? "Could not verify observed process termination.";
    if (!closed) {
      // Last attempt on our direct ChildProcess handle; no success claim follows.
      try { child.kill("SIGKILL"); } catch { /* Primary cause survives cleanup failure. */ }
      child.unref();
    }
  }
  return { pid, status, signal, error, cleanup };
};
