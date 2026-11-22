import { spawn } from "node:child_process";
import { getEventListeners } from "node:events";
import { test, expect } from "@playwright/test";
import { createProcessObserver, observedProcessesAbsent } from "../../src/playwright-wrapper/execution/processTree";

test("absence proof rejects live/reused, denied and invalid process identifiers", () => {
  const known = new Map([[123, { pid: 123, parent: 1, born: "1" }]]);
  const original = process.kill;
  try {
    process.kill = (() => { throw Object.assign(new Error("gone"), { code: "ESRCH" }); }) as typeof process.kill;
    expect(observedProcessesAbsent(known)).toBe(true);
    process.kill = (() => true) as typeof process.kill;
    expect(observedProcessesAbsent(known)).toBe(false); // Live PID, including a reuse, needs birth verification.
    for (const code of ["EPERM", "EINVAL"]) {
      process.kill = (() => { throw Object.assign(new Error("uncertain"), { code }); }) as typeof process.kill;
      expect(observedProcessesAbsent(known)).toBe(false);
    }
    process.kill = (() => { throw new Error("must not probe process groups"); }) as typeof process.kill;
    expect(observedProcessesAbsent(new Map([[0, { pid: 0, parent: 0, born: "1" }]]))).toBe(false);
  } finally { process.kill = original; }
});

test("Windows observer consumes fresh replies, recovers after cancellation and reaps its sessions", async () => {
  test.skip(process.platform !== "win32", "Windows query-session protocol; Linux keeps its existing /proc adapter.");
  test.setTimeout(20_000);
  const observer = createProcessObserver();
  const pids = new Set<number>();
  let child: ReturnType<typeof spawn> | undefined;
  let childClosed: Promise<void> | undefined;
  try {
    const first = await observer.snapshot(3000);
    const root = first.find(row => row.pid === process.pid)!;
    expect(root).toBeDefined();
    for (const row of first) if (row.parent === process.pid) pids.add(row.pid);
    child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"],
      { shell: false, windowsHide: true, stdio: "ignore" });
    childClosed = new Promise<void>((resolve, reject) => {
      child!.once("error", reject);
      child!.once("close", () => resolve());
    });
    const second = await observer.snapshot(3000);
    expect(second.find(row => row.pid === process.pid)).toEqual(root);
    expect(second.some(row => row.pid === child!.pid && row.parent === process.pid && /^\d+$/.test(row.born))).toBe(true);
    const controller = new AbortController();
    const interrupted = observer.snapshot(3000, controller.signal);
    controller.abort();
    await expect(interrupted).rejects.toThrow("aborted");
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    const recovered = await observer.snapshot(3000);
    expect(recovered.find(row => row.pid === process.pid)).toEqual(root);
    expect(recovered.some(row => row.pid === child!.pid)).toBe(true);
    for (const row of recovered) if (row.parent === process.pid && row.pid !== child!.pid) pids.add(row.pid);
    expect(await observer.close(3000)).toBe(true);
    await expect(observer.snapshot(3000)).rejects.toThrow("aborted");
    for (const pid of pids) {
      let code: string | undefined;
      try { process.kill(pid, 0); }
      catch (error) { code = (error as NodeJS.ErrnoException).code; }
      expect(code, "Observer process " + pid + " must be gone").toBe("ESRCH");
    }
  } finally {
    await observer.close(3000);
    if (child && child.exitCode === null) child.kill("SIGKILL");
    await childClosed;
  }
});

