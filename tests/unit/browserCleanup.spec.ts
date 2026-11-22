import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { chromium } from "playwright";
import { test, expect } from "@playwright/test";
import { runPlaywrightTarget } from "../../src/playwright-wrapper/execution/runPlaywrightTarget";

test("installed Chromium descendants and endpoint close after cancellation", async ({}, info) => {
  test.skip(!fs.existsSync(chromium.executablePath()), "Compatible Chromium is unavailable; browser cleanup is unverified.");
  test.setTimeout(45_000);
  const marker = info.outputPath("browser.json");
  const script = info.outputPath("browser.cjs");
  fs.writeFileSync(script, [
    "const fs=require('node:fs'); const {chromium}=require(" + JSON.stringify(require.resolve("playwright")) + ");",
    "(async()=>{ const server=await chromium.launchServer({executablePath:chromium.executablePath()});",
    "fs.writeFileSync(" + JSON.stringify(marker) + ",JSON.stringify({pid:server.process().pid,endpoint:server.wsEndpoint()}));",
    "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); })().catch(e=>{fs.writeFileSync(" + JSON.stringify(marker) + ",JSON.stringify({launchError:String(e)}));process.exit(1);});",
  ].join("\n"));
  const controller = new AbortController();
  const pending = runPlaywrightTarget({ project: "smoke" }, { signal: controller.signal, timeoutMs: 20_000 },
    { resolveCliScriptPath: () => script });
  let browserPid: number | undefined;
  try {
    await expect.poll(() => fs.existsSync(marker), { timeout: 10_000 }).toBe(true);
    const browser: {pid: number; endpoint: string; launchError?: string} = JSON.parse(fs.readFileSync(marker, "utf8"));
    test.skip(!!browser.launchError, "Browser launch capability unavailable; cleanup unverified: " + browser.launchError);
    browserPid = browser.pid;
    await new Promise(resolve => setTimeout(resolve, 1200));
    controller.abort();
    const result = await pending;
    expect(result.error?.code).toBe("RUN_CANCELLED");
    expect(result.execution!.cleanup.status).toBe("verified");
    await expect.poll(() => { try { process.kill(browser.pid, 0); return true; } catch { return false; } }).toBe(false);
    const port = Number(new URL(browser.endpoint).port);
    const open = await new Promise<boolean>(resolve => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
      socket.setTimeout(500, () => { socket.destroy(); resolve(false); });
    });
    expect(open).toBe(false);
  } finally {
    controller.abort();
    await pending;
    if (browserPid) { try { process.kill(browserPid, "SIGKILL"); } catch { /* Already gone. */ } }
  }
});
