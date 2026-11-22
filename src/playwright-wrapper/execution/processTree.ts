import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

export interface ProcessIdentity { pid: number; parent: number; born: string; }
export interface ProcessObserver {
  snapshot(timeoutMs: number, signal?: AbortSignal): Promise<ProcessIdentity[]>;
  close(timeoutMs: number): Promise<boolean>;
}

const powershell = () => path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const maxSnapshotBytes = 4 * 1024 * 1024;
/** Reuse the existing OS query facility only within one supervised invocation. */
const snapshotScript = "$ErrorActionPreference='Stop'; while($null -ne ($request=[Console]::ReadLine())) { if($request -notmatch '^\\d+$') { throw 'Invalid snapshot request.' }; $rows=@(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parent=[int]$_.ParentProcessId;born=$_.CreationDate.ToUniversalTime().Ticks.ToString()} }); [Console]::Out.WriteLine((@{id=[int]$request;rows=$rows}|ConvertTo-Json -Depth 4 -Compress)); [Console]::Out.Flush(); }";

function validateRows(value: unknown): ProcessIdentity[] {
  if (!Array.isArray(value) || value.some(row => !row || !Number.isInteger(row.pid) || row.pid < 0 ||
      !Number.isInteger(row.parent) || row.parent < 0 || typeof row.born !== "string" || !/^\d+$/.test(row.born))) {
    throw new Error("Unusable Windows process snapshot.");
  }
  return value as ProcessIdentity[];
}

function windowsSession() {
  const child = spawn(powershell(), ["-NoProfile", "-NonInteractive", "-Command", snapshotScript],
    { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let ended = false;
  let invalid = false;
  let buffer = "";
  let stderr = "";
  let sequence = 0;
  let pending: { id: number; resolve: (rows: ProcessIdentity[]) => void; reject: (error: Error) => void } | null = null;
  let closed!: () => void;
  const completion = new Promise<void>(resolve => { closed = resolve; });
  const fail = (error: Error) => {
    invalid = true;
    const request = pending;
    pending = null;
    request?.reject(error);
    if (!ended) { try { child.kill("SIGKILL"); } catch { /* close() will report an unverified shutdown. */ } }
  };
  child.once("error", fail);
  child.stdin.on("error", fail);
  child.stderr.setEncoding("utf8").on("data", data => { stderr = (stderr + data).slice(-8192); });
  child.stdout.setEncoding("utf8").on("data", data => {
    buffer += data;
    if (Buffer.byteLength(buffer, "utf8") > maxSnapshotBytes) return fail(new Error("Process snapshot exceeds 4 MiB."));
    let end;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim().replace(/^\uFEFF/, "");
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      try {
        const frame = JSON.parse(line);
        const rows = validateRows(frame.rows);
        if (!pending || frame.id !== pending.id) throw new Error("Unexpected process snapshot response.");
        const request = pending;
        pending = null;
        request.resolve(rows);
      } catch (error) { fail(error as Error); }
    }
  });
  child.once("close", () => {
    ended = true;
    invalid = true;
    const request = pending;
    pending = null;
    request?.reject(new Error("Process observer closed before its response." + (stderr ? " " + stderr : "")));
    closed();
  });

  return {
    usable: () => !invalid && !ended,
    async snapshot(timeoutMs: number, signal?: AbortSignal): Promise<ProcessIdentity[]> {
      if (invalid || ended || pending) throw new Error("Process observer is unavailable or already querying.");
      if (signal?.aborted) throw new Error("Process observation aborted.");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cancel = () => fail(new Error("Process observation aborted."));
      try {
        return await new Promise<ProcessIdentity[]>((resolve, reject) => {
          const id = ++sequence;
          pending = { id, resolve, reject };
          timer = setTimeout(() => fail(new Error("Process observation exceeded its budget.")), Math.max(1, timeoutMs));
          signal?.addEventListener("abort", cancel, { once: true });
          if (signal?.aborted) cancel();
          else child.stdin.write(String(id) + "\n", error => { if (error) fail(error); });
        });
      } finally {
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
      }
    },
    async close(timeoutMs: number): Promise<boolean> {
      if (ended) return true;
      if (pending) fail(new Error("Process observer closed during a query."));
      else child.stdin.end(); // EOF ends the existing PowerShell loop.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          completion.then(() => true),
          new Promise<boolean>(resolve => {
            timer = setTimeout(() => {
              if (!ended) { try { child.kill("SIGKILL"); } catch { /* No verified shutdown claim. */ } }
              resolve(false);
            }, Math.max(1, timeoutMs));
          }),
        ]);
      } finally { if (timer) clearTimeout(timer); }
    },
  };
}

