import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const argv = ["--import", "tsx", path.resolve("src/playwright-wrapper/performance/cli.ts")];

test("JSON stdio refuses extra envelope fields, invalid input and CLI flags before execution", () => {
  for (const [args, input] of [
    [[], '{"name":"assess-performance","arguments":{},"command":"unexpected"}'],
    [[], "invalid json"], [[], "x".repeat(1025)], [["--project=smoke"], "{}"],
  ] as [string[], string][]) {
    const child = spawnSync(process.execPath, [...argv, ...args], { input, encoding: "utf8" });
    expect(child.status, child.stderr).toBe(2);
    expect(JSON.parse(child.stdout)).toMatchObject({ status: "denied", runs: [] });
  }
});

test("an independent MCP client sees one tool and cannot broaden its scope", async () => {
  const client = new Client({ name: "transport-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [...argv, "--mcp"] });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(["assess-performance"]);
    expect(tools[0].inputSchema.additionalProperties).toBe(false);
    const result = await client.callTool({ name: "assess-performance", arguments: { workers: 4 } });
    expect(result.isError).toBe(true);
    const denied = await client.callTool({ name: "assess-performance", arguments: {} });
    expect(denied.isError).toBe(true); // No host-issued job in this client process.
  } finally {
    await client.close();
  }
});