export function createProcessObserver(): ProcessObserver {
  if (process.platform !== "win32") return { snapshot: processSnapshot, close: async () => true };
  let session: ReturnType<typeof windowsSession> | undefined;
  const sessions = new Set<ReturnType<typeof windowsSession>>();
  let closing = false;
  return {
    snapshot(timeoutMs, signal) {
      if (closing || signal?.aborted) return Promise.reject(new Error("Process observation aborted."));
      if (!session?.usable()) {
        session = windowsSession();
        sessions.add(session);
      }
      return session.snapshot(timeoutMs, signal);
    },
    async close(timeoutMs) {
      closing = true;
      return (await Promise.all([...sessions].map(peer => peer.close(timeoutMs).catch(() => false)))).every(Boolean);
    },
  };
}

/** Existing OS facilities only. A snapshot is attribution, not process containment. */
export async function processSnapshot(timeoutMs: number, signal?: AbortSignal): Promise<ProcessIdentity[]> {
  if (process.platform === "win32") {
    const start = performance.now();
    const observer = createProcessObserver();
    try { return await observer.snapshot(timeoutMs, signal); }
    finally { await observer.close(Math.max(1, timeoutMs - (performance.now() - start))); }
  }
  if (process.platform !== "linux") throw new Error("Process-tree observation supports Windows and Linux only.");
  const entries = await fs.readdir("/proc");
  const rows = await Promise.all(entries.filter(name => /^\d+$/.test(name)).map(async name => {
    try {
      const stat = await fs.readFile("/proc/" + name + "/stat", { encoding: "utf8", signal });
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      if (fields[0] === "Z") return null; // Exited zombie awaiting its own parent's reap.
      return { pid: Number(name), parent: Number(fields[1]), born: fields[19]! };
    } catch (error) {
      if (["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) return null;
      throw error;
    }
  }));
  return rows.filter((row): row is ProcessIdentity => row !== null);
}

export function sameProcess(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return a.pid === b.pid && a.born === b.born;
}

/** Absence needs no birth comparison; a present/reused/denied PID still needs the full snapshot. */
export function observedProcessesAbsent(known: ReadonlyMap<number, ProcessIdentity>): boolean {
  for (const owner of known.values()) {
    if (owner.pid <= 0) return false;
    try { process.kill(owner.pid, 0); return false; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false; }
  }
  return true;
}

/** Discover only descendants of identities already observed in this invocation. */
export function rememberDescendants(rootPid: number, known: Map<number, ProcessIdentity>, rows: ProcessIdentity[]): void {
  if (!known.has(rootPid)) return;
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (known.has(row.pid)) continue;
      const parent = known.get(row.parent);
      const liveParent = rows.find(candidate => candidate.pid === row.parent);
      if (parent && liveParent && sameProcess(parent, liveParent) && BigInt(row.born) >= BigInt(parent.born)) {
        known.set(row.pid, row);
        changed = true;
      }
    }
  }
}

/** Match the latest snapshot before termination; never kill by image name. Not atomic containment. */
export async function terminateObserved(identity: ProcessIdentity, rows: ProcessIdentity[], timeoutMs: number, signal?: AbortSignal): Promise<void> {
  if (!rows.some(row => sameProcess(row, identity))) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      execFile(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
        ["/PID", String(identity.pid), "/T", "/F"],
        { windowsHide: true, signal, timeout: Math.max(1, timeoutMs), maxBuffer: 1024 * 1024 },
        error => error ? reject(error) : resolve());
    });
  } else {
    try { process.kill(identity.pid, "SIGKILL"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
  }
}
